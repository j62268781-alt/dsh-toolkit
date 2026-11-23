const CHANGED = "dsh-toolkit-git:repository-changed";

// Refresh other Git surfaces when a local operation changes this directory.
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
