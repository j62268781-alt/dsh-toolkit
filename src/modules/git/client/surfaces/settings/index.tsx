import React from "react";
import { findScopedForm } from "../../../../../client/config.js";
import { isComposingEvent } from "../../../../../client/ime.js";
import { acceptConfigWrite } from "../../../../../client/config-write.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { CardSection, PageHeader, Row } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { SettingsSwitch } from "../../../../../client/ui/components/settings-parts/switch.jsx";
import repositoryCss from "../../../../../client/ui/components/settings-parts/repository.css";
import { settingsStyles } from "../../../../../client/styles/settings.js";
import { toast } from "../../../../../client/ui/toast.js";
import panelCss from "./style.css";
import { WorktreeSettings } from "./worktrees.jsx";
import {
  DEFAULT_ALWAYS_FORCE_PUSH,
  DEFAULT_BRANCH_PREFIX,
  DEFAULT_COMMIT_INSTRUCTIONS,
  MAX_BRANCH_PREFIX_LENGTH,
  MAX_COMMIT_INSTRUCTIONS_LENGTH,
  SECTION_ORDER,
  isBranchPrefix,
  normalizeBranchPrefix,
  normalizeCommitInstructions,
} from "../../constants.js";
import { GIT_NS } from "../../locale.js";

export const NAME = "settings";

// 只服务本面板：样式随组件走宿主自管的 <style>，模块卸载时宿主一并清理。
const CSS = `${settingsStyles("sk")}\n${repositoryCss}\n${panelCss}`;

type InstructionsDraft = { value: string };
type InstructionsStatus = { draft: InstructionsDraft; label: string; failed?: boolean };

const DEFAULTS = Object.freeze({
  branchPrefix: DEFAULT_BRANCH_PREFIX,
  alwaysForcePush: DEFAULT_ALWAYS_FORCE_PUSH,
  commitInstructions: DEFAULT_COMMIT_INSTRUCTIONS,
});

/** 快照的形状在不同宿主版本里是 `{value}` 或直接是值；与 boot / theme 面板保持同一读法。 */
function snapshotOf(form) {
  try {
    return form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot;
  } catch {
    return undefined;
  }
}

function readForm(form) {
  const snapshot = snapshotOf(form);
  const value = snapshot?.value ?? snapshot ?? {};

  return {
    branchPrefix: typeof value.branchPrefix === "string" ? value.branchPrefix : DEFAULTS.branchPrefix,
    alwaysForcePush: typeof value.alwaysForcePush === "boolean" ? value.alwaysForcePush : DEFAULTS.alwaysForcePush,
    commitInstructions: typeof value.commitInstructions === "string" ? value.commitInstructions : DEFAULTS.commitInstructions,
  };
}

function isWritable(form) {
  if (typeof form?.set !== "function") return false;
  const snapshot = snapshotOf(form);
  if (form?.writable === false || snapshot?.writable === false) return false;
  return snapshot?.status !== "loading";
}

