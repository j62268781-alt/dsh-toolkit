/**
 * 任务监控右栏 body：五个折叠分区（Skill 与 MCP / 产出 / 网页查阅 / 来源 / 知识），
 * 复刻 Qoder 任务监控的条目行规格——24px 图标座、12px 主文本、hover 底色、
 * 首屏 5 条 + 查看更多、手动来源 hover 移除。
 *
 * 数据来自本模块三条路由；环境条（分支 / 脏标记）复用 git 模块的快照路由，
 * 不在这里重跑 git。文件行点击走宿主右栏原生文件预览（fileAddressFor），
 * 网页行点击开右栏 browser tab——都是宿主自己的查看器，不另造 iframe。
 */
import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { confirmDialog } from "../../../../../client/ui/components/confirm-dialog/index.jsx";
import { toast } from "../../../../../client/ui/toast.js";
import { GIT_BRANCHES_PATH } from "../../../../git/client/constants.js";
import { TASK_MONITOR_NS } from "../../locale.js";
import {
  MAX_SOURCE_LENGTH,
  TASK_MONITOR_POLL_MS,
  TASK_MONITOR_SNAPSHOT_PATH,
  TASK_MONITOR_SOURCE_ADD_PATH,
  TASK_MONITOR_SOURCE_REMOVE_PATH,
  isHttpUrl,
  type TaskMonitorEntry,
  type TaskMonitorKind,
} from "../../constants.js";
import { groupSections, hiddenOf, timeLabel, visibleOf } from "../../model.js";
import panelCss from "./style.css";

export const NAME = "sidebar-tab";

const SECTION_COPY: Record<TaskMonitorKind, { title: string, desc: string, empty: string }> = {
  capability: { title: "sectionCapability", desc: "sectionCapabilityDesc", empty: "emptyCapability" },
  artifact: { title: "sectionArtifact", desc: "sectionArtifactDesc", empty: "emptyArtifact" },
  web: { title: "sectionWeb", desc: "sectionWebDesc", empty: "emptyWeb" },
  source: { title: "sectionSource", desc: "sectionSourceDesc", empty: "emptySource" },
  knowledge: { title: "sectionKnowledge", desc: "sectionKnowledgeDesc", empty: "emptyKnowledge" },
};

interface DialogState {
  readonly kind: "file" | "url";
  readonly draft: string;
  readonly error: string;
  readonly busy: boolean;
}

interface GitStrip {
  readonly branch: string;
  readonly dirty: boolean;
  readonly detached: boolean;
}

/** 懒 require：宿主模块表里有这个 util 才拿，拿不到文件行就只读不可点（降级不报错）。 */
function fileAddress(sessionId: string, cwd: string, path: string): string | undefined {
  try {
    const util = require("@deepseek-ai/dsh-util-workspace-path");
    return typeof util?.fileAddressFor === "function" ? util.fileAddressFor(sessionId, cwd, path) : undefined;
  } catch {
    return undefined;
  }
}

function reasonOf(payload: any, fallback: string): string {
  if (payload !== null && typeof payload === "object" && typeof payload.detail === "string" && payload.detail !== "") {
    return payload.detail;
  }
  return fallback;
}

