import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { confirmDialog } from "../../../../../client/ui/components/confirm-dialog/index.jsx";
import { primitives } from "../../../../../client/ui/primitives.js";
import { toast } from "../../../../../client/ui/toast.js";
import { TASK_MONITOR_NS } from "../../../../task-monitor/client/locale.js";
import {
  GIT_PUBLISH_ACTION_PATH,
  GIT_PUBLISH_PREVIEW_PATH,
  GIT_PUBLISH_REASON,
  GIT_PUSH_TIMEOUT_MS,
  MAX_PUBLISH_MESSAGE_LENGTH,
} from "../../constants.js";
import { announceRepositoryChange, onRepositoryChange } from "../../repository-events.js";
import type { GIT_PUBLISH_COPY } from "./locale.js";
import css from "./style.css";

export const CSS = css;

type Action = "commit" | "push";
type CopyKey = keyof typeof GIT_PUBLISH_COPY.en;
type Translate = (key: CopyKey) => string;

interface PublishProps {
  cwd: string;
  children?: React.ReactNode;
}

interface Preview {
  ok: true;
  action: Action;
  branch: string;
  head: string | null;
  stagedPaths: string[];
  destination: { remote: string; ref: string; url: string } | null;
  ahead: number | null;
  behind: number | null;
  token: string;
}

type Review =
  | { phase: "choose" }
  | { phase: "loading"; action: Action }
  | { phase: "ready"; action: Action; preview: Preview; revision: number }
  | { phase: "error"; action: Action; key: CopyKey; detail?: string };

type Failure = { key: CopyKey; detail?: string };

const CHOOSE: Review = { phase: "choose" };
const ACTION_TIMEOUT_MS = GIT_PUSH_TIMEOUT_MS + 15_000;
// A panel switch must not allow a second write while the first request is unresolved.
const writes = new Set<string>();

function isPreview(payload: any, action: Action): payload is Preview {
  const nullableCount = (n: unknown) => n === null || (typeof n === "number" && Number.isSafeInteger(n) && n >= 0);
  return payload?.ok === true && payload.action === action && typeof payload.branch === "string" && payload.branch !== ""
    && (payload.head === null || typeof payload.head === "string")
    && Array.isArray(payload.stagedPaths) && payload.stagedPaths.every((path: unknown) => typeof path === "string")
    && (payload.destination === null || (typeof payload.destination?.remote === "string" && payload.destination.remote !== ""
      && typeof payload.destination.ref === "string" && payload.destination.ref !== "" && typeof payload.destination.url === "string"))
    && nullableCount(payload.ahead) && nullableCount(payload.behind) && typeof payload.token === "string" && payload.token !== "";
}

function blockedReason(preview: Preview): CopyKey | null {
  if (preview.action === "commit") return preview.stagedPaths.length === 0 ? "gitPublishNothingStaged" : null;
  if (!preview.destination) return "gitPublishNoDestination";
  if (preview.behind !== null && preview.behind > 0) return "gitPublishPushBehind";
  if (preview.ahead === 0) return "gitPublishNothingToPush";
  return null;
}

function matchesFailure(payload: any, reason: keyof typeof GIT_PUBLISH_REASON): boolean {
  // Checked domain codes are authoritative; retain exact reason matching for route errors without a code.
  return payload?.code === GIT_PUBLISH_REASON[reason] || (payload?.code == null && payload?.reason === reason);
}

function payloadFailure(payload: any, fallback: CopyKey): Failure {
  const reason = typeof payload?.reason === "string" ? payload.reason : "";
  const detail = typeof payload?.detail === "string" ? payload.detail : "";
  const key = matchesFailure(payload, "stale-preview") ? "gitPublishStale" : fallback;
  const code = typeof payload?.code === "number" ? String(payload.code) : "";
  return { key, detail: [detail || reason, code].filter(Boolean).join(" · ") };
}

