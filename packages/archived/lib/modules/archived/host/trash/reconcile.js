import { clearPendingDeletion, listPendingDeletions } from "./files.js";
/** The registry-global archive set, without letting an unstarted registry break a request. */
export function archivedIds(ctx) {
    try {
        const ids = ctx.workspaceRegistry?.archivedSessionIds;
        return Array.isArray(ids) ? ids : [];
    }
    catch {
        return [];
    }
}
/**
 * Sessions deleted from disk while the host still held them in memory.
 *
 * Reading the list is also the moment to retire tombstones: this only ever asks
 * once the page is back up, and a marker whose session the host no longer holds
 * (i.e. after a restart) can be dropped right then. Pruning here instead of at
 * startup keeps it deterministic — plugin startup must not depend on I/O timing.
 */
export async function pendingDeletions(ctx) {
    await pruneArchivedTombstones(ctx);
    return listPendingDeletions();
}
/**
 * Retire markers whose session is no longer held in memory, cleaning up the
 * registration that was left behind as its tombstone.
 *
 * A tombstone becomes removable only once the session left memory — i.e. after a
 * restart. Without this pass a registration would outlive its session forever and
 * resurface as an unreadable archived row.
 */
export async function pruneArchivedTombstones(ctx) {
    const markers = await listPendingDeletions();
    if (markers.length === 0)
        return [];
    const registry = ctx.workspaceRegistry;
    const pruned = [];
    for (const sessionId of markers) {
        // Still held: the host owns the record, and unarchiving it would put a session
        // whose files are gone back into the sidebar.
        if (ctx.sessions?.get?.(sessionId) !== undefined)
            continue;
        try {
            if (registry !== undefined) {
                await registry.unarchiveSession(sessionId);
                await registry.unpinSession?.(sessionId);
            }
        }
        catch {
            // Keep the marker: the next read retries with the same inputs.
            continue;
        }
        // Only drop the marker once the registration is really gone, otherwise the row
        // would reappear in the archived list with no files behind it.
        if (await clearPendingDeletion(sessionId))
            pruned.push(sessionId);
    }
    return pruned;
}
//# sourceMappingURL=reconcile.js.map