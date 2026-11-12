import { isCodexShell } from "./platform.js";

/** Keep Codex structure exclusive; other palettes may own independent effects. */
export function installCodexShell(ctx, installers, options = {}) {
  const root = options.root ?? document.documentElement;
  const Observer = options.MutationObserver ?? MutationObserver;
  // The Codex shell needs a column to lay the rail out in, so it runs in the desktop
  // window and in wide browser tabs, and stays off where the host hands the sidebar
  // to its drawer. The palette keeps only its colour and radius tokens there.
  const isShell = options.isCodexShell ?? isCodexShell;
  let disposers = null;
  let codex = null;
  let active = true;

  const clear = () => {
    if (!disposers) return;
    for (const dispose of disposers.reverse()) dispose?.();
    disposers = null;
  };
  const sync = () => {
    if (!active) return;
    const nextCodex = root.getAttribute("data-sk-palette") === "codex" && isShell();
    if (nextCodex === codex) return;
    clear();
    codex = nextCodex;
    const selected = codex ? installers : (options.nativeInstallers ?? []);
    disposers = selected.map((install) => install(ctx));
  };
  const observer = new Observer(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["data-sk-palette", "data-sk-codex-shell", "data-sk-desktop", "data-platform", "data-windows-titlebar"] });
  sync();
  return () => {
    active = false;
    observer.disconnect();
    clear();
  };
}
