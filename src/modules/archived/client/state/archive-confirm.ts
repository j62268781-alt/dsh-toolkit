import { createStore } from "../../../../client/ui/store.js";

/**
 * Confirmation queue for the sidebar archive action.
 *
 * The host archives a Session as soon as its row button (or menu entry, or
 * shortcut) is used; its own dialog only appears when live work must be stopped
 * first. DSH exposes no "before archive" hook, so this module wraps the public
 * `workspaces.archiveSession` command: ordinary archives wait for this dialog,
 * while the host's `stopActivity` path (already confirmed by its own dialog)
 * passes straight through. A cancelled request rejects, because the host's
 * caller turns a resolved call into a "session archived" toast and clears the
 * open conversation.
 */
/** One pending confirmation, as read by the overlay. */
export interface ArchiveConfirmRequest {
  sessionId: string;
  title: any;
  run: () => any;
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
}

export interface ArchiveConfirmState {
  request: ArchiveConfirmRequest | null;
  busy: boolean;
  error: string;
}

export function createArchiveConfirm() {
  const store = createStore<ArchiveConfirmState>({ request: null, busy: false, error: "" });
  const queue: ArchiveConfirmRequest[] = [];
  const advance = () => store.set({ busy: false, request: queue[0] ?? null, error: "" });
  return {
    subscribe: store.subscribe,
    snapshot: store.snapshot,
    ask(sessionId, title, run) {
      return new Promise((resolve, reject) => {
        queue.push({ sessionId, title, run, resolve, reject });
        if (store.get().request === null) store.set({ request: queue[0] });
      });
    },
    cancel() {
      const entry = store.get().request;
      if (entry === null || store.get().busy) return;
      queue.shift();
      advance();
      entry.reject(new Error("session archive cancelled"));
    },
    async confirm() {
      const entry = store.get().request;
      if (entry === null || store.get().busy) return;
      store.set({ busy: true, error: "" });
      try {
        const result = await entry.run();
        queue.shift();
        advance();
        entry.resolve(result);
      } catch (reason) {
        // Keep the dialog open: this request still owns the caller's promise.
        store.set({ busy: false, error: String(reason?.message ?? reason) });
      }
    },
  };
}
