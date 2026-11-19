/**
 * 任务监控面板：只读展示当前会话用过的能力、产出、网页与来源。
 *
 * 分区复刻 Qoder 任务监控的条目行规格——24px 图标座、12px 主文本、hover 底色、
 * 首屏 5 条 + 查看更多；顶部「环境信息」把 git 状态/分支与 cwd 目录并成一栏，
 * 不再单独画一条 git 条。面板不提供添加/移除入口，数据由 host 聚合。
 *
 * 数据来自本模块的 snapshot 路由；环境信息复用 git 模块的分支快照，不在这里
 * 重跑 git。文件行点击走宿主右栏原生文件预览（fileAddressFor），网页行点击开
 * 右栏 browser tab——都是宿主自己的查看器，不另造 iframe。
 */
import React from "react";
import { fetchJson } from "../../../../../client/http.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { GIT_BRANCHES_PATH } from "../../../../git/client/constants.js";
import { TASK_MONITOR_NS } from "../../locale.js";
import {
  TASK_MONITOR_POLL_MS,
  TASK_MONITOR_SNAPSHOT_PATH,
  isHttpUrl,
  type TaskMonitorEntry,
  type TaskMonitorSectionKind,
} from "../../constants.js";
import { groupSections, hiddenOf, timeLabel, visibleOf } from "../../model.js";
import panelCss from "./style.css";

export const NAME = "panel";

const SECTION_COPY: Record<TaskMonitorSectionKind, { title: string, desc: string, empty: string }> = {
  capability: { title: "sectionCapability", desc: "sectionCapabilityDesc", empty: "emptyCapability" },
  artifact: { title: "sectionArtifact", desc: "sectionArtifactDesc", empty: "emptyArtifact" },
  web: { title: "sectionWeb", desc: "sectionWebDesc", empty: "emptyWeb" },
  source: { title: "sectionSource", desc: "sectionSourceDesc", empty: "emptySource" },
};

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

function dirNameOf(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part !== "");
  return parts.length === 0 ? "" : parts[parts.length - 1];
}

export function createTaskMonitorPanel(ctx: any) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);
  const ChevronIcon = primitives.IconChevronDownOutlineRegular;
  const RefreshIcon = primitives.IconRefreshOutlineRegular;
  const BranchIcon = primitives.IconBranchOutlineRegular;
  const ChecklistIcon = primitives.IconChecklistOutlineRegular;
  const CheckCircleIcon = primitives.IconCheckCircleOutlineRegular;
  const FolderIcon = primitives.IconFolderOpenOutlineRegular;
  const TreeIcon = primitives.IconWorkspaceTreeOutlineRegular;
  const Button = primitives.Button ?? "button";

  const SECTION_ICON: Record<TaskMonitorSectionKind, any> = {
    capability: primitives.IconSparkleRegular,
    artifact: primitives.IconEditOutlineRegular,
    web: primitives.IconGlobeOutlineRegular,
    source: primitives.IconLinkOutlineRegular,
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

  return function TaskMonitorPanel(props: any) {
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
        </div>
      );
    };

    // 环境信息不是监控条目：状态/位置/分支/目录都来自当前会话，行不可点。
    const envRows: React.ReactNode[] = [];
    if (git !== null) {
      const StatusIcon = git.dirty ? ChecklistIcon : CheckCircleIcon;
      envRows.push(
        <div className="sk-task-monitor__row" data-kind="environment" key="status" title={git.dirty ? t("gitDirty") : t("gitClean")}>
          <span className="sk-task-monitor__seat" aria-hidden="true">{StatusIcon === undefined ? null : <StatusIcon size={14} />}</span>
          <span className="sk-task-monitor__txt">
            <span className="sk-task-monitor__label">{git.dirty ? t("envDirty") : t("envClean")}</span>
          </span>
        </div>,
      );
    }
    envRows.push(
      <div className="sk-task-monitor__row" data-kind="environment" key="local">
        <span className="sk-task-monitor__seat" aria-hidden="true">{FolderIcon === undefined ? null : <FolderIcon size={14} />}</span>
        <span className="sk-task-monitor__txt">
          <span className="sk-task-monitor__label">{t("envLocal")}</span>
        </span>
      </div>,
    );
    if (git !== null) {
      envRows.push(
        <div className="sk-task-monitor__row" data-kind="environment" key="branch" title={git.branch}>
          <span className="sk-task-monitor__seat" aria-hidden="true">{BranchIcon === undefined ? null : <BranchIcon size={14} />}</span>
          <span className="sk-task-monitor__txt">
            <span className="sk-task-monitor__label">{git.detached ? "HEAD" : git.branch}</span>
          </span>
        </div>,
      );
    }
    const dirName = dirNameOf(cwd);
    if (dirName !== "") {
      envRows.push(
        <div className="sk-task-monitor__row" data-kind="environment" key="dir" title={cwd}>
          <span className="sk-task-monitor__seat" aria-hidden="true">{TreeIcon === undefined ? null : <TreeIcon size={14} />}</span>
          <span className="sk-task-monitor__txt">
            <span className="sk-task-monitor__label">{dirName}</span>
          </span>
        </div>,
      );
    }

    const envCollapsed = collapsed.environment === true;

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
        {envRows.length === 0 ? null : (
          <section className="sk-task-monitor__section" data-kind="environment" key="environment">
            <div className="sk-task-monitor__headRow">
              <button
                type="button"
                className="sk-task-monitor__trigger"
                aria-expanded={!envCollapsed}
                title={t("envTitle")}
                onClick={() => setCollapsed((current) => ({ ...current, environment: !envCollapsed }))}
              >
                <span className="sk-task-monitor__chevron" data-open={!envCollapsed || undefined} aria-hidden="true">
                  {ChevronIcon === undefined ? null : <ChevronIcon size={12} />}
                </span>
                <span className="sk-task-monitor__sectionIcon" aria-hidden="true">{FolderIcon === undefined ? null : <FolderIcon size={14} />}</span>
                <span className="sk-task-monitor__sectionTitle">{t("envTitle")}</span>
              </button>
            </div>
            {envCollapsed ? null : <div className="sk-task-monitor__body">{envRows}</div>}
          </section>
        )}
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
      </div>
    );
  };
}
