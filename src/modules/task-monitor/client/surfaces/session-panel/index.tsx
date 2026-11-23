/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";
import { INITIAL_VISIBLE, isHttpUrl, type TaskMonitorEntry } from "../../constants.js";
import { TASK_MONITOR_NS } from "../../locale.js";
import { fileAddressFor, groupSections } from "../../model.js";
import { useSnapshot } from "../../state/snapshot.js";

export const NAME = "session-panel";
const SLOT = "conversation.session.panel.section";
const FOLD = "conversation.session.panel.fold";
const SECTIONS = [
  ["web", "sectionWeb"],
  ["artifact", "sectionArtifact"],
  ["source", "sectionSource"],
] as const;

function Row({ entry, openFile, openWeb, t }: {
  entry: TaskMonitorEntry;
  openFile?: (path: string) => void;
  openWeb?: (url: string) => void;
  t: any;
}) {
  const target = entry.target;
  const url = target !== undefined && isHttpUrl(target) ? target : undefined;
  const label = (entry.kind === "web" ? url : undefined) ?? entry.label;
  const unavailable = entry.unavailable === true;
  const Icon = entry.kind === "artifact" ? primitives.IconEditOutlineRegular
    : entry.kind === "source" ? (url ? primitives.IconLinkOutlineRegular : primitives.IconBrowseOutlineRegular)
      : (url ? primitives.IconGlobeOutlineRegular : primitives.IconSearchOutlineRegular);
  const content = <>
    <span data-row-part="icon" aria-hidden="true">{Icon ? <Icon size={16} /> : null}</span>
    <span data-row-part="content">{label}</span>
  </>;
  const open = unavailable || target === undefined ? undefined : url
    ? (openWeb && (() => openWeb(url))) : (openFile && (() => openFile(target)));
  return <div data-session-panel-row="" title={entry.detail || label}>
    {open ? <button type="button" data-row-part="body" onClick={open}>{content}</button>
      : url && !unavailable ? <a className="sk-task-monitor-panel-link" data-row-part="body" href={url} target="_blank" rel="noopener noreferrer">{content}</a>
        : <span data-row-part="body">{content}</span>}
    {unavailable || entry.status === "failed" ? <span data-row-part="trailing">
      {t(unavailable ? "artifactUnavailable" : "failedStatus")}
    </span> : null}
  </div>;
}

export function install(ctx: any, setAvailable: (available: boolean) => void) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);
  return ctx.slots.inject(SLOT, () => {
    for (const [index, [kind, title]] of SECTIONS.entries()) {
      function Section({ sessionId, useProjection, useSessions, dismissOverlay, renderFactorySlot }: any) {
        const snapshot = useSnapshot(sessionId);
        const [expandedFor, setExpandedFor] = React.useState<string>();
        const projected = useProjection("workingDirectory");
        const createdIn = useSessions((data: any) => data.byId[sessionId]?.cwd);
        const entries = React.useMemo(() => groupSections(snapshot?.entries ?? [])
          .find((section) => section.kind === kind)?.entries ?? [], [snapshot]);
        if (entries.length === 0) return null;
        const cwd = projected ?? createdIn ?? "";
        const sidebar = ctx.get?.("sidebarRight");
        const tabs = ctx.get?.("sidebarRightTabs");
        const openFile = typeof sidebar?.openResourceIn === "function" ? (path: string) => {
          sidebar.openResourceIn(sessionId, fileAddressFor(sessionId, cwd, path));
          dismissOverlay();
        } : undefined;
        // Web ships without the optional Browser tab. Use a real external link in that case.
        const openWeb = tabs?.get?.("browser") && typeof sidebar?.openTabIn === "function" ? (url: string) => {
          sidebar.openTabIn(sessionId, "browser", { params: { url } });
          dismissOverlay();
        } : undefined;
        const expanded = expandedFor === sessionId;
        const foldable = typeof renderFactorySlot === "function" && entries.length > INITIAL_VISIBLE + 1;
        const shown = foldable && !expanded ? entries.slice(0, INITIAL_VISIBLE) : entries;
        const label = expanded ? t("collapse") : t("showMore", { n: entries.length - INITIAL_VISIBLE });
        return <>
          {shown.map((entry) => <Row key={entry.id} entry={entry} openFile={openFile} openWeb={openWeb} t={t} />)}
          {foldable ? renderFactorySlot(FOLD, {
            expanded, label, name: `${label} · ${t(title)}`,
            onToggle: () => setExpandedFor(expanded ? undefined : sessionId),
          }) : null}
        </>;
      }
      ctx.slots.register({ name: SLOT, id: `dsh-toolkit-task-monitor.${kind}`, order: 310 + index * 10, label: () => t(title), locale: TASK_MONITOR_NS }, Section);
    }
    setAvailable(true);
    return () => setAvailable(false);
  });
}
