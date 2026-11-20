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
import { showToast } from "../../../../../client/ui/toast.js";
import { setHasContent } from "../../state/content.js";
import { GIT_BRANCHES_PATH, GIT_CHANGES_PATH } from "../../../../git/client/constants.js";
import { TASK_MONITOR_NS } from "../../locale.js";
import {
  TASK_MONITOR_POLL_MS,
  TASK_MONITOR_SNAPSHOT_PATH,
  isHttpUrl,
  type TaskMonitorEntry,
  type TaskMonitorSectionKind,
} from "../../constants.js";
import { changesReviewAddress, fileAddressFor, groupSections, hiddenOf, visibleOf } from "../../model.js";
import panelCss from "./style.css";

export const NAME = "panel";

const SECTION_COPY: Record<TaskMonitorSectionKind, { title: string, desc: string, empty: string }> = {
  capability: { title: "sectionCapability", desc: "sectionCapabilityDesc", empty: "emptyCapability" },
  artifact: { title: "sectionArtifact", desc: "sectionArtifactDesc", empty: "emptyArtifact" },
  web: { title: "sectionWeb", desc: "sectionWebDesc", empty: "emptyWeb" },
  source: { title: "sectionSource", desc: "sectionSourceDesc", empty: "emptySource" },
};

interface ChangesStat {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly untracked: number;
}

interface GitStrip {
  readonly branch: string;
  readonly dirty: boolean;
  readonly detached: boolean;
  /** 工作区增删行数；读不到（不是仓库、没装 git）时为 null，这一行退回「有未提交改动」。 */
  readonly changes: ChangesStat | null;
}

