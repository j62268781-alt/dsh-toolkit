import React from "react";
import { ARCH_NS } from "./locale.js";
import { removeSessionViaHost } from "./deletion.js";

const primitives = (() => {
  try { return require("@deepseek-ai/dsh-client-ui-primitives"); } catch { return {}; }
})();

export function DeleteButton({ children, size = "md", className, ...props }) {
  const Button = primitives.Button ?? "button";
  const Icon = primitives.IconTrashOutlineRegular;
  const classes = className === undefined ? "sk-arch__delete" : `sk-arch__delete ${className}`;
  return <Button type="button" variant="outline" size={size} className={classes}
    icon={Icon ? <Icon size={16} /> : undefined} {...props}>
    {children}
  </Button>;
}

/** Merge per-Session requests onto one queue so two dialogs never stack. */
export function createRemoval(ctx) {
  const t = ctx.locale.bind(ARCH_NS);
  // `progress` is `{ done, total }` while a batch runs and `null` otherwise: the page
  // needs something to show once the confirmation dialog is no longer on screen.
  let state = { request: null, busy: false, error: "", note: "", removed: new Set(), progress: null };
  const listeners = new Set();
  const update = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const controller = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    request(row) {
      if (!state.busy) update({ request: { kind: "one", rows: [row] }, error: "" });
    },
    requestAll(groups) {
      const rows = [...new Map(
        groups.flatMap((group) => group.rows).filter((row) => !state.removed.has(row.id)).map((row) => [row.id, row]),
      ).values()];
      if (state.busy || rows.length === 0) return;
      update({ request: { kind: "all", rows }, error: "" });
    },
    cancel() { if (!state.busy) update({ request: null, error: "" }); },
    async confirm() {
      if (!state.request || state.busy) return;
      const request = state.request;
      const failed = [];
      const errors = [];
      const total = request.rows.length;
      let processed = 0;
      let completed = 0;
      // Files moved out from under a session the host still holds in memory. Its
      // archive registration has to stay: it is the tombstone that keeps the
      // record out of the sidebar, and the host exposes no way to unload it now.
      let retained = 0;
      // Close the dialog before the first await. The deletions are serial and each
      // one waits on host-side I/O (rename, flush), so a modal that stays up while
      // that runs is what made the action read as stuck. The page reports progress.
      update({ request: null, busy: true, error: "", note: "", progress: { done: 0, total } });
      for (const row of request.rows) {
        const result = await removeSessionViaHost(row.id);
        processed++;
        // The files are already gone (workspace deleted, disk cleanup, an older
        // delete): clearing the archive metadata is the only work left, and it is
        // what keeps such a record from staying archived forever.
        const alreadyGone = result?.reason === "not-found";
        if (result?.ok !== true && !alreadyGone) {
          failed.push(row);
          const reason = String(result?.reason ?? "unknown");
          errors.push(request.kind === "all" ? `${row.title || row.id}: ${reason}` : reason);
          update({ progress: { done: processed, total } });
          continue;
        }
        completed++;
        update({ removed: new Set(state.removed).add(row.id), progress: { done: processed, total } });
        if (result?.retained === true) {
          retained++;
          continue;
        }
        // These metadata commands remain valid after the session files are gone.
        await Promise.allSettled([
          Promise.resolve().then(() => ctx.workspaces.unarchiveSession(row.id)),
          Promise.resolve().then(() => ctx.workspaces.unpinSession(row.id)),
        ]);
      }
      if (completed) {
        // A full session list refresh is another round trip; land it in the
        // background so it cannot extend the window the page spends deleting.
        void Promise.resolve()
          .then(() => ctx.sessions.refresh?.())
          .catch(() => {});
      }
      // Deleting archived sessions never touches the Workspace: the workspace
      // registry, its directory, and any unarchived sessions stay as they are.
      update({
        busy: false,
        progress: null,
        note: retained === 0 ? "" : t("deleteRetained").replace("{t}", String(retained)),
        request: failed.length === 0 ? null : { kind: request.kind, rows: failed },
        error: errors.join("；"),
      });
    },
  };
  return controller;
}

export function useRemoval(controller) {
  return React.useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
}

export function installRemoval(ctx, controller) {
  const t = ctx.locale.bind(ARCH_NS);
  const MenuItem = primitives.MenuItemButton;
  function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, useWorkspaces }) {
    const [, setMenuOpen] = useMenuOpenState();
    const archived = useWorkspaces((snapshot) => snapshot.archivedSessionIds.includes(sessionId));
    const state = useRemoval(controller);
    if (!archived || state.removed.has(sessionId) || !MenuItem) return null;
    const Icon = primitives.IconTrashOutlineRegular;
    return <MenuItem danger disabled={state.busy}
      icon={Icon ? <Icon size={14} /> : undefined}
      onSelect={() => {
        controller.request({ id: sessionId, title: displayTitle });
        setMenuOpen(false);
      }}>{t("removeSession")}</MenuItem>;
  }
  function RemovalDialog() {
    const state = useRemoval(controller);
    const Modal = primitives.Modal;
    const Button = primitives.Button ?? "button";
    if (!state.request || !Modal) return null;
    if (state.request.kind === "all") {
      return <Modal open title={t("deleteAllTitle").replace("{t}", String(state.request.rows.length))}
        closeLabel={t("cancel")} onClose={() => controller.cancel()}
        description={t("deleteAllDesc")}
        footer={<>
          <Button variant="outline" disabled={state.busy} onClick={() => controller.cancel()}>{t("cancel")}</Button>
          <DeleteButton disabled={state.busy} onClick={() => { void controller.confirm(); }}>
            {state.busy ? t("removing") : t("confirmDelete")}
          </DeleteButton>
        </>}>
        {state.error ? <p role="alert" className="sk-arch__note--error">{t("removeFailed").replace("{reason}", state.error)}</p> : null}
      </Modal>;
    }
    const title = state.request.rows[0]?.title || t("untitled");
    return <Modal open title={t("deleteOneTitle").replace("{t}", title)} closeLabel={t("cancel")}
      onClose={() => controller.cancel()}
      description={t("deleteOneDesc")}
      footer={<>
        <Button variant="outline" disabled={state.busy} onClick={() => controller.cancel()}>{t("cancel")}</Button>
        <DeleteButton disabled={state.busy} onClick={() => { void controller.confirm(); }}>
          {state.busy ? t("removing") : t("confirmDelete")}
        </DeleteButton>
      </>}>
      {state.error ? <p role="alert" className="sk-arch__note--error">{t("removeFailed").replace("{reason}", state.error)}</p> : null}
    </Modal>;
  }
  const offMenu = ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
    name: "sidebar.workspaces.session.menu.item", id: "dsh-toolkit.archived.delete", order: 500,
  }, DeleteSessionMenuItem));
  const offDialog = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay", id: "dsh-toolkit.archived.delete-confirm",
  }, RemovalDialog));
  return () => { offDialog(); offMenu(); };
}
