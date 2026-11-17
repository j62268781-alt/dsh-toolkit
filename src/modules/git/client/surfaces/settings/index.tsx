import React from "react";
import { findScopedForm } from "../../../../../client/config.js";
import { acceptConfigWrite } from "../../../../../client/config-write.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { CardSection, PageHeader, Row } from "../../../../../client/ui/components/settings-parts/index.jsx";
import { settingsStyles } from "../../../../../client/styles/settings.js";
import { toast } from "../../../../../client/ui/toast.js";
import panelCss from "./style.css";
import {
  COMMIT_INSTRUCTIONS_SAVE_DELAY_MS,
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
const CSS = `${settingsStyles("sk")}\n${panelCss}`;

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

  /** `primitives.Switch` 取不到时（宿主没发布 UI kit）退化成自绘开关，开关功能照常可用。 */
  function GitSwitch({ label, checked, disabled, onChange }) {
    const HostSwitch = primitives.Switch;
    if (HostSwitch === undefined) {
      return (
        <button
          type="button"
          role="switch"
          className="sk-git__switch"
          aria-label={label}
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
        >
          <span className="sk-git__switchThumb" aria-hidden="true" />
        </button>
      );
    }
    return <HostSwitch label={label} checked={checked} disabled={disabled} onChange={onChange} />;
  }

  return function GitSettingsSection({ form }) {
    // 配置文档不是本页私有的：别处改了它，本页也要跟着重画。
    const [, setVersion] = React.useState(0);
    // 输入中的草稿；`null` 表示「没有草稿，显示服务端的值」。这就是 Qoder 的
    // 「编辑期间不回填」：只要草稿还在，服务端的新值就不会盖掉用户正在敲的字。
    const [prefixDraft, setPrefixDraft] = React.useState(null);
    const [prefixError, setPrefixError] = React.useState("");
    const [prefixBusy, setPrefixBusy] = React.useState(false);
    const [forceDraft, setForceDraft] = React.useState(null);
    const [forceBusy, setForceBusy] = React.useState(false);
    const [instructionsDraft, setInstructionsDraft] = React.useState(null);
    const [saveState, setSaveState] = React.useState("");

    React.useEffect(() => {
      if (typeof form?.subscribe !== "function") return undefined;
      return form.subscribe(() => setVersion((value) => value + 1));
    }, [form]);

    const settings = readForm(form);
    const writable = isWritable(form);
    const prefixValue = prefixDraft ?? settings.branchPrefix;
    const instructionsValue = instructionsDraft ?? settings.commitInstructions;
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
      } catch (cause) {
        // 失败时把草稿留在输入框里：用户能看到自己敲的是什么，改完还能再存一次。
        toast.error(t("saveFailed", { reason: String(cause?.message ?? cause) }));
      } finally {
        setPrefixBusy(false);
      }
    };

    const saveInstructions = async (draft) => {
      if (!writable) return;
      const next = normalizeCommitInstructions(draft);
      if (next === settings.commitInstructions) {
        setInstructionsDraft(null);
        return;
      }
      setSaveState("saving");
      try {
        await acceptConfigWrite(() => form.set("commitInstructions", next), "commitInstructions");
        // 保存期间用户又改了字，就别把他的新草稿一起清掉。
        setInstructionsDraft((current) => (current === draft ? null : current));
        setSaveState("saved");
      } catch (cause) {
        setSaveState("failed");
        toast.error(t("saveFailed", { reason: String(cause?.message ?? cause) }));
      }
    };

    // 停手 1.2 秒自动保存（与 Qoder 的节奏一致）；失焦时立即保存。
    React.useEffect(() => {
      if (instructionsDraft === null || !writable) return undefined;
      if (normalizeCommitInstructions(instructionsDraft) === settings.commitInstructions) return undefined;
      const timer = setTimeout(() => {
        void saveInstructions(instructionsDraft);
      }, COMMIT_INSTRUCTIONS_SAVE_DELAY_MS);
      return () => clearTimeout(timer);
    }, [instructionsDraft, writable, settings.commitInstructions]);

    const toggleForcePush = async (next) => {
      if (!writable || forceBusy) return;
      setForceDraft(next);
      setForceBusy(true);
      try {
        await acceptConfigWrite(() => form.set("alwaysForcePush", next), "alwaysForcePush");
        setForceDraft(null);
      } catch (cause) {
        setForceDraft(null);
        toast.error(t("saveFailed", { reason: String(cause?.message ?? cause) }));
      } finally {
        setForceBusy(false);
      }
    };

    const saveLabel = saveState === "saving"
      ? t("saving")
      : saveState === "saved"
        ? t("saved")
        : "";

    return (
      <main className="sk-git">
        <style>{CSS}</style>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        {writable ? null : <p className="sk-git__note" role="status">{t("readOnly")}</p>}

        <CardSection className="sk-git__groupLead" title={t("sectionTitle")} aria-label={t("sectionTitle")}>
          <Row
            title={t("branchPrefix")}
            description={t("branchPrefixDescription")}
            control={(
              <div className="sk-git__field">
                <input
                  type="text"
                  className="sk-git__input"
                  value={prefixValue}
                  maxLength={MAX_BRANCH_PREFIX_LENGTH}
                  placeholder={t("branchPrefixPlaceholder")}
                  aria-label={t("branchPrefix")}
                  aria-invalid={prefixError === "" ? "false" : "true"}
                  disabled={!writable || prefixBusy}
                  onChange={(event) => {
                    setPrefixDraft(event.target.value);
                    setPrefixError("");
                  }}
                  onBlur={() => void savePrefix()}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void savePrefix();
                  }}
                />
                {prefixError === "" ? null : <p className="sk-git__hint sk-git__hint--error">{prefixError}</p>}
              </div>
            )}
          />
          <Row
            title={t("alwaysForcePush")}
            description={t("alwaysForcePushDescription")}
            control={(
              <GitSwitch
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
              <div className="sk-ui-rowTitle">{t("commitInstructions")}</div>
              <p className="sk-ui-rowDesc">{t("commitInstructionsDescription")}</p>
            </div>
            <div className="sk-git__stackBody">
              <textarea
                rows={6}
                className="sk-git__textarea"
                value={instructionsValue}
                maxLength={MAX_COMMIT_INSTRUCTIONS_LENGTH}
                placeholder={t("commitInstructionsPlaceholder")}
                aria-label={t("commitInstructions")}
                disabled={!writable}
                onChange={(event) => {
                  setInstructionsDraft(event.target.value);
                  setSaveState("");
                }}
                onBlur={() => {
                  if (instructionsDraft !== null) void saveInstructions(instructionsDraft);
                }}
              />
              <div className="sk-git__meta">
                <span className={saveState === "failed" ? "sk-git__status sk-git__status--error" : "sk-git__status"}>
                  {saveLabel}
                </span>
                <span className="sk-git__count">
                  {t("count", { count: instructionsValue.length, max: MAX_COMMIT_INSTRUCTIONS_LENGTH })}
                </span>
              </div>
            </div>
          </div>
        </CardSection>
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
      return { form, entryId };
    },
  }, createGitSection(ctx));
}
