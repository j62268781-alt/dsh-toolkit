// Follow platform attributes because the desktop shell may publish them after apply.
const DESKTOP_MARK = "data-sk-desktop";

export function isDarwinDesktop() {
  return document.documentElement.getAttribute("data-platform") === "darwin";
}

export function isDesktopShell() {
  const root = document.documentElement;
  return isDarwinDesktop() || root.hasAttribute("data-windows-titlebar");
}

export function installDesktopMarker() {
  const root = document.documentElement;
  const sync = () => {
    if (isDesktopShell()) {
      if (!root.hasAttribute(DESKTOP_MARK)) root.setAttribute(DESKTOP_MARK, "");
    } else if (root.hasAttribute(DESKTOP_MARK)) {
      root.removeAttribute(DESKTOP_MARK);
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-platform", "data-windows-titlebar"],
  });
  sync();
  return () => {
    observer.disconnect();
    root.removeAttribute(DESKTOP_MARK);
  };
}