/** `+1234` 这种数字在 12px 行里挤，四位数以上用「1.2k」。 */
function compactCount(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}k`;
}

function changesOf(payload: any): ChangesStat | null {
  if (payload === null || typeof payload !== "object" || payload.ok !== true) return null;
  const read = (value: any): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);
  return { files: read(payload.files), insertions: read(payload.insertions), deletions: read(payload.deletions), untracked: read(payload.untracked) };
}

/** 官方审查 tab 的坐标（`workspace/changes` 的 seq 与 turn）；没有就不做可点。 */
function reviewOf(payload: any): { seq: number; turn: number } | null {
  const value = payload?.review;
  if (value === null || typeof value !== "object") return null;
  const { seq, turn } = value;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0) return null;
  if (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn <= 0) return null;
  return { seq, turn };
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
    const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const [git, setGit] = React.useState<GitStrip | null>(null);
    const [review, setReview] = React.useState<{ seq: number; turn: number } | null>(null);

    const load = React.useCallback(async (quiet: boolean) => {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (!quiet) setPhase("loading");
      try {
        const response = await fetchJson(TASK_MONITOR_SNAPSHOT_PATH, { json: { sessionId } });
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) throw new Error(reasonOf(payload, `HTTP ${response.status}`));
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        setReview(reviewOf(payload));
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

    // 新会话没有任何条目时不该显示这条栏：把「有没有内容」报给 state/content，
    // 会话内右栏和标题行按钮都按它决定是否出现。只认 ready——加载中 / 出错时
    // 还没结论，保持沉默（那边按 undefined 当成「有内容」处理）。
    React.useEffect(() => {
      if (phase !== "ready") return;
      setHasContent(sessionId, entries.length > 0);
    }, [phase, entries.length, sessionId]);

    const loadGit = React.useCallback(async () => {
      if (cwd === "") {
        setGit(null);
        return;
      }
      try {
        // 分支快照与改动统计各自独立：统计失败不该把分支行一起抹掉（反之亦然）。
        const [branchResponse, changesResponse] = await Promise.all([
          fetchJson(GIT_BRANCHES_PATH, { json: { cwd } }),
          fetchJson(GIT_CHANGES_PATH, { json: { cwd } }).catch(() => null),
        ]);
        const payload = await branchResponse.json();
        if (!branchResponse.ok || payload?.ok !== true) {
          setGit(null);
          return;
        }
        let changes: ChangesStat | null = null;
        if (changesResponse?.ok === true) {
          changes = changesOf(await changesResponse.json().catch(() => null));
        }
        setGit({
          branch: typeof payload.branch === "string" ? payload.branch : "",
          dirty: payload.dirty === true,
          detached: payload.detached === true,
          changes,
        });
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

    const sections = React.useMemo(() => groupSections(entries), [entries]);

    // 默认开合只定一次（每个会话第一次拿到快照时）：环境信息常开，其余分区
    // 有数据展开、没数据收起。之后无论数据怎么变、用户怎么点，都不再重算——
    // 否则面板会自己跳，用户刚展开的空分区又会被合上。
    const seeded = React.useRef<string | null>(null);
    React.useEffect(() => {
      if (phase !== "ready" || seeded.current === sessionId) return;
      seeded.current = sessionId;
      const seed: Record<string, boolean> = {};
      for (const section of sections) {
        if (section.entries.length === 0) seed[section.kind] = true;
      }
      setCollapsed(seed);
    }, [phase, sections, sessionId]);

    const openEntry = (entry: TaskMonitorEntry): void => {
      if (entry.target === undefined || actions === undefined) return;
      if (isHttpUrl(entry.target)) {
        actions.openTab?.("browser", { params: { url: entry.target } });
        return;
      }
      actions.openResource?.(fileAddressFor(sessionId, cwd, entry.target));
    };

    const renderRow = (entry: TaskMonitorEntry, index: number): React.ReactNode => {
      const Icon = rowIcon(entry);
      const unavailable = entry.kind === "artifact" && entry.unavailable === true;
      const clickable = !unavailable && entry.target !== undefined && actions !== undefined;
      const webUrl = entry.kind === "web" && entry.target !== undefined && isHttpUrl(entry.target)
        ? entry.target : undefined;
      const label = webUrl ?? entry.label;
      // 文件路径和网页链接不占第二行；技能与 MCP 的副标题仍提供补充信息。
      const showDetail = entry.detail !== "" && entry.detail !== label
        && entry.kind !== "artifact" && entry.kind !== "source" && entry.kind !== "web";
      return (
        <div
          key={entry.id}
          className="sk-task-monitor__row"
          data-kind={entry.kind}
          data-status={entry.status}
          data-unavailable={unavailable || undefined}
          data-clickable={clickable || undefined}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
          title={entry.kind === "web" || entry.detail === "" ? label : entry.detail}
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
            <span className="sk-task-monitor__label">{label}</span>
            {showDetail
              ? <span className="sk-task-monitor__detail">{entry.detail}</span>
              : null}
          </span>
          <span className="sk-task-monitor__meta">
            {unavailable ? <span className="sk-task-monitor__unavailable">{t("artifactUnavailable")}</span> : null}
            {entry.status === "failed"
              ? <span className="sk-task-monitor__failed" title={t("failedStatus")} aria-label={t("failedStatus")}>!</span>
              : null}
          </span>
        </div>
      );
    };

    // 环境信息不是监控条目：状态/位置/分支/目录都来自当前会话，行不可点。
    const envRows: React.ReactNode[] = [];
    if (git !== null) {
      const stat = git.changes;
      const delta = stat === null ? 0 : stat.insertions + stat.deletions;
      // 只有未跟踪文件（或二进制改动）时 numstat 是 0 行，这时仍然要承认「有改动」。
      const changed = stat !== null && stat.files > 0;
      const counted = changed && delta > 0;
      const StatusIcon = changed || git.dirty ? ChecklistIcon : CheckCircleIcon;
      // 只留「新文件 n」：未跟踪文件不在 +N −M 里，得让用户知道差在哪；
      // 单纯的「n 个文件」和下面「产出」分区重复，不再显示。
      const detail = !changed || stat.untracked === 0 ? null : t("envUntracked", { n: String(stat.untracked) });
      // 有改动且有审查坐标时这一行可点：装着官方「代码审查和变更」就直接开那次审查，
      // 没装就弹一条 toast 告诉用户去开——不做成死行，否则用户只会觉得点了没反应。
      const canReview = changed && review !== null;
      const openReview = !canReview ? undefined : typeof actions?.openReview === "function"
        ? () => actions.openReview(changesReviewAddress(sessionId, review.seq, review.turn))
        : () => showToast(t("reviewDisabled"), { tone: "info" });
      envRows.push(
        <div
          className="sk-task-monitor__row"
          data-kind="environment"
          key="status"
          data-clickable={openReview === undefined ? undefined : true}
          role={openReview === undefined ? undefined : "button"}
          tabIndex={openReview === undefined ? undefined : 0}
          title={git.dirty ? t("gitDirty") : t("gitClean")}
          onClick={openReview}
          onKeyDown={openReview === undefined ? undefined : (event: any) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openReview();
            }
          }}
        >
          <span className="sk-task-monitor__seat" aria-hidden="true">{StatusIcon === undefined ? null : <StatusIcon size={14} />}</span>
          <span className="sk-task-monitor__txt">
            {counted
              ? <span className="sk-task-monitor__label sk-task-monitor__delta">
                  <span className="sk-task-monitor__added">+{compactCount(stat.insertions)}</span>
                  <span className="sk-task-monitor__deleted">−{compactCount(stat.deletions)}</span>
                </span>
              : <span className="sk-task-monitor__label">{git.dirty || changed ? t("envDirty") : t("envClean")}</span>}
            {detail === null ? null : <span className="sk-task-monitor__detail">{detail}</span>}
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

    const chevron = (
      <span className="sk-task-monitor__chevron" aria-hidden="true">
        {ChevronIcon === undefined ? null : <ChevronIcon size={12} />}
      </span>
    );

    // summary 的默认开合由浏览器完成；这里 preventDefault 后自己写状态，
    // 一是让 React 的 open 属性始终是唯一来源（轮询重渲染不会把开合状态抹掉），
    // 二是保住 jsdom 下可测的 aria-expanded。
    const toggle = (key: string, current: boolean) => (event: any): void => {
      event.preventDefault();
      setCollapsed((map) => ({ ...map, [key]: !current }));
    };

    return (
      <div className="sk-task-monitor" data-phase={phase} data-empty={phase === "ready" && entries.length === 0 ? "true" : undefined}>
        <style>{panelCss}</style>
        {envRows.length === 0 ? null : (
          <details
            className="sk-task-monitor__section"
            data-kind="environment"
            open={!envCollapsed}
          >
            <summary
              className="sk-task-monitor__trigger"
              aria-expanded={!envCollapsed}
              title={t("envTitle")}
              onClick={toggle("environment", envCollapsed)}
            >
              <span className="sk-task-monitor__sectionTitle">{t("envTitle")}</span>
              {chevron}
            </summary>
            <div className="sk-task-monitor__body">{envRows}</div>
          </details>
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
            const paged = section.kind !== "source";
            const isExpanded = !paged || expanded[section.kind] === true;
            const hidden = hiddenOf(section.entries, isExpanded);
            return (
              <details
                className="sk-task-monitor__section"
                data-kind={section.kind}
                key={section.kind}
                open={!isCollapsed}
              >
                <summary
                  className="sk-task-monitor__trigger"
                  aria-expanded={!isCollapsed}
                  title={t(copy.desc)}
                  onClick={toggle(section.kind, isCollapsed)}
                >
                  <span className="sk-task-monitor__sectionTitle">{t(copy.title)}</span>
                  <span className="sk-task-monitor__tag">{section.entries.length}</span>
                  {chevron}
                </summary>
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
                      ) : paged && isExpanded && section.entries.length > 5 ? (
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
              </details>
            );
          })
        )}
      </div>
    );
  };
}
