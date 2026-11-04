import { isDesktopShell } from "./platform.js";

// Keep the workspace width independent of the rail → hidden collapse cycle.
const RAIL_WIDTH = 52;
const WORKSPACE_MIN = 250;
const WORKSPACE_MAX = 450;
const RAIL_W = `${RAIL_WIDTH}px`;
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
  let workspaceWidth = WORKSPACE_MIN;
  let drag = null;
  const handles = new Map();

  const finishDrag = () => {
    if (!drag) return;
    const { handle, pointerId, frame } = drag;
    drag = null;
    frame.removeAttribute("data-dragging");
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
  };

  const pass = () => {
    if (queued) cancelAnimationFrame(queued);
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

    const expanded = !collapsed && home && !workspaceCollapsed;
    frame.toggleAttribute("data-sk-workspace-expanded", expanded);
    if (!expanded) finishDrag();
    const target = collapsed
      ? "0px"
      : expanded
        ? `${RAIL_WIDTH + workspaceWidth}px`
        : RAIL_W;
    const next = cols.replace(/^[\d.]+px/, target);
    if (next !== cols) frame.style.gridTemplateColumns = next;

    const handle = frame.querySelector('[data-side="sidebar"]');
    if (handle) {
      if (!handles.has(handle)) {
        handles.set(handle, {
          left: handle.style.left,
          attrs: Object.fromEntries(["role", "tabindex", "aria-label", "aria-orientation", "aria-valuemin", "aria-valuemax", "aria-valuenow"].map((name) => [name, handle.getAttribute(name)])),
        });
        handle.setAttribute("role", "separator");
        handle.setAttribute("tabindex", "0");
        handle.setAttribute("aria-label", "调整工作区宽度");
        handle.setAttribute("aria-orientation", "vertical");
        handle.setAttribute("aria-valuemin", String(WORKSPACE_MIN));
        handle.setAttribute("aria-valuemax", String(WORKSPACE_MAX));
      }
      if (handle.style.left !== target) handle.style.left = target;
      const value = String(workspaceWidth);
      if (handle.getAttribute("aria-valuenow") !== value) handle.setAttribute("aria-valuenow", value);
    }
    collapseSync?.();
  };

  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };

  const setWidth = (width) => {
    workspaceWidth = Math.min(WORKSPACE_MAX, Math.max(WORKSPACE_MIN, Math.round(width)));
  };
  const sidebarHandle = (event) => {
    if (!isDesktopShell() || !(event.target instanceof Element)) return null;
    const handle = event.target.closest('[data-side="sidebar"]');
    const frame = findFrame();
    return handle && handle.parentElement === frame && frame.hasAttribute("data-sk-workspace-expanded") ? handle : null;
  };
  // The host clamps total sidebar width to 264–420px. Own this handle's events
  // so the workspace itself can span 250–450px, in addition to the 52px rail.
  const onPointerDown = (event) => {
    const handle = sidebarHandle(event);
    if (!handle || event.button !== 0 || drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const frame = findFrame();
    drag = { handle, frame, pointerId: event.pointerId, x: event.clientX, width: workspaceWidth };
    frame.setAttribute("data-dragging", "");
    handle.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setWidth(drag.width + event.clientX - drag.x);
    schedule();
  };
  const onPointerUp = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopImmediatePropagation();
    if (event.type === "pointerup") setWidth(drag.width + event.clientX - drag.x);
    finishDrag();
    pass();
  };
  const onKeyDown = (event) => {
    if (!sidebarHandle(event)) return;
    const widths = {
      ArrowLeft: workspaceWidth - (event.shiftKey ? 50 : 10),
      ArrowRight: workspaceWidth + (event.shiftKey ? 50 : 10),
      Home: WORKSPACE_MIN,
      End: WORKSPACE_MAX,
    };
    if (!(event.key in widths)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setWidth(widths[event.key]);
    pass();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("lostpointercapture", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", finishDrag);

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
    finishDrag();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("lostpointercapture", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", finishDrag);
    window.removeEventListener("resize", schedule);
    if (typeof offPanel === "function") offPanel();
    if (queued) cancelAnimationFrame(queued);
    frameEl?.removeAttribute("data-sk-workspace-expanded");
    for (const [handle, { left, attrs }] of handles) {
      handle.style.left = left;
      for (const [name, value] of Object.entries(attrs)) {
        if (value === null) handle.removeAttribute(name);
        else handle.setAttribute(name, value);
      }
    }
    handles.clear();
    widthPass = null;
    frameEl = null;
  };
}

export function installWorkspaceCollapse(ctx) {

  // Scope the structural class to the native sidebar header; other cards also
  // use _toggle classes, and accessible labels change with locale.
  const isToggleButton = (btn) => btn.matches(
    '[data-slot="sidebar"] > [class*="_root"] > :is([class*="_topStrip"], [class*="_logoRow"]) button[class*="_toggle"]',
  );

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
