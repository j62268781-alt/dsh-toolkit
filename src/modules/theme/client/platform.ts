// Follow platform attributes because the desktop shell may publish them after apply.
const DESKTOP_MARK = "data-sk-desktop";
// The Codex shell needs a layout it can own: the desktop window, or a browser tab
// wide enough that the host still renders a real sidebar column beside the content.
// Narrower tabs hand the sidebar to the host's drawer, where there is no column to
// draw the rail in, so the shell stays off and the host layout applies unchanged.
const SHELL_MARK = "data-sk-codex-shell";

/**
 * Browser tabs stay on the host layout below this width. The host collapses the
 * sidebar on its own below 1024px (`SIDEBAR_AUTO_COLLAPSE`, the deepsuite LG
 * breakpoint) and hands it to the drawer below 768px; both leave the shell without
 * the expanded column it needs, so gating at the same breakpoint keeps the two
 * behaviours from fighting over the frame.
 */
export const SHELL_MIN_WIDTH = 1024;

export function isDarwinDesktop() {
  return document.documentElement.getAttribute("data-platform") === "darwin";
}

export function isDesktopShell() {
  const root = document.documentElement;
  return isDarwinDesktop() || root.hasAttribute("data-windows-titlebar");
}

export function isCodexShell() {
  return (window.innerWidth || 0) >= SHELL_MIN_WIDTH;
}

const toggle = (root, name, on) => {
  if (on) {
    if (!root.hasAttribute(name)) root.setAttribute(name, "");
  } else if (root.hasAttribute(name)) {
    root.removeAttribute(name);
  }
};

export function installShellMarkers() {
  const root = document.documentElement;
  const sync = () => {
    toggle(root, DESKTOP_MARK, isDesktopShell());
    toggle(root, SHELL_MARK, isCodexShell());
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-platform", "data-windows-titlebar"],
  });
  window.addEventListener("resize", sync);
  sync();
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", sync);
    root.removeAttribute(DESKTOP_MARK);
    root.removeAttribute(SHELL_MARK);
  };
}
