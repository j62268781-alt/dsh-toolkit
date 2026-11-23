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
  ["capability", "sectionCapability"],
  ["web", "sectionWeb"],
  ["artifact", "sectionArtifact"],
  ["source", "sectionSource"],
] as const;

function LinkActions({ url, t }: { url: string; t: any }) {
  const [open, setOpen] = React.useState(false);
  const { Menu, IconEllipsisOutlineRegular: MoreIcon, IconRightUpOutlineRegular: ExternalIcon } = primitives;
  const more = t("more");
  const external = t("external");
  const glyph = MoreIcon ? <MoreIcon size={14} /> : "…";
  if (!Menu) return <details className="sk-session-panel-row-actions">
    <summary className="sk-session-panel-more" aria-label={more} title={more}>{glyph}</summary>
    <a className="sk-session-panel-external" href={url} target="_blank" rel="noopener noreferrer">{external}</a>
  </details>;
  return <Menu
    className="sk-session-panel-row-actions"
    open={open}
    portal
    autoFocus
    align="end"
    onClose={() => setOpen(false)}
    anchor={<button type="button" className="sk-session-panel-more" aria-label={more} title={more}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{glyph}</button>}
    items={[{ id: "external", label: external, icon: ExternalIcon ? <ExternalIcon size={14} /> : undefined }]}
    onSelect={() => {
      setOpen(false);
      window.open(url, "_blank", "noopener,noreferrer");
    }}
  />;
}

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
  const capabilityType = entry.kind === "capability"
    ? t(entry.id.startsWith("mcp:") ? "capabilityMcp" : "capabilitySkill") : undefined;
  const status = unavailable ? t("artifactUnavailable") : entry.status === "failed" ? t("failedStatus") : undefined;
  const Icon = entry.kind === "capability"
    ? (entry.id.startsWith("mcp:") ? primitives.IconApiOutlineRegular : primitives.IconSparkleRegular)
    : entry.kind === "artifact" ? primitives.IconEditOutlineRegular
    : entry.kind === "source" ? (url ? primitives.IconLinkOutlineRegular : primitives.IconBrowseOutlineRegular)
      : (url ? primitives.IconGlobeOutlineRegular : primitives.IconSearchOutlineRegular);
  const content = <>
    <span data-row-part="icon" aria-hidden="true">{Icon ? <Icon size={16} /> : null}</span>
    <span data-row-part="content">{label}</span>
  </>;
  const open = unavailable || target === undefined ? undefined : url
    ? (openWeb && (() => openWeb(url))) : (openFile && (() => openFile(target)));
  return <div data-session-panel-row="" title={capabilityType ? `${capabilityType} · ${label}` : entry.detail || label}>
    {open ? <button type="button" data-row-part="body" onClick={open}>{content}</button>
      : url && !unavailable ? <a className="sk-session-panel-link" data-row-part="body" href={url} target="_blank" rel="noopener noreferrer">{content}</a>
        : <span data-row-part="body">{content}</span>}
    {status || capabilityType ? <span data-row-part="trailing">{status ?? capabilityType}</span> : null}
    {url && !unavailable && (entry.kind === "source" || entry.kind === "web") ? <LinkActions url={url} t={t} /> : null}
  </div>;
}

export function install(ctx: any) {
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
        // Browser is opt-in on Web. Check the live registration, not the profile name.
        const openWeb = tabs?.get?.("browser") && typeof sidebar?.openTabIn === "function" ? (url: string) => {
          sidebar.openTabIn(sessionId, "browser", { params: { url } });
          dismissOverlay();
        } : undefined;
        const expanded = expandedFor === sessionId;
        const foldable = typeof renderFactorySlot === "function" && entries.length > INITIAL_VISIBLE + 1;
        const shown = foldable && !expanded ? entries.slice(0, INITIAL_VISIBLE) : entries;
        const label = expanded ? t("collapse") : t("showMore", { n: entries.length - INITIAL_VISIBLE });
        return <>
          {shown.map((entry) => <Row key={`${sessionId}:${entry.id}`} entry={entry} openFile={openFile} openWeb={openWeb} t={t} />)}
          {foldable ? renderFactorySlot(FOLD, {
            expanded, label, name: `${label} · ${t(title)}`,
            onToggle: () => setExpandedFor(expanded ? undefined : sessionId),
          }) : null}
        </>;
      }
      ctx.slots.register({ name: SLOT, id: `dsh-toolkit-session-panel.${kind}`, order: 310 + index * 10, label: () => t(title), locale: TASK_MONITOR_NS }, Section);
    }
  });
}
