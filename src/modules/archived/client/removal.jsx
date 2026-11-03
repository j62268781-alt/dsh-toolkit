import React from "react";
import { ARCH_NS } from "./locale.js";
import { removeSessionViaHost } from "./deletion.js";

const primitives = (() => {
  try { return require("@deepseek-ai/dsh-client-ui-primitives"); } catch { return {}; }
})();

export function DeleteButton({ children, size = "md", ...props }) {
  const Button = primitives.Button ?? "button";
  const Icon = primitives.IconTrashOutlineRegular;
  return <Button type="button" variant="outline" size={size} className="sk-arch__delete"
    icon={Icon ? <Icon size={16} /> : undefined} {...props}>
    {children}
  </Button>;
}

export function createRemoval(ctx) {
  let state = { request: null, busy: false, error: "", removed: new Set() };
  const listeners = new Set();
  const update = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const controller = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    request(row) { if (!state.busy) update({ request: { rows: [row] }, error: "" }); },
    requestGroup(title, rows) {
      const unique = [...new Map(rows.filter((row) => !state.removed.has(row.id)).map((row) => [row.id, row])).values()];
      if (!state.busy && unique.length) update({ request: { title, rows: unique, bulk: true }, error: "" });
    },
    cancel() { if (!state.busy) update({ request: null, error: "" }); },
    async confirm() {
      if (!state.request || state.busy) return;
      const request = state.request;
      const failed = [];
      const errors = [];
      let completed = 0;
      update({ busy: true, error: "" });
      for (const row of request.rows) {
        const result = await removeSessionViaHost(row.id);
        if (result?.ok !== true) {
          failed.push(row);
          errors.push(`${request.bulk ? `${row.title || row.id}: ` : ""}${String(result?.reason ?? "unknown")}`);
          continue;
        }
        completed++;
        update({ removed: new Set(state.removed).add(row.id) });
        // These metadata commands remain valid after the session files are gone.
        await Promise.allSettled([
          Promise.resolve().then(() => ctx.workspaces.unarchiveSession(row.id)),
          Promise.resolve().then(() => ctx.workspaces.unpinSession(row.id)),
        ]);
      }
      if (completed) {
        try { await ctx.sessions.refresh?.(); } catch {}
      }
      update({ busy: false, request: failed.length ? { ...request, rows: failed } : null, error: errors.join("；") });
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
  function DeleteSessionDialog() {
    const state = useRemoval(controller);
    const Modal = primitives.Modal;
    const Button = primitives.Button ?? "button";
    if (!state.request || !Modal) return null;
    const description = state.request.bulk
      ? t("confirmRemoveGroup").replace("{t}", state.request.title).replace("{n}", String(state.request.rows.length))
      : t("confirmRemove").replace("{t}", state.request.rows[0].title || t("untitled"));
    return <Modal open title={t(state.request.bulk ? "removeAll" : "removeSession")} closeLabel={t("cancel")}
      onClose={() => controller.cancel()}
      description={description}
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
  }, DeleteSessionDialog));
  return () => { offDialog(); offMenu(); };
}
