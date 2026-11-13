import React from "react";

/**
 * The smallest store that a panel needs, in one place.
 *
 * Panels hold dialog queues and per-row busy sets that outlive a render; the shape
 * (`subscribe` / `snapshot` / one shallow-merged patch) is what lets React read them
 * through `useSyncExternalStore` without a second state library.
 */
export interface Store<T extends object> {
  get(): T;
  snapshot(): T;
  subscribe(listener: () => void): () => void;
  set(patch: Partial<T>): void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener) as unknown as void;
    },
    set(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

/** Subscribe a component to a store (or to any object with the same three members). */
export function useStore<T extends object>(controller: Store<T>): T {
  return React.useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
}
