import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";
import { installSlot } from "../../../../../client/ui/slot.js";
import { useStore } from "../../../../../client/ui/store.js";
import { ARCH_NS } from "../../locale.js";
import { DeleteButton } from "../../components/delete-button/index.jsx";

export const NAME = "delete-confirm";

/**
 * The confirmation dialog, mounted on `shell.overlay` (portaled outside the panel).
 *
 * It stays closed while the deletion runs: `confirm()` clears the request before its
 * first await so the row buttons can carry the wait.
 */
export function install(ctx, host) {
  const t = ctx.locale.bind(ARCH_NS);

  function RemovalDialog() {
    const state = useStore(host.removal);
    const Modal = primitives.Modal;
    const Button = primitives.Button ?? "button";
    if (!state.request || !Modal) return null;
    const error = state.error
      ? <p role="alert" className="sk-arch__note--error">{t("removeFailed").replace("{reason}", state.error)}</p>
      : null;
    if (state.request.kind === "all") {
      return <Modal open title={t("deleteAllTitle").replace("{t}", String(state.request.rows.length))}
        closeLabel={t("cancel")} onClose={() => host.removal.cancel()}
        description={t("deleteAllDesc")}
        footer={<>
          <Button variant="outline" onClick={() => host.removal.cancel()}>{t("cancel")}</Button>
          <DeleteButton onClick={() => { void host.removal.confirm(); }}>{t("confirmDelete")}</DeleteButton>
        </>}>
        {error}
      </Modal>;
    }
    const title = state.request.rows[0]?.title || t("untitled");
    return <Modal open title={t("deleteOneTitle").replace("{t}", title)} closeLabel={t("cancel")}
      onClose={() => host.removal.cancel()}
      description={t("deleteOneDesc")}
      footer={<>
        <Button variant="outline" onClick={() => host.removal.cancel()}>{t("cancel")}</Button>
        <DeleteButton onClick={() => { void host.removal.confirm(); }}>{t("confirmDelete")}</DeleteButton>
      </>}>
      {error}
    </Modal>;
  }

  return installSlot(ctx, { name: "shell.overlay", id: "dsh-toolkit.archived.delete-confirm" }, RemovalDialog);
}
