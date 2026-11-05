/** Keep Codex structure exclusive; other palettes may own independent effects. */
export function installCodexShell(ctx, installers, options = {}) {
  const root = options.root ?? document.documentElement;
  const Observer = options.MutationObserver ?? MutationObserver;
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
    const nextCodex = root.getAttribute("data-sk-palette") === "codex";
    if (nextCodex === codex) return;
    clear();
    codex = nextCodex;
    const selected = codex ? installers : (options.nativeInstallers ?? []);
    disposers = selected.map((install) => install(ctx));
  };
  const observer = new Observer(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["data-sk-palette"] });
  sync();
  return () => {
    active = false;
    observer.disconnect();
    clear();
  };
}