export function createTaskMonitorPanel(ctx: any) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);
  const ChevronIcon = primitives.IconChevronDownOutlineRegular;
  const RefreshIcon = primitives.IconRefreshOutlineRegular;
  const PlusIcon = primitives.IconPlusOutlineRegular;
  const CloseIcon = primitives.IconCloseOutlineRegular;
  const BranchIcon = primitives.IconBranchOutlineRegular;
  const Menu = primitives.Menu;
  const MenuItemButton = primitives.MenuItemButton;
  const Button = primitives.Button ?? "button";
  const Input = primitives.Input;

  const SECTION_ICON: Record<TaskMonitorKind, any> = {
    capability: primitives.IconSparkleRegular,
    artifact: primitives.IconEditOutlineRegular,
    web: primitives.IconGlobeOutlineRegular,
    source: primitives.IconLinkOutlineRegular,
    knowledge: primitives.IconThinkOutlineRegular,
  };

  function rowIcon(entry: TaskMonitorEntry): any {
    if (entry.kind === "capability") {
      return entry.id.startsWith("mcp:") ? primitives.IconApiOutlineRegular : primitives.IconSparkleRegular;
    }
    if (entry.kind === "web") return entry.target === undefined ? primitives.IconSearchOutlineRegular : primitives.IconGlobeOutlineRegular;
    if (entry.kind === "source") {
      return entry.target !== undefined && isHttpUrl(entry.target) ? primitives.IconLinkOutlineRegular : primitives.IconBrowseOutlineRegular;
    }
    return SECTION_ICON[entry.kind];
  }

  return function TaskMonitorTab(props: any) {
    const { sessionId, useSessions, useProjection } = props;
    const info = typeof props.useTabInfo === "function" ? props.useTabInfo() : undefined;
    const tab = info?.tab;
    const visible = tab?.visible !== false;
    const actions = props.actions ?? tab?.actions;
    const revision = tab?.navigation?.revision ?? 0;
    const projected = typeof useProjection === "function" ? useProjection("workingDirectory") : undefined;
    const owned = typeof useSessions === "function"
      ? useSessions((snapshot: any) => snapshot?.byId?.[sessionId]?.cwd)
      : undefined;
    const cwd = typeof projected === "string" && projected !== "" ? projected : (typeof owned === "string" ? owned : "");

    const [entries, setEntries] = React.useState<TaskMonitorEntry[]>([]);
    const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = React.useState("");
    const [updatedAt, setUpdatedAt] = React.useState(0);
    const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [dialog, setDialog] = React.useState<DialogState | null>(null);
    const [git, setGit] = React.useState<GitStrip | null>(null);
    const [spinning, setSpinning] = React.useState(false);

    const load = React.useCallback(async (quiet: boolean) => {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (!quiet) setPhase("loading");
      try {
        const response = await fetchJson(TASK_MONITOR_SNAPSHOT_PATH, { json: { sessionId } });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(reasonOf(payload, `HTTP ${response.status}`));
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        setUpdatedAt(typeof payload.updatedAt === "number" ? payload.updatedAt : 0);
        setError("");
        setPhase("ready");
      } catch (caught: any) {
        // 静默轮询失败保留旧数据等下一轮；首屏 / 手动刷新失败才进错误态。
        if (!quiet) {
          setError(String(caught?.message ?? caught));
          setPhase("error");
        }
      }
    }, [sessionId]);

    const loadGit = React.useCallback(async () => {
      if (cwd === "") {
        setGit(null);
        return;
      }
      try {
        const response = await fetchJson(GIT_BRANCHES_PATH, { json: { cwd } });
        const payload = await response.json();
        if (response.ok && payload?.ok === true) {
          setGit({ branch: typeof payload.branch === "string" ? payload.branch : "", dirty: payload.dirty === true, detached: payload.detached === true });
        } else {
          setGit(null);
        }
      } catch {
        setGit(null);
      }
    }, [cwd]);

    React.useEffect(() => { void load(false); }, [load, revision]);
    React.useEffect(() => { void loadGit(); }, [loadGit]);
    React.useEffect(() => {
      if (!visible) return undefined;
      const timer = setInterval(() => { void load(true); }, TASK_MONITOR_POLL_MS);
      return () => clearInterval(timer);
    }, [visible, load]);

    const refresh = async (): Promise<void> => {
      setSpinning(true);
      await Promise.all([load(true), loadGit()]);
      setTimeout(() => setSpinning(false), 500);
    };

    const sections = React.useMemo(() => groupSections(entries), [entries]);

    const openEntry = (entry: TaskMonitorEntry): void => {
      if (entry.target === undefined || actions === undefined) return;
      if (isHttpUrl(entry.target)) {
        actions.openTab?.("browser", { params: { url: entry.target } });
        return;
      }
      const address = fileAddress(sessionId, cwd, entry.target);
      if (address !== undefined) actions.openResource?.(address);
    };

    const removeEntry = async (entry: TaskMonitorEntry): Promise<void> => {
      const before = entries;
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      try {
        const response = await fetchJson(TASK_MONITOR_SOURCE_REMOVE_PATH, { json: { sessionId, id: entry.id } });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(reasonOf(payload, `HTTP ${response.status}`));
        toast.success(t("removed"));
      } catch (caught: any) {
        setEntries(before);
        toast.error(t("removeFailed", { reason: String(caught?.message ?? caught) }));
      }
    };

    const submitSource = async (): Promise<void> => {
      if (dialog === null || dialog.busy) return;
      const value = dialog.draft.trim();
      if (value === "") {
        setDialog({ ...dialog, error: t(dialog.kind === "url" ? "invalidUrl" : "invalidFile") });
        return;
      }
      if (dialog.kind === "url" && !isHttpUrl(value)) {
        setDialog({ ...dialog, error: t("invalidUrl") });
        return;
      }
      setDialog({ ...dialog, busy: true, error: "" });
      try {
        const response = await fetchJson(TASK_MONITOR_SOURCE_ADD_PATH, { json: { sessionId, kind: dialog.kind, value } });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true || payload.entry === undefined) {
          throw new Error(reasonOf(payload, `HTTP ${response.status}`));
        }
        const entry = payload.entry as TaskMonitorEntry;
        setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry]);
        setDialog(null);
        toast.success(t("added"));
      } catch (caught: any) {
        setDialog((current) => current === null ? null : { ...current, busy: false, error: t("addFailed", { reason: String(caught?.message ?? caught) }) });
      }
    };

    const renderRow = (entry: TaskMonitorEntry, index: number): React.ReactNode => {
      const Icon = rowIcon(entry);
      const clickable = entry.target !== undefined && actions !== undefined;
      return (
        <div
          key={entry.id}
          className="sk-task-monitor__row"
          data-kind={entry.kind}
          data-status={entry.status}
          data-clickable={clickable || undefined}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
          title={entry.detail !== "" ? entry.detail : entry.label}
          onClick={clickable ? () => openEntry(entry) : undefined}
          onKeyDown={clickable ? (event: any) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openEntry(entry);
            }
          } : undefined}
        >
          <span className="sk-task-monitor__seat" aria-hidden="true">{Icon === undefined ? null : <Icon size={14} />}</span>
          <span className="sk-task-monitor__txt">
            <span className="sk-task-monitor__label">{entry.label}</span>
            {entry.detail !== "" && entry.detail !== entry.label
              ? <span className="sk-task-monitor__detail">{entry.detail}</span>
              : null}
          </span>
          <span className="sk-task-monitor__meta">
            {entry.status === "failed"
              ? <span className="sk-task-monitor__failed" title={t("failedStatus")} aria-label={t("failedStatus")}>!</span>
              : entry.count > 1 ? <span className="sk-task-monitor__times">{t("times", { n: entry.count })}</span> : null}
          </span>
          {entry.manual === true ? (
            <button
              type="button"
              className="sk-task-monitor__remove"
              aria-label={t("removeAria", { name: entry.label })}
              title={t("removeAria", { name: entry.label })}
              onClick={(event: any) => { event.stopPropagation(); void removeEntry(entry); }}
            >
              {CloseIcon === undefined ? "×" : <CloseIcon size={12} />}
            </button>
          ) : null}
        </div>
      );
    };

    const dialogInput = dialog === null ? null : (
      <div className="sk-task-monitor__creator">
        {Input === undefined ? (
          <input
            className="sk-task-monitor__fallbackInput"
            autoFocus
            value={dialog.draft}
            maxLength={MAX_SOURCE_LENGTH}
            placeholder={t(dialog.kind === "url" ? "linkPlaceholder" : "filePlaceholder")}
            aria-label={t(dialog.kind === "url" ? "linkTitle" : "fileTitle")}
            onChange={(event: any) => setDialog((current) => current === null ? null : { ...current, draft: event.target.value })}
            onKeyDown={(event: any) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitSource();
              }
            }}
          />
        ) : (
          <Input
            autoFocus
            value={dialog.draft}
            maxLength={MAX_SOURCE_LENGTH}
            placeholder={t(dialog.kind === "url" ? "linkPlaceholder" : "filePlaceholder")}
            aria-label={t(dialog.kind === "url" ? "linkTitle" : "fileTitle")}
            onChange={(event: any) => setDialog((current) => current === null ? null : { ...current, draft: event?.target?.value ?? "" })}
            onKeyDown={(event: any) => {
              if (event?.key === "Enter") {
                event.preventDefault();
                void submitSource();
              }
            }}
          />
        )}
        {dialog.error === "" ? null : <p className="sk-task-monitor__error" role="alert">{dialog.error}</p>}
      </div>
    );

    const dialogNode = dialog === null ? null : (primitives.Modal !== undefined ? confirmDialog({
      primitives,
      title: t(dialog.kind === "url" ? "linkTitle" : "fileTitle"),
      description: t(dialog.kind === "url" ? "linkDesc" : "fileDesc"),
      children: dialogInput,
      cancelLabel: t("cancel"),
      confirmLabel: t("add"),
      pending: dialog.busy,
      pendingLabel: t("adding"),
      onCancel: () => setDialog(null),
      onConfirm: () => { void submitSource(); },
    }) : (
      // 宿主没有 Modal 时降级成面板内联卡片，添加来源的主流程不断。
      <div className="sk-task-monitor__dialog" role="dialog" aria-label={t(dialog.kind === "url" ? "linkTitle" : "fileTitle")}>
        <p className="sk-task-monitor__dialogTitle">{t(dialog.kind === "url" ? "linkTitle" : "fileTitle")}</p>
        {Menu === undefined ? (
          <div className="sk-task-monitor__dialogKinds" role="group" aria-label={t("addSource")}>
            <button type="button" data-active={dialog.kind === "file" || undefined} onClick={() => setDialog({ ...dialog, kind: "file", error: "" })}>{t("addFile")}</button>
            <button type="button" data-active={dialog.kind === "url" || undefined} onClick={() => setDialog({ ...dialog, kind: "url", error: "" })}>{t("addLink")}</button>
          </div>
        ) : null}
        {dialogInput}
        <div className="sk-task-monitor__dialogFoot">
          <Button variant="outline" onClick={() => setDialog(null)} disabled={dialog.busy}>{t("cancel")}</Button>
          <Button variant="primary" onClick={() => { void submitSource(); }} disabled={dialog.busy}>
            {dialog.busy ? t("adding") : t("add")}
          </Button>
        </div>
      </div>
    ));

    return (
      <div className="sk-task-monitor" data-phase={phase}>
        <style>{panelCss}</style>
        <header className="sk-task-monitor__head">
          <span className="sk-task-monitor__title">{t("tabTitle")}</span>
          <span className="sk-task-monitor__headTools">
            {phase === "ready" && updatedAt > 0 ? <span className="sk-task-monitor__stamp">{timeLabel(updatedAt)}</span> : null}
            <button
              type="button"
              className="sk-task-monitor__refresh"
              data-spinning={spinning || undefined}
              aria-label={t("refresh")}
              title={t("refresh")}
              onClick={() => { void refresh(); }}
            >
              {RefreshIcon === undefined ? "↻" : <RefreshIcon size={14} />}
            </button>
          </span>
        </header>
        {git !== null ? (
          <div className="sk-task-monitor__git" title={git.dirty ? t("gitDirty") : t("gitClean")}>
            <span className="sk-task-monitor__gitIcon" aria-hidden="true">{BranchIcon === undefined ? null : <BranchIcon size={14} />}</span>
            <span className="sk-task-monitor__gitName">{git.detached ? "HEAD" : git.branch}</span>
            <span className="sk-task-monitor__gitDot" data-dirty={git.dirty || undefined} />
          </div>
        ) : null}
        {phase === "loading" ? (
          <div className="sk-task-monitor__skeleton" role="status" aria-label={t("loading")}>
            {[0, 1, 2].map((section) => (
              <div className="sk-task-monitor__skSection" key={section}>
                <span className="sk-task-monitor__skBar sk-task-monitor__skBar--title" />
                <span className="sk-task-monitor__skBar" />
                <span className="sk-task-monitor__skBar" />
              </div>
            ))}
          </div>
        ) : phase === "error" ? (
          <div className="sk-task-monitor__errorBox" role="alert">
            <p>{t("loadFailed", { reason: error })}</p>
            <Button variant="primary" onClick={() => { void load(false); }}>{t("retry")}</Button>
          </div>
        ) : (
          sections.map((section) => {
            const copy = SECTION_COPY[section.kind];
            const isCollapsed = collapsed[section.kind] === true;
            const isExpanded = expanded[section.kind] === true;
            const hidden = hiddenOf(section.entries, isExpanded);
            const SectionIcon = SECTION_ICON[section.kind];
            return (
              <section className="sk-task-monitor__section" data-kind={section.kind} key={section.kind}>
                <div className="sk-task-monitor__headRow">
                  <button
                    type="button"
                    className="sk-task-monitor__trigger"
                    aria-expanded={!isCollapsed}
                    title={t(copy.desc)}
                    onClick={() => setCollapsed((current) => ({ ...current, [section.kind]: !isCollapsed }))}
                  >
                    <span className="sk-task-monitor__chevron" data-open={!isCollapsed || undefined} aria-hidden="true">
                      {ChevronIcon === undefined ? null : <ChevronIcon size={12} />}
                    </span>
                    <span className="sk-task-monitor__sectionIcon" aria-hidden="true">{SectionIcon === undefined ? null : <SectionIcon size={14} />}</span>
                    <span className="sk-task-monitor__sectionTitle">{t(copy.title)}</span>
                    <span className="sk-task-monitor__count">{section.entries.length}</span>
                  </button>
                  {section.kind === "source" ? (
                    Menu === undefined ? (
                      <button
                        type="button"
                        className="sk-task-monitor__add"
                        aria-label={t("addSource")}
                        title={t("addSource")}
                        onClick={() => setDialog({ kind: "url", draft: "", error: "", busy: false })}
                      >
                        {PlusIcon === undefined ? "+" : <PlusIcon size={12} />}
                      </button>
                    ) : (
                      <Menu
                        open={menuOpen}
                        portal
                        align="end"
                        dense
                        onClose={() => setMenuOpen(false)}
                        anchor={
                          <button
                            type="button"
                            className="sk-task-monitor__add"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label={t("addSource")}
                            title={t("addSource")}
                            onClick={() => setMenuOpen((value) => !value)}
                          >
                            {PlusIcon === undefined ? "+" : <PlusIcon size={12} />}
                          </button>
                        }
                        items={[
                          { id: "file", label: t("addFile") },
                          { id: "link", label: t("addLink") },
                        ]}
                        onSelect={(id: string) => {
                          setMenuOpen(false);
                          setDialog({ kind: id === "file" ? "file" : "url", draft: "", error: "", busy: false });
                        }}
                      />
                    )
                  ) : null}
                </div>
                {isCollapsed ? null : (
                  <div className="sk-task-monitor__body">
                    {section.entries.length === 0 ? (
                      <p className="sk-task-monitor__empty">{t(copy.empty)}</p>
                    ) : (
                      <>
                        {visibleOf(section.entries, isExpanded).map(renderRow)}
                        {hidden > 0 ? (
                          <button
                            type="button"
                            className="sk-task-monitor__more"
                            onClick={() => setExpanded((current) => ({ ...current, [section.kind]: true }))}
                          >
                            {t("showMore", { n: hidden })}
                          </button>
                        ) : isExpanded && section.entries.length > 5 ? (
                          <button
                            type="button"
                            className="sk-task-monitor__more"
                            onClick={() => setExpanded((current) => ({ ...current, [section.kind]: false }))}
                          >
                            {t("collapse")}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}
        {dialogNode}
      </div>
    );
  };
}
