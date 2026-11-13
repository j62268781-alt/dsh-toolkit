import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { useStore } from "../../../../../client/ui/store.js";
import { ARCH_NS } from "../../locale.js";

export const NAME = "archive-confirm";

/**
 * Confirmation for the sidebar archive action, mounted on `shell.overlay`.
 *
 * `install` also wraps `workspaces.archiveSession`: DSH has no "before archive"
 * hook, so the dialog has to sit in front of the public command. The host path
 * that already confirmed (`stopActivity`) is passed straight through.
 */
export function install(ctx, host) {
  const t = ctx.locale.bind(ARCH_NS);
  const Modal = primitives.Modal;
  const Button = primitives.Button ?? "button";

  function ArchiveConfirmDialog() {
    const state = useStore(host.archiveConfirm);
    if (!state.request || !Modal) return null;
    const title = t("archiveTitle").replace("{t}", state.request.title || t("untitled"));
    const error = state.error
      ? <p role="alert" className="sk-arch__note--error">{t("archiveFailed").replace("{reason}", state.error)}</p>
      : null;
    return <Modal open title={title} closeLabel={t("cancel")}
      onClose={() => host.archiveConfirm.cancel()}
      description={t("archiveDesc")}
      footer={<>
        <Button variant="outline" disabled={state.busy}
          onClick={() => host.archiveConfirm.cancel()}>{t("cancel")}</Button>
        <Button disabled={state.busy}
          onClick={() => { void host.archiveConfirm.confirm(); }}>{state.busy ? t("archiving") : t("archiveAction")}</Button>
      </>}>
      {error}
    </Modal>;
  }

  const offDialog = installSlot(ctx, { name: "shell.overlay", id: "dsh-toolkit.archived.archive-confirm" }, ArchiveConfirmDialog);
  const offWrap = wrapArchiveSession();
  return () => {
    offDialog();
    offWrap();
  };

  function wrapArchiveSession() {
    const workspaces = ctx.workspaces;
    const original = workspaces?.archiveSession;
    if (typeof original !== "function") return () => {};
    workspaces.archiveSession = async function archiveSession(sessionId, options) {
      // The host's own dialog already asked; adding a second one would stall it.
      if (options?.stopActivity === true) return original.call(this, sessionId, options);
      const summary = ctx.sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
      const title = summary?.title || summary?.displayTitle || "";
      return host.archiveConfirm.ask(sessionId, title, () => original.call(this, sessionId, options));
    };
    // `ctx.workspaces` hands out a fresh proxy per access, so the original function
    // is the only thing that can be put back.
    return () => { workspaces.archiveSession = original; };
  }
}