export function createGitSection(ctx) {
  const t = ctx.locale.bind(GIT_NS);

  return function GitSettingsSection({ form, worktreeForm }) {
    // 配置文档不是本页私有的：别处改了它，本页也要跟着重画。
    const [, setVersion] = React.useState(0);
    // 输入中的草稿；`null` 表示「没有草稿，显示服务端的值」。这就是 Qoder 的
    // 「编辑期间不回填」：只要草稿还在，服务端的新值就不会盖掉用户正在敲的字。
    const [prefixDraft, setPrefixDraft] = React.useState(null);
    const [prefixError, setPrefixError] = React.useState("");
    const [prefixBusy, setPrefixBusy] = React.useState(false);
    const [forceDraft, setForceDraft] = React.useState(null);
    const [forceBusy, setForceBusy] = React.useState(false);
    const [instructionsDraft, setInstructionsDraft] = React.useState<InstructionsDraft | null>(null);
    const [instructionsStatus, setInstructionsStatus] = React.useState<InstructionsStatus | null>(null);
    const activeInstructions = React.useRef<InstructionsDraft | null>(null);
    const queuedInstructions = React.useRef<InstructionsDraft | null>(null);
    const prefixErrorId = React.useId();
    const instructionsId = React.useId();
    const instructionsDescriptionId = React.useId();
    const instructionsStatusId = React.useId();

    React.useEffect(() => {
      if (typeof form?.subscribe !== "function") return undefined;
      return form.subscribe(() => setVersion((value) => value + 1));
    }, [form]);

    const settings = readForm(form);
    const writable = isWritable(form);
    const prefixValue = prefixDraft ?? settings.branchPrefix;
    const instructionsValue = instructionsDraft?.value ?? settings.commitInstructions;
    const forceValue = forceDraft ?? settings.alwaysForcePush;

    const savePrefix = async () => {
      if (prefixDraft === null) return;
      const next = normalizeBranchPrefix(prefixDraft);
      if (!isBranchPrefix(next)) {
        setPrefixError(t("branchPrefixInvalid"));
        return;
      }
      setPrefixError("");
      if (!writable || next === settings.branchPrefix) {
        setPrefixDraft(null);
        return;
      }
      setPrefixBusy(true);
      try {
        await acceptConfigWrite(() => form.set("branchPrefix", next), "branchPrefix");
        setPrefixDraft(null);
        // 前缀是失焦自动保存的：输入框自己不会变，不弹一条用户根本不知道存没存上。
        toast.success(t("saved"));
      } catch (cause) {
        // 失败时把草稿留在输入框里：用户能看到自己敲的是什么，改完还能再存一次。
        toast.error(t("saveFailed", { reason: String(cause?.message ?? cause) }));
      } finally {
        setPrefixBusy(false);
      }
    };

    const saveInstructions = async (draft: InstructionsDraft) => {
      if (!isWritable(form)) return;
      if (activeInstructions.current !== null) {
        // 只排入已失焦的最新草稿，不把请求期间还在输入的文字提前写出去。
        if (draft !== activeInstructions.current) queuedInstructions.current = draft;
        return;
      }

      const next = normalizeCommitInstructions(draft.value);
      if (next === readForm(form).commitInstructions) {
        setInstructionsDraft((current) => (current === draft ? null : current));
        setInstructionsStatus((status) => status?.failed ? null : status);
        return;
      }

      activeInstructions.current = draft;
      setInstructionsStatus({ draft, label: t("saving") });
      try {
        await acceptConfigWrite(() => form.set("commitInstructions", next), "commitInstructions");
        setInstructionsDraft((current) => (current === draft ? null : current));
        setInstructionsStatus({ draft, label: t("saved") });
      } catch (cause) {
        setInstructionsStatus({ draft, label: t("saveFailed", { reason: String(cause?.message ?? cause) }), failed: true });
      } finally {
        activeInstructions.current = null;
        const queued = queuedInstructions.current;
        queuedInstructions.current = null;
        if (queued !== null) void saveInstructions(queued);
      }
    };

    const toggleForcePush = async (next) => {
      if (!writable || forceBusy) return;
      setForceDraft(next);
      setForceBusy(true);
      try {
        await acceptConfigWrite(() => form.set("alwaysForcePush", next), "alwaysForcePush");
        setForceDraft(null);
        toast.success(t("saved"));
      } catch (cause) {
        setForceDraft(null);
        toast.error(t("saveFailed", { reason: String(cause?.message ?? cause) }));
      } finally {
        setForceBusy(false);
      }
    };

    const visibleInstructionsStatus = instructionsDraft === null || instructionsDraft === instructionsStatus?.draft
      ? instructionsStatus
      : null;

    return (
      <main className="sk-git sk-repo-settings">
        <style>{CSS}</style>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        {writable ? null : <p className="sk-git__note" role="status">{t("readOnly")}</p>}

        <CardSection className="sk-repo-settings__groupLead" title={t("sectionTitle")} aria-label={t("sectionTitle")}>
          <Row
            title={t("branchPrefix")}
            description={t("branchPrefixDescription")}
            control={(
              <div className="sk-repo-settings__field">
                <input
                  type="text"
                  className="sk-repo-settings__input"
                  value={prefixValue}
                  maxLength={MAX_BRANCH_PREFIX_LENGTH}
                  placeholder={t("branchPrefixPlaceholder")}
                  aria-label={t("branchPrefix")}
                  aria-invalid={prefixError !== ""}
                  aria-describedby={prefixError === "" ? undefined : prefixErrorId}
                  disabled={!writable || prefixBusy}
                  onChange={(event) => {
                    setPrefixDraft(event.target.value);
                    setPrefixError("");
                  }}
                  onBlur={() => void savePrefix()}
                  onKeyDown={(event) => {
                    // 组字确认的 Enter 只用来选候选，不能顺手把前缀存了。
                    if (isComposingEvent(event)) return;
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.currentTarget.blur();
                  }}
                />
                {prefixError === "" ? null : (
                  <p id={prefixErrorId} className="sk-repo-settings__hint sk-repo-settings__hint--error">{prefixError}</p>
                )}
              </div>
            )}
          />
          <Row
            title={t("alwaysForcePush")}
            description={t("alwaysForcePushDescription")}
            control={(
              <SettingsSwitch
                label={t("alwaysForcePush")}
                checked={forceValue}
                disabled={!writable || forceBusy}
                onChange={(next) => void toggleForcePush(next)}
              />
            )}
          />
        </CardSection>

        <CardSection title={t("commitSection")} aria-label={t("commitSection")}>
          {/* 说明是一段可换行的长文本，控件要占满整行：`Row` 会把控件收进右侧 55% 的栏里。 */}
          <div className="sk-ui-row sk-git__stack">
            <div className="sk-ui-rowText">
              <label htmlFor={instructionsId} className="sk-ui-rowTitle">{t("commitInstructions")}</label>
              <p id={instructionsDescriptionId} className="sk-ui-rowDesc">{t("commitInstructionsDescription")}</p>
            </div>
            <div className="sk-git__stackBody">
              <textarea
                id={instructionsId}
                rows={6}
                className="sk-repo-settings__input sk-git__textarea"
                value={instructionsValue}
                maxLength={MAX_COMMIT_INSTRUCTIONS_LENGTH}
                placeholder={t("commitInstructionsPlaceholder")}
                aria-describedby={visibleInstructionsStatus?.failed ? `${instructionsDescriptionId} ${instructionsStatusId}` : instructionsDescriptionId}
                disabled={!writable}
                onChange={(event) => setInstructionsDraft({ value: event.target.value })}
                onBlur={() => {
                  if (instructionsDraft !== null) void saveInstructions(instructionsDraft);
                }}
              />
              <div className="sk-git__meta">
                <span id={instructionsStatusId} role="status" className={visibleInstructionsStatus?.failed ? "sk-git__status sk-git__status--error" : "sk-git__status"}>
                  {visibleInstructionsStatus?.label}
                </span>
                <span className="sk-git__count">
                  {t("count", { count: instructionsValue.length, max: MAX_COMMIT_INSTRUCTIONS_LENGTH })}
                </span>
              </div>
            </div>
          </div>
        </CardSection>
        <WorktreeSettings t={t} retainForm={worktreeForm} />
      </main>
    );
  };
}

export function install(ctx) {
  const t = ctx.locale.bind(GIT_NS);
  return installSlot(ctx, {
    name: "settings.section",
    id: "git",
    order: SECTION_ORDER,
    label: () => t("nav"),
    locale: GIT_NS,
    // 配置表单在注册那一刻才取得到（settings 文档是异步加载的），所以放进 inject 回调。
    inject: () => {
      const { form, entryId } = findScopedForm(ctx, "git");
      let worktreeForm;
      try { worktreeForm = ctx.configForms.get("worktree"); } catch { /* Native plugin is optional. */ }
      return { form, entryId, worktreeForm };
    },
  }, createGitSection(ctx));
}
