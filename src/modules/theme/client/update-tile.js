// Codex-only surface for the native desktop update button.
//
// DSH 0.2.1-rc.5 appends a 28×72 update pill to the account row at the bottom of the
// sidebar. In the 52px codex rail the style sheet turns that pill into a 36×36 tile,
// which cannot show the pill's caption and cannot read the progress amount from CSS.
// This module mirrors the preload bridge's presentation onto `data-cx-update` and
// `data-cx-progress` so the style sheet can draw the phase glyph and progress ring.
// The native component keeps ownership of aria-label, aria-disabled, the tooltip and
// the click handler: nothing here intercepts events or replaces the button.

const TILE =
  '[data-slot="sidebar"] [class*="_triggerRow"] > [class*="_indicator"][aria-disabled]';
const PERCENT = /(\d{1,3})\s*%/;
// Only the download phase reports progress; verifying keeps percent pinned at 100
// and ready/error carry none, so a percentage there would just draw a bogus ring.
const PROGRESS_PHASES = new Set(["downloading"]);

const clampPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
};

/** Bridge presentation → the attributes the style sheet understands. */
const fromPresentation = (presentation) => {
  if (!presentation || typeof presentation !== "object") return null;
  const phase = typeof presentation.phase === "string" ? presentation.phase : "";
  if (!phase || phase === "idle") return null;
  return {
    phase,
    percent: PROGRESS_PHASES.has(phase) ? clampPercent(presentation.percent) : null,
  };
};

/** Shell without the v1 bridge: the accessible name is the only progress source. */
const fromCaption = (tile) => {
  const match = PERCENT.exec(tile.getAttribute("aria-label") ?? "");
  if (match) return { phase: "downloading", percent: clampPercent(match[1]) };
  return { phase: "unknown", percent: null };
};

/**
 * Mirror the desktop update bridge onto the sidebar button.
 * @returns {() => void} disposer that restores the untouched attributes.
 */
export function installUpdateTile() {
  let presentation = null;
  let bridged = false;
  let unsubscribe = null;
  let queued = 0;
  let active = true;

  const paint = (tile) => {
    const state = bridged ? presentation : fromCaption(tile);
    if (!state) {
      tile.removeAttribute("data-cx-update");
      tile.removeAttribute("data-cx-progress");
      tile.style.removeProperty("--cx-update-pct");
      return;
    }
    tile.setAttribute("data-cx-update", state.phase);
    if (state.percent === null) {
      tile.removeAttribute("data-cx-progress");
      tile.style.removeProperty("--cx-update-pct");
    } else {
      tile.setAttribute("data-cx-progress", String(state.percent));
      tile.style.setProperty("--cx-update-pct", `${state.percent}%`);
    }
  };

  const pass = () => {
    queued = 0;
    if (!active) return;
    for (const tile of document.querySelectorAll(TILE)) paint(tile);
  };

  const schedule = () => {
    if (!queued && active) queued = requestAnimationFrame(pass);
  };

  const carrier = globalThis.dshDesktop;
  const bridge = carrier?.protocolVersion === 1 ? carrier.updates : undefined;
  if (bridge && typeof bridge.subscribe === "function") {
    bridged = true;
    try {
      unsubscribe = bridge.subscribe((next) => {
        presentation = fromPresentation(next);
        schedule();
      });
      if (typeof bridge.status === "function") {
        bridge
          .status()
          .then((next) => {
            if (!active || presentation !== null) return;
            presentation = fromPresentation(next);
            schedule();
          })
          .catch(() => {});
      }
    } catch {
      bridged = false;
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  pass();

  return () => {
    active = false;
    observer.disconnect();
    if (queued) cancelAnimationFrame(queued);
    if (typeof unsubscribe === "function") unsubscribe();
    for (const tile of document.querySelectorAll(TILE)) {
      tile.removeAttribute("data-cx-update");
      tile.removeAttribute("data-cx-progress");
      tile.style.removeProperty("--cx-update-pct");
    }
  };
}
