/** Project the native configuration action without moving its React-owned node. */
export function installSettingsActions(panel: HTMLElement, toolbar: HTMLElement) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "sk-setnav__config";
  action.hidden = true;
  action.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 1.75h4.5L12.5 6v7a1.25 1.25 0 0 1-1.25 1.25h-6.5A1.25 1.25 0 0 1 3.5 13V3A1.25 1.25 0 0 1 4.75 1.75M8.5 2v4h4M6 9h4m-4 2.5h4"/></svg>';
  const error = document.createElement("div");
  error.className = "sk-setnav__action-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  toolbar.append(action, error);

  let owner: Element | null = null;
  let original: HTMLButtonElement | null = null;
  action.addEventListener("click", () => original?.click());

  return {
    sync() {
      // Build-specific hashes change; locate the host's header action structurally.
      const actions = panel.querySelector(':scope > [class*="_header"] > [class*="_actions"], :scope > [class*="_content"] > [class*="_header"] > [class*="_actions"]');
      const nextOwner = [...(actions?.children ?? [])].find((child) => child.querySelector("button")) ?? null;
      if (owner !== nextOwner) owner?.removeAttribute("data-sk-config-original");
      owner = nextOwner;
      original = owner?.querySelector("button") ?? null;
      action.hidden = !original;
      if (original) {
        owner.setAttribute("data-sk-config-original", "");
        const label = original.textContent.trim() || "打开配置文件";
        action.setAttribute("aria-label", label);
        action.title = label;
        if (action.disabled !== original.disabled) action.disabled = original.disabled;
      }
      const message = owner?.querySelector('[role="alert"]')?.textContent ?? "";
      if (error.textContent !== message) error.textContent = message;
      error.hidden = !message;
    },
    dispose() {
      owner?.removeAttribute("data-sk-config-original");
      action.remove();
      error.remove();
    },
  };
}
