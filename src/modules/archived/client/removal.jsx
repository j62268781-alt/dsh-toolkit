import React from "react";
import { ARCH_NS } from "./locale.js";
import { removeSessionViaHost, removeSessionsViaHost, readPendingDeletions } from "./deletion.js";

const primitives = (() => {
  try { return require("@deepseek-ai/dsh-client-ui-primitives"); } catch { return {}; }
})();

/**
 * The host Button has no loading state, so the ring is drawn here.
 *
 * `aria-busy` is what the sheet keys on to keep a working button at full opacity:
 * a delete in flight is unavailable, not disabled, and graying it out was most of
 * what read as "the page flashed".
 */
export function DeleteButton({ children, size = "md", className, loading = false, ...props }) {
  const Button = primitives.Button;
  const Icon = primitives.IconTrashOutlineRegular;
  const classes = className === undefined ? "sk-arch__delete" : `sk-arch__delete ${className}`;
  const spinner = loading ? <span className="sk-arch__spinner" aria-hidden="true" /> : null;
  if (Button === undefined) {
    return <button type="button" className={classes} aria-busy={loading || undefined} {...props}>
      {spinner}
      {children}
    </button>;
  }
  return <Button type="button" variant="outline" size={size} className={classes}
    aria-busy={loading || undefined}
    icon={spinner ?? (Icon ? <Icon size={16} /> : undefined)} {...props}>
    {children}
  </Button>;
}

/** Merge per-Session requests onto one queue so two dialogs never stack. */
export function createRemoval(ctx) {
  const t = ctx.locale.bind(ARCH_NS);
  // `pending` is the set of ids the host is working on right now; `busyKind` says
  // whether the batch or a single row started it. Both feed the buttons that stay
  // on screen after the dialog closes, so the list never has to render a status row.
  let state = {
    request: null,
    busy: false,
    busyKind: null,
    error: "",
    note: "",
    // Rows the archived page must stop listing: everything this page deleted, plus
    // the tombstones the host reported after a reload.
    removed: new Set(),
    // Rows the sidebar must stop drawing. Narrower than `removed`: a session the
    // Workspace released comes back as an ordinary row, and hiding that would make
    // a healthy session disappear.
    hidden: new Set(),
    pending: new Set(),
  };
  const listeners = new Set();
  const update = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  /**
   * Fold the host's pending markers into `removed` and `hidden`.
   *
   * A marker names a session whose files moved while the host still held it: the
   * archive registration survives as a tombstone until a restart, so the archived
   * page and the sidebar both have to keep hiding it. Read once at start, then once
   * per batch, because a marker only ever appears because of a delete.
   */
  const syncTombstones = async () => {
    const markers = await readPendingDeletions();
    if (markers.size === 0) return;
    const removed = new Set(state.removed);
    const hidden = new Set(state.hidden);
    const patch = {};
    for (const id of markers) {
      if (!removed.has(id)) { removed.add(id); patch.removed = removed; }
      if (!hidden.has(id)) { hidden.add(id); patch.hidden = hidden; }
    }
    if (Object.keys(patch).length > 0) update(patch);
  };
  const controller = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    syncTombstones,
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
      const ids = request.rows.map((row) => row.id);
      const before = state.removed;
      // Close the dialog before the first await and let the buttons carry the wait:
      // the deletions run against host-side I/O (rename, flush) and a modal parked
      // over that window is what made the action read as stuck.
      update({ request: null, busy: true, busyKind: request.kind, error: "", note: "", pending: new Set(ids) });

      const receipts = await collectReceipts(request, ids);
      const doneIds = [];
      const retainedIds = new Set();
      const failed = [];
      const errors = [];
      for (const row of request.rows) {
        const receipt = receipts.get(row.id) ?? { ok: false, reason: "no-receipt" };
        // The files are already gone (workspace deleted, disk cleanup, an older
        // delete): clearing the archive metadata is the only work left, and it is
        // what keeps such a record from staying archived forever.
        const alreadyGone = receipt.reason === "not-found";
        if (receipt.ok !== true && !alreadyGone) {
          failed.push(row);
          const reason = String(receipt.reason ?? "unknown");
          errors.push(request.kind === "all" ? `${row.title || row.id}: ${reason}` : reason);
          continue;
        }
        doneIds.push(row.id);
        if (receipt.retained === true) retainedIds.add(row.id);
      }

      // These metadata commands remain valid after the session files are gone.
      // Retained rows keep their registration on purpose: it is the tombstone that
      // hides a session the host still holds (see host/route.js).
      await Promise.allSettled(doneIds
        .filter((id) => !retainedIds.has(id))
        .flatMap((id) => [
          Promise.resolve().then(() => ctx.workspaces.unarchiveSession(id)),
          Promise.resolve().then(() => ctx.workspaces.unpinSession(id)),
        ]));

      if (doneIds.length > 0) {
        // A full session list refresh is another round trip; land it in the
        // background so it cannot extend the window the page spends deleting.
        void Promise.resolve()
          .then(() => ctx.sessions.refresh?.())
          .catch(() => {});
      }

      // One commit at the end: the rows a batch deleted disappear together instead
      // of the list collapsing row by row while the host answers.
      const removed = new Set(before);
      for (const id of doneIds) removed.add(id);
      const hidden = new Set(state.hidden);
      for (const id of retainedIds) hidden.add(id);
      // Deleting archived sessions never touches the Workspace: the workspace
      // registry, its directory, and any unarchived sessions stay as they are.
      update({
        busy: false,
        busyKind: null,
        pending: new Set(),
        removed,
        hidden,
        note: retainedIds.size === 0 ? "" : t("deleteRetained").replace("{t}", String(retainedIds.size)),
        request: failed.length === 0 ? null : { kind: request.kind, rows: failed },
        error: errors.join("；"),
      });
      // The markers the host wrote for this batch: another page opened later has to
      // hide the same rows, and this page may have missed a receipt the markers know.
      void syncTombstones();
    },
  };
  void syncTombstones();
  return controller;
}

/**
 * One round trip for a page of rows; the single route answers when only one row is
 * involved. Either way the answer is a receipt per id, because the host decides
 * each session alone (loaded, running, half-moved).
 */
async function collectReceipts(request, ids) {
  const receipts = new Map();
  if (request.kind === "all") {
    const response = await removeSessionsViaHost(ids);
    if (response.ok) {
      for (const receipt of response.results) {
        if (receipt !== null && typeof receipt?.sessionId === "string") receipts.set(receipt.sessionId, receipt);
      }
      return receipts;
    }
    for (const id of ids) receipts.set(id, { ok: false, reason: response.reason });
    return receipts;
  }
  const [row] = request.rows;
  receipts.set(row.id, await removeSessionViaHost(row.id));
  return receipts;
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
          <Button variant="outline" onClick={() => controller.cancel()}>{t("cancel")}</Button>
          <DeleteButton onClick={() => { void controller.confirm(); }}>{t("confirmDelete")}</DeleteButton>
        </>}>
        {state.error ? <p role="alert" className="sk-arch__note--error">{t("removeFailed").replace("{reason}", state.error)}</p> : null}
      </Modal>;
    }
    const title = state.request.rows[0]?.title || t("untitled");
    return <Modal open title={t("deleteOneTitle").replace("{t}", title)} closeLabel={t("cancel")}
      onClose={() => controller.cancel()}
      description={t("deleteOneDesc")}
      footer={<>
        <Button variant="outline" onClick={() => controller.cancel()}>{t("cancel")}</Button>
        <DeleteButton onClick={() => { void controller.confirm(); }}>{t("confirmDelete")}</DeleteButton>
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
