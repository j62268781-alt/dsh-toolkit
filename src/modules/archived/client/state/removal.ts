import { ARCH_NS } from "../locale.js";
import { readPendingDeletions, removeSessionViaHost, removeSessionsViaHost } from "../deletion.js";
import { failureText } from "../model.js";
import { DELETION_CODE } from "../constants.js";
import { createStore } from "../../../../client/ui/store.js";

/** A queued removal: `all` is the page batch, `one` a single row. */
export interface RemovalRequest {
  kind: "one" | "all";
  rows: any[];
}

/** Shape read by the dialogs and the two lists; the store's public state. */
export interface RemovalState {
  request: RemovalRequest | null;
  busy: boolean;
  busyKind: "one" | "all" | null;
  error: string;
  note: string;
  removed: Set<string>;
  hidden: Set<string>;
  pending: Set<string>;
}

/**
 * Merge per-Session requests onto one queue so two dialogs never stack.
 *
 * `pending` is the set of ids the host is working on right now; `busyKind` says
 * whether the batch or a single row started it. Both feed the buttons that stay on
 * screen after the dialog closes, so the list never has to render a status row.
 */
export function createRemoval(ctx) {
  const t = ctx.locale.bind(ARCH_NS);
  const store = createStore<RemovalState>({
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
  });

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
    const state = store.get();
    const removed = new Set(state.removed);
    const hidden = new Set(state.hidden);
    const patch: Partial<RemovalState> = {};
    for (const id of markers) {
      if (!removed.has(id)) { removed.add(id); patch.removed = removed; }
      if (!hidden.has(id)) { hidden.add(id); patch.hidden = hidden; }
    }
    if (Object.keys(patch).length > 0) store.set(patch);
  };

  const controller = {
    subscribe: store.subscribe,
    snapshot: store.snapshot,
    syncTombstones,
    request(row) {
      if (!store.get().busy) store.set({ request: { kind: "one", rows: [row] }, error: "" });
    },
    requestAll(groups) {
      const state = store.get();
      const rows = [...new Map(
        groups.flatMap((group) => group.rows).filter((row) => !state.removed.has(row.id)).map((row) => [row.id, row]),
      ).values()];
      if (state.busy || rows.length === 0) return;
      store.set({ request: { kind: "all", rows }, error: "" });
    },
    cancel() { if (!store.get().busy) store.set({ request: null, error: "" }); },
    async confirm() {
      const current = store.get();
      if (!current.request || current.busy) return;
      const request = current.request;
      const ids = request.rows.map((row) => row.id);
      const before = current.removed;
      // Close the dialog before the first await and let the buttons carry the wait:
      // the deletions run against host-side I/O (rename, flush) and a modal parked
      // over that window is what made the action read as stuck.
      store.set({ request: null, busy: true, busyKind: request.kind, error: "", note: "", pending: new Set(ids) });

      const receipts = await collectReceipts(request, ids);
      const doneIds: string[] = [];
      const retainedIds = new Set<string>();
      const failed: any[] = [];
      const errors: string[] = [];
      for (const row of request.rows) {
        const receipt = receipts.get(row.id) ?? { ok: false, code: DELETION_CODE.unknown };
        // The files are already gone (workspace deleted, disk cleanup, an older
        // delete): clearing the archive metadata is the only work left, and it is
        // what keeps such a record from staying archived forever.
        const alreadyGone = receipt.code === DELETION_CODE.notFound;
        if (receipt.ok !== true && !alreadyGone) {
          failed.push(row);
          const reason = failureText(t, receipt);
          errors.push(request.kind === "all" ? `${row.title || row.id}: ${reason}` : reason);
          continue;
        }
        doneIds.push(row.id);
        // `retained` = 文件搬走了但归档登记还留在宿主里（见 host/trash/deletion.js）。
        if (receipt.code === DELETION_CODE.retained) retainedIds.add(row.id);
      }

      // These metadata commands remain valid after the session files are gone.
      // Retained rows keep their registration on purpose: it is the tombstone that
      // hides a session the host still holds (see host/trash/deletion.js).
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
      const hidden = new Set(store.get().hidden);
      for (const id of retainedIds) hidden.add(id);
      // Deleting archived sessions never touches the Workspace: the workspace
      // registry, its directory, and any unarchived sessions stay as they are.
      store.set({
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
    for (const id of ids) receipts.set(id, { ok: false, code: response.code, detail: response.detail });
    return receipts;
  }
  const [row] = request.rows;
  receipts.set(row.id, await removeSessionViaHost(row.id));
  return receipts;
}
