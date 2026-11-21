const CHANGED = "dsh-toolkit-git:repository-changed";

// Standalone Git and task-monitor bundles do not share a module instance.
export function announceRepositoryChange(cwd: string): void {
  window.dispatchEvent(new window.CustomEvent(CHANGED, { detail: cwd }));
}

export function onRepositoryChange(cwd: string, callback: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent).detail === cwd) callback();
  };
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
