import { isDesktopShell } from "./platform.js";

// Shared state keeps the 296 → 52 → 0 → 296 sidebar cycle consistent across both installers.
const SIDEBAR_W = "296px";
const RAIL_W = "52px";
let frameEl = null;

let workspaceCollapsed = false;

let widthPass = null;

let collapseSync = null;

function isHomeView(ctx) {
  try {
    const info = ctx.layout?.panelInfo;
    return info ? info.getSnapshot()?.activePanelId == null : true;
  } catch {
    return true;
  }
}

function findFrame() {
  if (frameEl && frameEl.isConnected) return frameEl;

  frameEl =
    [...document.querySelectorAll('[class*="_frame"]')].find((el) =>
      el.style?.gridTemplateColumns?.includes("minmax("),
    ) ?? null;
  return frameEl;
}

export function installSidebarWidth(ctx) {
  let queued = 0;
  let offPanel = null;

  const pass = () => {
    queued = 0;

    if (!isDesktopShell()) return;
    const frame = findFrame();
    if (!frame) return;
    const cols = frame.style.gridTemplateColumns;
    if (!cols) return;

    const collapsed = frame.hasAttribute("data-sidebar-collapsed");
    const home = isHomeView(ctx);
    const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
    if (root) {

      const railOnly = !collapsed && (!home || workspaceCollapsed);
      if (railOnly && !root.hasAttribute("data-sk-rail-only")) {
        root.setAttribute("data-sk-rail-only", "");
      } else if (!railOnly && root.hasAttribute("data-sk-rail-only")) {
        root.removeAttribute("data-sk-rail-only");
      }
    }

    const target = collapsed
      ? "0px"
      : home && !workspaceCollapsed
        ? SIDEBAR_W
        : RAIL_W;
    const next = cols.replace(/^[\d.]+px/, target);
    if (next !== cols) frame.style.gridTemplateColumns = next;
    collapseSync?.();
  };

  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };

  widthPass = pass;

  // Correct host grid rewrites before paint; debounce other mutations with rAF.
  const observer = new MutationObserver((mutations) => {
    const frameRewritten = mutations.some(
      (m) => m.type === "attributes" && m.attributeName === "style" && m.target === frameEl,
    );
    if (frameRewritten) pass();
    else schedule();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "data-sidebar-collapsed"],
  });

  const platformObserver = new MutationObserver(schedule);
  platformObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-platform", "data-windows-titlebar"],
  });
  window.addEventListener("resize", schedule);

  const info = ctx.layout?.panelInfo;
  if (info && typeof info.subscribe === "function") offPanel = info.subscribe(schedule);

  pass();

  return () => {
    observer.disconnect();
    platformObserver.disconnect();
    window.removeEventListener("resize", schedule);
    if (typeof offPanel === "function") offPanel();
    if (queued) cancelAnimationFrame(queued);
    frameEl = null;
  };
}

export function installWorkspaceCollapse(ctx) {

  // Match the structural class, since accessible labels change with locale.
  const isToggleButton = (btn) =>
    [...btn.classList].some((name) => name.includes("_toggle"));

  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "sk-collapse-hit";
  hit.setAttribute("aria-label", "收起侧边栏");
  hit.title = "收起侧边栏";
  document.body.appendChild(hit);

  const sync = () => {
    const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
    const frame = findFrame();
    const collapsed = !!frame && frame.hasAttribute("data-sidebar-collapsed");
    const railOnly = !!root && root.hasAttribute("data-sk-rail-only");
    hit.toggleAttribute("data-show", railOnly && !collapsed);
  };
  collapseSync = sync;

  let wasCollapsed = false;
  const stateObserver = new MutationObserver(() => {
    const frame = findFrame();
    const collapsed = !!frame && frame.hasAttribute("data-sidebar-collapsed");
    if (wasCollapsed && !collapsed && workspaceCollapsed) {
      workspaceCollapsed = false;
      widthPass?.();
    }
    wasCollapsed = collapsed;
  });
  stateObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-sidebar-collapsed"],
    subtree: true,
  });

  const onClick = (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const btn = el.closest("button");
    if (!btn) return;

    const frame = findFrame();
    if (!frame) return;
    const collapsed = frame.hasAttribute("data-sidebar-collapsed");

    if (btn === hit) {
      event.preventDefault();
      event.stopPropagation();
      ctx.layout?.toggleSidebar?.();
      return;
    }

    if (btn.classList.contains("sk-home")) {
      if (workspaceCollapsed) {
        workspaceCollapsed = false;
        widthPass?.();
      }
      return;
    }

    if (!collapsed && !workspaceCollapsed && isHomeView(ctx) && isToggleButton(btn)) {
      event.preventDefault();
      event.stopPropagation();
      workspaceCollapsed = true;
      widthPass?.();
    }
  };

  document.addEventListener("click", onClick, true);
  sync();
  return () => {
    document.removeEventListener("click", onClick, true);
    stateObserver.disconnect();
    collapseSync = null;
    hit.remove();
  };
}
