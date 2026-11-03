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
  let state = { request: null, busy: false, error: "", removed: new Set() };
  const listeners = new Set();
  const update = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const controller = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    request(row) {
      if (!state.busy) update({ request: { kind: "one", rows: [row], groups: [] }, error: "" });
    },
    requestAll(groups) {
      const rows = [...new Map(
        groups.flatMap((group) => group.rows).filter((row) => !state.removed.has(row.id)).map((row) => [row.id, row]),
      ).values()];
      if (state.busy || rows.length === 0) return;
      update({
        request: { kind: "all", rows, groups: groups.filter((group) => group.rows.some((row) => !state.removed.has(row.id))) },
        error: "",
      });
    },
    cancel() { if (!state.busy) update({ request: null, error: "" }); },
    async confirm() {
      if (!state.request || state.busy) return;
      const request = state.request;
      const failed = [];
      const errors = [];
      let completed = 0;
      update({ busy: true, error: "" });
      const removedNow = new Set();
      for (const row of request.rows) {
        const result = await removeSessionViaHost(row.id);
        if (result?.ok !== true) {
          failed.push(row);
          const reason = String(result?.reason ?? "unknown");
          errors.push(request.kind === "all" ? `${row.title || row.id}: ${reason}` : reason);
          continue;
        }
        completed++;
        removedNow.add(row.id);
        update({ removed: new Set(state.removed).add(row.id) });
        // These metadata commands remain valid after the session files are gone.
        await Promise.allSettled([
          Promise.resolve().then(() => ctx.workspaces.unarchiveSession(row.id)),
          Promise.resolve().then(() => ctx.workspaces.unpinSession(row.id)),
        ]);
      }
      // A Workspace whose every Session is archived leaves with the list (the
      // registration only: its directory and any remaining files stay). Only
      // groups whose archived rows all deleted in this pass qualify.
      const remainingGroups = [];
      if (request.kind === "all") {
        for (const group of request.groups) {
          const allGone = group.fullyArchived && group.rows.every((row) => removedNow.has(row.id));
          if (!allGone) {
            remainingGroups.push(group);
            continue;
          }
          try {
            await ctx.workspaces.delete?.(group.workspaceId);
          } catch (error) {
            remainingGroups.push(group);
            errors.push(`${group.title || group.workspaceId}: ${String(error?.message ?? error)}`);
          }
        }
      }
      if (completed) {
        try { await ctx.sessions.refresh?.(); } catch {}
      }
      if (failed.length === 0) {
        update({ busy: false, request: null, error: errors.join("；") });
        return;
      }
      // Retrying must only re-send the failures, and only keep the groups whose
      // rows still exist, or an earlier success would look like a fresh failure.
      const failedIds = new Set(failed.map((row) => row.id));
      update({
        busy: false,
        request: {
          ...request,
          rows: failed,
          groups: request.kind === "all"
            ? remainingGroups
              .map((group) => ({ ...group, rows: group.rows.filter((row) => failedIds.has(row.id)) }))
              .filter((group) => group.rows.length > 0)
            : [],
        },
        error: errors.join("；"),
      });
    },
  };
  return controller;
}

export function useRemoval(controller) {
  return React.useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
}

function removalCounts(request) {
  return {
    workspaces: request.groups.filter((group) => group.id !== "__ungrouped").length,
    tasks: request.rows.length,
  };
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
      const { workspaces, tasks } = removalCounts(state.request);
      return <Modal open title={t("deleteAllTitle").replace("{w}", String(workspaces)).replace("{t}", String(tasks))}
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
