/** Present the native file-backed document action in the settings titlebar. */
export function installSettingsActions(panel) {
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'sk-setnav__more';
  more.setAttribute('aria-label', '更多设置操作');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/></svg>';
  const menu = document.createElement('div');
  menu.className = 'sk-setnav__actions';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '设置操作');
  menu.hidden = true;
  const action = document.createElement('button');
  action.type = 'button';
  action.setAttribute('role', 'menuitem');
  const error = document.createElement('div');
  error.className = 'sk-setnav__action-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  menu.append(action, error);
  panel.prepend(more, menu);
  let original = null;
  let owner = null;
  const close = (focus = false) => {
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (focus) more.focus();
  };
  const open = () => {
    if (more.hidden) return;
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    action.focus();
  };
  more.addEventListener('click', () => menu.hidden ? open() : close(true));
  more.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
  });
  action.addEventListener('click', () => {
    if (original && !original.disabled) original.click();
  });
  const onPointer = (event) => { if (!menu.contains(event.target) && !more.contains(event.target)) close(); };
  const onKey = (event) => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    } else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); action.focus();
    }
  };
  document.addEventListener('pointerdown', onPointer, true);
  // Escape dismisses this menu before the native modal's document handler runs.
  window.addEventListener('keydown', onKey, true);
  return {
    sync() {
      // Build-specific hashes change between releases; find the header action
      // seat structurally and take the contribution that owns a button.
      const actions = panel.querySelector(':scope > [class*="_content"] > [class*="_header"] > [class*="_actions"]');
      const nextOwner = [...(actions?.children ?? [])].find((child) => child.querySelector('button'))
        ?? actions?.firstElementChild
        ?? null;
      if (owner !== nextOwner) owner?.removeAttribute('data-sk-config-original');
      owner = nextOwner;
      original = owner?.querySelector('button') ?? null;
      more.hidden = !original;
      if (!original) { close(); return; }
      owner.setAttribute('data-sk-config-original', '');
      const label = original.textContent.trim();
      if (action.textContent !== label) action.textContent = label;
      if (action.disabled !== original.disabled) action.disabled = original.disabled;
      const message = owner.querySelector('[role="alert"]')?.textContent ?? '';
      if (error.textContent !== message) error.textContent = message;
      error.hidden = !message;
    },
    dispose() {
      owner?.removeAttribute('data-sk-config-original');
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      more.remove(); menu.remove();
    },
  };
}
