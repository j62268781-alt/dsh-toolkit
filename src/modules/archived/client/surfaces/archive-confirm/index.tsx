import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { useStore } from "../../../../../client/ui/store.js";
import { confirmDialog } from "../../../../../client/ui/components/confirm-dialog/index.jsx";
import { ARCH_NS } from "../../locale.js";

export const NAME = "archive-confirm";

/**
 * Confirmation for the sidebar archive action, mounted on `shell.overlay`.
 *
 * `install` also wraps `workspaces.archiveSession`: DSH has no "before archive"
 * hook, so the dialog has to sit in front of the public command. The host path
 * that already confirmed (`stopActivity`) is passed straight through.
 *
 * The shell comes from `confirmDialog` (host Modal: 16px title, 14px description,
 * `--dsw-radius-panel`); the confirm button is the host's black `primary` variant,
 * which is what the plugin page uses for its own confirmations.
 */
export function install(ctx, host) {
  const t = ctx.locale.bind(ARCH_NS);

  function ArchiveConfirmDialog() {
    const state = useStore(host.archiveConfirm);
    if (!state.request) return null;
    const title = t("archiveTitle").replace("{t}", state.request.title || t("untitled"));
    return confirmDialog({
      primitives,
      title,
      description: t("archiveDesc"),
      closeLabel: t("close"),
      cancelLabel: t("cancel"),
      confirmLabel: t("archiveAction"),
      pendingLabel: t("archiving"),
      pending: state.busy,
      onCancel: () => host.archiveConfirm.cancel(),
      onConfirm: () => { void host.archiveConfirm.confirm(); },
      children: state.error
        ? <p role="alert" className="sk-arch__note--error">{t("archiveFailed").replace("{reason}", state.error)}</p>
        : null,
    });
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
