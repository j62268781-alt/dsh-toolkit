/** Keep native modal disposal/focus immediate; only a visual copy animates out. */
const OVERLAY = '[data-sk-settings-overlay], [role="presentation"]';

export function createSettingsMotion() {
  let opening = null;
  let lastOverlay = null;
  const exits = new Map();
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const frames = [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }];
  const findOverlay = (panel) => {
    const parent = panel.parentElement;
    if (parent?.matches(OVERLAY)) return parent;
    return panel.closest(OVERLAY);
  };
  const clearExits = () => {
    for (const { animation, cleanup } of exits.values()) { animation.cancel(); cleanup(); }
    exits.clear();
  };
  return {
    enter(panel) {
      clearExits();
      opening?.cancel();
      opening = null;
      const overlay = findOverlay(panel);
      lastOverlay = overlay;
      if (overlay?.animate && !reduced()) opening = overlay.animate(frames, {
        duration: 280, easing: 'cubic-bezier(.16,1,.3,1)',
      });
    },
    leave(panel) {
      opening?.cancel();
      opening = null;
      const overlay = findOverlay(panel) ?? lastOverlay;
      lastOverlay = null;
      if (!overlay?.animate || reduced()) return;
      const copy = overlay.cloneNode(true);
      copy.inert = true;
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('data-sk-settings-exit', '');
      // The real portal root carries this marker; keep it so the exit copy uses
      // the connected settings shell even when it is cloned before install.
      copy.setAttribute('data-sk-settings-overlay', '');
      copy.querySelector('[data-shortcut-modal="settings"]')?.setAttribute('data-sk-settings-snapshot', '');
      [copy, ...copy.querySelectorAll('[id], [data-shortcut-modal], [role], [aria-modal]')].forEach((node) => {
        for (const name of ['id', 'data-shortcut-modal', 'role', 'aria-modal']) node.removeAttribute(name);
      });
      copy.style.pointerEvents = 'none';
      document.body.append(copy);
      const animation = copy.animate([...frames].reverse(), { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' });
      const cleanup = () => { window.clearTimeout(timeout); copy.remove(); exits.delete(copy); };
      const timeout = window.setTimeout(cleanup, 220);
      exits.set(copy, { animation, cleanup });
      animation.onfinish = animation.oncancel = cleanup;
      animation.finished?.then(cleanup, cleanup);
    },
    dispose() { opening?.cancel(); opening = null; lastOverlay = null; clearExits(); },
  };
}