export function createGitPublish(ctx: any, t: Translate = ctx.locale.bind(TASK_MONITOR_NS)) {
  const Button = primitives.Button ?? "button";

  function PublishForDirectory({ cwd, children }: PublishProps) {
    const [open, setOpen] = React.useState(false);
    const [review, setReview] = React.useState<Review>(CHOOSE);
    const [message, setMessage] = React.useState("");
    const [pending, setPending] = React.useState(false);
    const alive = React.useRef(false);
    const revision = React.useRef(0);
    const selected = React.useRef<Action | null>(null);
    const messageId = React.useId();

    React.useLayoutEffect(() => {
      alive.current = true;
      const off = onRepositoryChange(cwd, () => {
        const action = selected.current;
        if (action === null || writes.has(cwd)) return;
        ++revision.current;
        setReview({ phase: "error", action, key: "gitPublishStale" });
      });
      return () => {
        alive.current = false;
        ++revision.current;
        off();
      };
    }, [cwd]);

    function dismiss() {
      if (writes.has(cwd)) return;
      ++revision.current;
      selected.current = null;
      setOpen(false);
      setReview(CHOOSE);
      setMessage("");
    }

    async function load(action: Action) {
      if (writes.has(cwd)) return;
      const request = ++revision.current;
      selected.current = action;
      setReview({ phase: "loading", action });
      try {
        const response = await fetchJson(GIT_PUBLISH_PREVIEW_PATH, { json: { cwd, action } });
        const payload = await response.json();
        if (request !== revision.current) return;
        setReview(response.ok && isPreview(payload, action)
          ? { phase: "ready", action, preview: payload, revision: request }
          : { phase: "error", action, ...payloadFailure(payload, "gitPublishPreviewFailed") });
      } catch {
        if (request === revision.current) setReview({ phase: "error", action, key: "gitPublishPreviewFailed" });
      }
    }

    async function confirm() {
      if (!alive.current || review.phase !== "ready" || review.revision !== revision.current || writes.has(cwd)) return;
      const { action, preview } = review;
      const draft = message.trim();
      if (blockedReason(preview) || (action === "commit" && !draft)) return;
      // Consume the UI snapshot before sending. Even a failed or lost response needs a fresh preview.
      ++revision.current;
      writes.add(cwd);
      setPending(true);
      let failure: Failure | null = null;
      try {
        const response = await fetchJson(GIT_PUBLISH_ACTION_PATH, {
          json: { cwd, action, token: preview.token, ...(action === "commit" ? { message: draft } : {}) },
          timeoutMs: ACTION_TIMEOUT_MS,
        });
        const payload = await response.json();
        if (!(response.ok && payload?.ok === true && payload.action === action)) {
          // A process can fail or time out after it has already updated a ref.
          const uncertain = payload?.ok !== false
            || (response.status >= 500 && !matchesFailure(payload, "git-missing"))
            || matchesFailure(payload, "commit-failed") || matchesFailure(payload, "push-failed");
          failure = payloadFailure(payload, uncertain ? "gitPublishUncertain" : "gitPublishActionFailed");
        }
      } catch {
        failure = { key: "gitPublishUncertain" };
      } finally {
        writes.delete(cwd);
        if (alive.current) setPending(false);
      }
      if (failure !== null) {
        if (alive.current) setReview({ phase: "error", action, ...failure });
        else toast.error([t(failure.key), failure.detail].filter(Boolean).join(" "));
        return;
      }
      if (alive.current) dismiss();
      announceRepositoryChange(cwd);
      toast.success(t(action === "commit" ? "gitPublishCommitDone" : "gitPublishPushDone"));
    }

    const preview = review.phase === "ready" ? review.preview : null;
    const blocked = preview ? blockedReason(preview) : null;
    const action = review.phase === "choose" ? null : review.action;
    const disabled = !cwd || !primitives.Modal || pending;
    return (
      <>
        <button
          type="button"
          className="sk-task-monitor__row"
          data-kind="environment"
          data-clickable
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => {
            if (writes.has(cwd)) {
              toast.info(t("gitPublishWorking"));
              return;
            }
            setOpen(true);
          }}
        >
          {children ?? t("gitPublishTitle")}
        </button>
        {open ? confirmDialog({
          primitives,
          title: t("gitPublishTitle"),
          description: t("gitPublishChoose"),
          pending,
          onCancel: dismiss,
          cancelLabel: t("gitPublishCancel"),
          closeLabel: t("gitPublishClose"),
          confirmButton: action === null ? false : (
            <Button
              type="button"
              variant="primary"
              onClick={confirm}
              disabled={pending || !preview || !!blocked || (action === "commit" && !message.trim())}
            >
              {t(pending ? "gitPublishWorking" : action === "commit" ? "gitPublishConfirmCommit" : "gitPublishConfirmPush")}
            </Button>
          ),
          children: (
            <div className="sk-git-publish">
              <dl className="sk-git-publish__facts">
                <dt>{t("gitPublishWorkspace")}</dt><dd><bdi>{cwd}</bdi></dd>
              </dl>
              <div className="sk-git-publish__choices">
                <Button type="button" variant="outline" aria-pressed={action === "commit"} disabled={pending} onClick={() => load("commit")}>
                  {t("gitPublishPreviewCommit")}
                </Button>
                <Button type="button" variant="outline" aria-pressed={action === "push"} disabled={pending} onClick={() => load("push")}>
                  {t("gitPublishPreviewPush")}
                </Button>
              </div>
              <div className="sk-git-publish__status" role="status">
                {pending ? t("gitPublishWorking") : review.phase === "loading" ? t("gitPublishLoading") : ""}
              </div>
              {review.phase === "error" ? <p className="sk-git-publish__error" role="alert">{t(review.key)}{review.detail ? `\n${review.detail}` : ""}</p> : null}
              {preview ? (
                <>
                  <p>{t(preview.action === "commit" ? "gitPublishStagedOnly" : "gitPublishPushScope")}</p>
                  <dl className="sk-git-publish__facts">
                    <dt>{t("gitPublishBranch")}</dt><dd><bdi>{preview.branch}</bdi></dd>
                    {preview.action === "push" ? (
                      <>
                        <dt>{t("gitPublishRemote")}</dt>
                        <dd>{preview.destination ? <><bdi>{preview.destination.remote}</bdi> · <bdi>{preview.destination.url}</bdi></> : "—"}</dd>
                        <dt>{t("gitPublishRef")}</dt><dd><bdi>{preview.destination?.ref ?? "—"}</bdi></dd>
                        <dt>{t("gitPublishAhead")}</dt><dd>{preview.ahead ?? t("gitPublishUnknown")}</dd>
                        <dt>{t("gitPublishBehind")}</dt><dd>{preview.behind ?? t("gitPublishUnknown")}</dd>
                      </>
                    ) : null}
                  </dl>
                  {blocked ? <p>{t(blocked)}</p> : null}
                  {preview.action === "commit" && preview.stagedPaths.length > 0 ? (
                    <>
                      <div>
                        <p>{t("gitPublishStagedPaths")} ({preview.stagedPaths.length})</p>
                        <ul className="sk-git-publish__paths">
                          {preview.stagedPaths.map((path) => <li key={path}><bdi>{path}</bdi></li>)}
                        </ul>
                      </div>
                      <div className="sk-git-publish__message">
                        <label htmlFor={messageId}>{t("gitPublishMessage")}</label>
                        <textarea id={messageId} rows={3} value={message} required maxLength={MAX_PUBLISH_MESSAGE_LENGTH}
                          disabled={pending} onChange={(event) => setMessage(event.currentTarget.value)} />
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ),
        }) : null}
      </>
    );
  }

  return function GitPublish(props: PublishProps) {
    // Changing worktrees discards the dialog, message and preview, not the result of an in-flight write.
    return <PublishForDirectory key={props.cwd} {...props} />;
  };
}
