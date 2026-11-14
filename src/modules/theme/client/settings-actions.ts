/** Keep configuration and the public desktop update flow in the settings menu. */
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
  const update = document.createElement('button');
  update.type = 'button';
  update.setAttribute('role', 'menuitem');
  update.dataset.skSettingsUpdate = '';
  const updateError = document.createElement('div');
  updateError.className = 'sk-setnav__action-error';
  updateError.setAttribute('role', 'alert');
  updateError.hidden = true;
  menu.append(action, error, update, updateError);
  panel.prepend(more, menu);
  let original = null;
  let owner = null;
  let disposed = false;
  let pending = false;
  let presentation = null;
  let revision = 0;
  // The desktop host injects `dshDesktop` on the window at runtime; there is no
  // ambient type for it in the client program.
  const updates = (window as any).dshDesktop?.updates;
  const available = typeof updates?.open === 'function';
  const showUpdateError = (message) => {
    if (disposed) return;
    updateError.textContent = message;
    updateError.hidden = !message;
  };
  const syncUpdate = () => {
    if (disposed) return;
    const labels = {
      checking: '正在检查更新…', available: '下载更新…',
      downloading: '正在下载更新…', ready: '安装更新…', installing: '正在安装更新…',
    };
    const retryLabels = {
      check: '重新检查更新', 'check-network': '重新检查更新',
      download: '重试下载更新…', 'download-network': '重试下载更新…',
      install: '重试安装更新…', 'install-network': '重试安装更新…',
      'stop-failed': '重试安装更新…', 'tasks-changed': '重试安装更新…', 'tasks-unavailable': '重试安装更新…',
    };
    // The public presentation exposes `failure`, not main's `failedOperation`.
    const label = presentation?.phase === 'error' ? retryLabels[presentation.failure] ?? '重试更新…'
      : labels[presentation?.phase] ?? (pending ? '正在处理更新…' : '检查更新');
    if (update.textContent !== label) update.textContent = label;
    const disabled = !available || pending || ['checking', 'downloading', 'installing'].includes(presentation?.phase);
    if (update.disabled !== disabled) update.disabled = disabled;
    update.title = available ? '' : '请在 DeepSeek Harness 桌面应用中检查更新';
  };
  const close = (focus = false) => {
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (focus) more.focus();
  };
  const enabledActions = (): HTMLButtonElement[] => [...menu.querySelectorAll('button')].filter((button) => !button.hidden && !button.disabled);
  const open = () => {
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    (enabledActions()[0] ?? more).focus();
  };
  more.addEventListener('click', () => menu.hidden ? open() : close(true));
  more.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
  });
  action.addEventListener('click', () => {
    if (original && !original.disabled) original.click();
  });
  update.addEventListener('click', async () => {
    if (update.disabled || disposed) return;
    pending = true;
    showUpdateError('');
    syncUpdate();
    try {
      // This public preload API owns native checks, progress, and update dialogs.
      await updates.open();
    } catch (reason) {
      showUpdateError(`无法打开更新：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      pending = false;
      syncUpdate();
    }
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
      event.preventDefault();
      const buttons = enabledActions();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  document.addEventListener('pointerdown', onPointer, true);
  // Escape dismisses this menu before the native modal's document handler runs.
  window.addEventListener('keydown', onKey, true);
  let offUpdates;
  syncUpdate();
  if (available) {
    const initialRevision = revision;
    try {
      offUpdates = updates.subscribe?.((state) => {
        revision++;
        presentation = state;
        syncUpdate();
      });
      Promise.resolve(updates.status?.()).then((state) => {
        if (disposed || revision !== initialRevision) return;
        presentation = state;
        syncUpdate();
      }).catch((reason) => showUpdateError(`无法读取更新状态：${reason instanceof Error ? reason.message : String(reason)}`));
    } catch (reason) {
      showUpdateError(`无法读取更新状态：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  return {
    sync() {
      // Build-specific hashes change between releases; find the header action
      // seat structurally and take the contribution that owns a button.
      const actions = panel.querySelector(':scope > [class*="_header"] > [class*="_actions"], :scope > [class*="_content"] > [class*="_header"] > [class*="_actions"]');
      const nextOwner = [...(actions?.children ?? [])].find((child) => child.querySelector('button'))
        ?? actions?.firstElementChild
        ?? null;
      if (owner !== nextOwner) owner?.removeAttribute('data-sk-config-original');
      owner = nextOwner;
      original = owner?.querySelector('button') ?? null;
      action.hidden = !original;
      if (original) {
        owner.setAttribute('data-sk-config-original', '');
        const label = original.textContent.trim();
        if (action.textContent !== label) action.textContent = label;
        if (action.disabled !== original.disabled) action.disabled = original.disabled;
      }
      const message = owner?.querySelector('[role="alert"]')?.textContent ?? '';
      if (error.textContent !== message) error.textContent = message;
      error.hidden = !message;
    },
    dispose() {
      disposed = true;
      offUpdates?.();
      owner?.removeAttribute('data-sk-config-original');
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      more.remove(); menu.remove();
    },
  };
}
