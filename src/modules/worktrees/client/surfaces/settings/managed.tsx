import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { CardSection } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { MANAGED_WORKTREE_CHECK_PATH, MANAGED_WORKTREES_PATH } from "../../../host/constants.js";

const cleanupReasons = new Map([
  ["archive-unknown", "cleanupArchiveUnknown"],
  ["not-archived", "cleanupNotArchived"],
  ["in-use", "cleanupInUse"],
  ["checkout-missing", "cleanupMissing"],
  ["checkout-mismatch", "cleanupMismatch"],
  ["locked", "cleanupLocked"],
  ["prunable", "cleanupPrunable"],
  ["dirty", "cleanupDirty"],
  ["check-unavailable", "cleanupUnavailable"],
]);

interface Entry {
  path: string;
  branch: string;
  repositoryRoot: string;
  status?: "present" | "missing" | "unknown";
  sessionId?: string;
  sessionTitle?: string;
  sessionArchived?: boolean;
}

interface Props {
  t: (key: string) => string;
  openSession?: (id: string) => void;
}

function CleanupCheck({ entry, sessionId, revision, disabled, t }: {
  entry: Entry;
  sessionId: string;
  revision: number;
  disabled: boolean;
  t: Props["t"];
}) {
  const request = React.useRef<AbortController | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState("");
  React.useEffect(() => {
    setPending(false);
    setResult("");
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [revision]);

  async function check() {
    if (disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResult("");
    const { repositoryRoot, path } = entry;
    const params = new URLSearchParams({ sessionId, repositoryRoot, path });
    let message = "cleanupCheckFailed";
    try {
      const response = await fetchJson(`${MANAGED_WORKTREE_CHECK_PATH}?${params}`, {
        signal: controller.signal, timeoutMs: 22_000,
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.ok === true) {
          if (payload.eligible === true && payload.reason === "clean") message = "cleanupClean";
          else if (payload.eligible === false) message = cleanupReasons.get(payload.reason) ?? message;
        }
      }
    } catch {
      // An unavailable check is not evidence that the worktree is clean.
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
        setResult(message);
      }
    }
  }

  return <div className="sk-worktrees__actions">
    <button className="sk-worktrees__button" type="button" aria-disabled={disabled || pending}
      aria-label={`${t("cleanupCheck")}: ${entry.branch} (${entry.path})`}
      onClick={() => void check()}>{t("cleanupCheck")}</button>
    {pending && <span className="sk-repo-settings__hint">{t("cleanupChecking")}</span>}
    <span className="sk-worktrees__check-status" role="status">
      {!disabled && result && <span className="sk-repo-settings__hint">{t(result)}</span>}
    </span>
  </div>;
}

export function ManagedWorktrees({ t, openSession }: Props) {
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [cleanupSupported, setCleanupSupported] = React.useState(false);
  const [error, setError] = React.useState<"managedUnavailable" | "managedFailed" | null>(null);
  const [openError, setOpenError] = React.useState(false);
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchJson(MANAGED_WORKTREES_PATH, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 404 || response.status === 401 || response.status === 403) setEntries(null);
          setError(response.status === 404 ? "managedUnavailable" : "managedFailed");
          return;
        }
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (payload?.ok === true && Array.isArray(payload.worktrees)) {
          setEntries(payload.worktrees);
          setCleanupSupported(payload.cleanupCheck === true);
          setError(null);
        } else setError("managedFailed");
      } catch {
        if (!controller.signal.aborted) setError("managedFailed");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  const groups = new Map<string, Entry[]>();
  for (const entry of entries ?? []) {
    const group = groups.get(entry.repositoryRoot);
    if (group) group.push(entry);
    else groups.set(entry.repositoryRoot, [entry]);
  }
  const status = loading ? t("worktreeLoading") : openError ? t("originOpenFailed")
    : error ? t(entries ? "managedRefreshFailed" : error) : entries?.length ? "" : t("managedEmpty");
  return <CardSection title={t("managedTitle")} aria-label={t("managedTitle")}>
    <div className="sk-ui-row sk-worktrees__stack">
      <div className="sk-worktrees__actions">
        <button className="sk-worktrees__button" type="button" aria-disabled={loading}
          onClick={() => { if (!loading) { setOpenError(false); setLoading(true); refresh(); } }}>{t("managedRefresh")}</button>
        <span className="sk-repo-settings__hint" role="status">{status}</span>
      </div>
      <p className="sk-repo-settings__hint">{t("managedDescription")}</p>
      {cleanupSupported && entries?.some(entry => entry.sessionId) && <p className="sk-repo-settings__hint">{t("cleanupCheckHelp")}</p>}
      {entries?.some(entry => entry.sessionArchived) && <p className="sk-repo-settings__hint">{t("originArchivedHelp")}</p>}
      {[...groups].map(([repository, group]) => <div key={repository}>
        <h4 className="sk-worktrees__repository">{t("repository")}: {repository}</h4>
        <ul role="list" className="sk-worktrees__entries">
          {group.map(entry => {
            const { sessionId, sessionArchived } = entry;
            const sessionLabel = entry.sessionTitle?.trim() || sessionId;
            return <li key={entry.path}>
              <div className="sk-worktrees__actions">
                <div className="sk-ui-rowTitle">{entry.branch}</div>
                <span className="sk-repo-settings__hint">{t(entry.status === "present" ? "checkoutPresent"
                  : entry.status === "missing" ? "checkoutMissing" : "checkoutUnknown")}</span>
              </div>
              <code>{entry.path}</code>
              {sessionId && <div className="sk-worktrees__actions">
                <span className="sk-repo-settings__hint">{t("originSession")}: {sessionLabel}
                  {sessionArchived && ` · ${t("originArchived")}`}</span>
                {sessionArchived === false && openSession && <button className="sk-worktrees__button" type="button"
                  aria-label={`${t("originOpen")}: ${sessionLabel} (${entry.branch})`}
                  onClick={() => { try { openSession(sessionId); } catch { setOpenError(true); } }}>{t("originOpen")}</button>}
              </div>}
              {cleanupSupported && sessionId && <CleanupCheck key={sessionId}
                entry={entry} sessionId={sessionId} revision={revision} disabled={loading || !!error} t={t} />}
            </li>;
          })}
        </ul>
      </div>)}
    </div>
  </CardSection>;
}
