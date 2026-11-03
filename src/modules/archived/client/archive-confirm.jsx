import React from "react";
import { ARCH_NS } from "./locale.js";

const primitives = (() => {
  try { return require("@deepseek-ai/dsh-client-ui-primitives"); } catch { return {}; }
})();

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
export function createArchiveConfirm() {
  let state = { request: null, busy: false, error: "" };
  const listeners = new Set();
  const queue = [];
  const update = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const advance = () => update({ busy: false, request: queue[0] ?? null, error: "" });
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    ask(sessionId, title, run) {
      return new Promise((resolve, reject) => {
        queue.push({ sessionId, title, run, resolve, reject });
        if (state.request === null) update({ request: queue[0] });
      });
    },
    cancel() {
      const entry = state.request;
      if (entry === null || state.busy) return;
      queue.shift();
      advance();
      entry.reject(new Error("session archive cancelled"));
    },
    async confirm() {
      const entry = state.request;
      if (entry === null || state.busy) return;
      update({ busy: true, error: "" });
      try {
        const result = await entry.run();
        queue.shift();
        advance();
        entry.resolve(result);
      } catch (reason) {
        // Keep the dialog open: this request still owns the caller's promise.
        update({ busy: false, error: String(reason?.message ?? reason) });
      }
    },
  };
}

export function useArchiveConfirm(controller) {
  return React.useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
}

export function installArchiveConfirm(ctx, controller) {
  const t = ctx.locale.bind(ARCH_NS);
  const Button = primitives.Button ?? "button";

  function ArchiveConfirmDialog() {
    const state = useArchiveConfirm(controller);
    const Modal = primitives.Modal;
    if (state.request === null || Modal === undefined) return null;
    const title = state.request.title || t("untitled");
    return <Modal open title={t("archiveTitle").replace("{t}", title)} closeLabel={t("cancel")}
      onClose={() => controller.cancel()}
      description={t("archiveDesc")}
      footer={<>
        <Button variant="outline" disabled={state.busy} onClick={() => controller.cancel()}>{t("cancel")}</Button>
        <Button variant="outline" disabled={state.busy} onClick={() => { void controller.confirm(); }}>
          {state.busy ? t("archiving") : t("archiveAction")}
        </Button>
      </>}>
      {state.error !== "" ? <p role="alert" className="sk-arch__note--error">{t("archiveFailed").replace("{reason}", state.error)}</p> : null}
    </Modal>;
  }

  function wrapArchiveSession() {
    const workspaces = ctx.workspaces;
    if (workspaces === null || workspaces === undefined || typeof workspaces.archiveSession !== "function") return () => {};
    const original = workspaces.archiveSession;
    const wrapped = function archiveSession(sessionId, options) {
      if (options !== null && typeof options === "object" && options.stopActivity === true) {
        return original.call(workspaces, sessionId, options);
      }
      const summary = ctx.sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
      const displayTitle = summary?.title || summary?.displayTitle || "";
      return controller.ask(sessionId, displayTitle, () => original.call(workspaces, sessionId, options));
    };
    workspaces.archiveSession = wrapped;
    // Cordis hands out a fresh proxy per access, so reading the method back
    // never yields `wrapped` itself; restoring is the only safe comparison.
    return () => { workspaces.archiveSession = original; };
  }

  // Without the host Modal there is no way to ask, so leave the archive path alone.
  if (primitives.Modal === undefined) return () => {};
  const offDialog = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay", id: "dsh-toolkit.archived.archive-confirm",
  }, ArchiveConfirmDialog));
  const offWrap = wrapArchiveSession();
  return () => {
    offWrap();
    offDialog();
  };
}
