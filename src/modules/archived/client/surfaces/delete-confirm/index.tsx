import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { useStore } from "../../../../../client/ui/store.js";
import { confirmDialog } from "../../../../../client/ui/components/confirm-dialog/index.jsx";
import { ARCH_NS } from "../../locale.js";
import { DeleteButton } from "../../components/delete-button/index.jsx";

export const NAME = "delete-confirm";

/**
 * The confirmation dialog, mounted on `shell.overlay` (portaled outside the panel).
 *
 * It stays closed while the deletion runs: `confirm()` clears the request before its
 * first await so the row buttons can carry the wait.
 *
 * Shell, title, description and radius come from `confirmDialog` (host Modal). The
 * confirm button stays the module's own `DeleteButton`: permanent deletion is the
 * one place here that must read as destructive, not as the host's black "continue".
 */
export function install(ctx, host) {
  const t = ctx.locale.bind(ARCH_NS);

  function RemovalDialog() {
    const state = useStore(host.removal);
    if (!state.request) return null;
    const error = state.error
      ? <p role="alert" className="sk-arch__note--error">{t("removeFailed").replace("{reason}", state.error)}</p>
      : null;
    const shared = {
      primitives,
      closeLabel: t("close"),
      cancelLabel: t("cancel"),
      children: error,
      onCancel: () => host.removal.cancel(),
      confirmButton: <DeleteButton onClick={() => { void host.removal.confirm(); }}>{t("confirmDelete")}</DeleteButton>,
    };
    if (state.request.kind === "all") {
      return confirmDialog({
        ...shared,
        title: t("deleteAllTitle").replace("{t}", String(state.request.rows.length)),
        description: t("deleteAllDesc"),
      });
    }
    const title = state.request.rows[0]?.title || t("untitled");
    return confirmDialog({
      ...shared,
      title: t("deleteOneTitle").replace("{t}", title),
      description: t("deleteOneDesc"),
    });
  }

  return installSlot(ctx, { name: "shell.overlay", id: "dsh-toolkit.archived.delete-confirm" }, RemovalDialog);
}
