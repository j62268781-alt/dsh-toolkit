import { archivedIds } from "./reconcile.js";
import { deleteSessionFiles, markPendingDeletion } from "./files.js";
import { DELETION_CODE } from "../constants.js";
/**
 * "Busy" is the host's own notion (`agent.status`), not "the store still holds it".
 *
 * `ctx.sessions.get(id)` also answers for idle sessions that were merely opened in
 * this process — the host keeps them in memory with no eviction API — so treating
 * that as busy is what made every archived session undeletable.
 */
function busy(ctx, sessionId) {
    const status = ctx.agents?.get?.(sessionId)?.status;
    return status !== undefined && status !== "idle";
}
/**
 * Delete one archived session's files, and nothing else.
 *
 * Answers a domain result (`{ok:true, code}` or `{ok:false, code, detail?}`); mapping
 * that onto an HTTP status is the route's job, so this stays callable from a test or
 * a future CLI without inventing a receipt shape.
 */
export async function deleteArchivedSession(ctx, sessionId) {
    const live = ctx.sessions?.get?.(sessionId);
    if (live === undefined || live === null) {
        return deleteSessionFiles(sessionId);
    }
    // A session still held in memory but no longer archived is in use by the
    // ordinary sidebar; deleting its files behind that list is not our call.
    if (!archivedIds(ctx).includes(sessionId))
        return { ok: false, code: DELETION_CODE.sessionLoaded };
    if (busy(ctx, sessionId))
        return { ok: false, code: DELETION_CODE.sessionBusy };
    // Idle persistence still buffers ~200ms of events; move only after they land.
    if (typeof ctx.sessions.flush === "function")
        await ctx.sessions.flush(live);
    // `flush` awaited real I/O: re-check the verdicts it may have invalidated.
    if (!archivedIds(ctx).includes(sessionId))
        return { ok: false, code: DELETION_CODE.sessionLoaded };
    if (busy(ctx, sessionId))
        return { ok: false, code: DELETION_CODE.sessionBusy };
    // Never unarchive here: the host still holds the session, so clearing the
    // registration would put it back in the sidebar, where it could be opened and
    // would write a fresh log into the directory just moved away. The registration
    // stays as the tombstone that hides it; the marker written below lets the list
    // retire it once the host no longer holds the session. See reconcile.js.
    const result = await deleteSessionFiles(sessionId);
    // Compare against the literal instead of relying on truthiness: with
    // `strictNullChecks` off (the emit program) `if (result.ok)` does not narrow a
    // discriminated union, so `code` would not be reachable below.
    if (result.ok === true) {
        await markPendingDeletion(sessionId);
        return { ok: true, code: DELETION_CODE.retained, moved: result.moved };
    }
    // The files are already gone: clearing this registration is the only work left,
    // and the marker is what lets that happen once the host releases the session.
    if (result.code === DELETION_CODE.notFound) {
        await markPendingDeletion(sessionId);
        return { ok: true, code: DELETION_CODE.retained };
    }
    return result;
}
/**
 * Delete a page of archived sessions, one verdict per id.
 *
 * Serial on purpose: two deletes of the same session directory would race on the
 * rename, and the host's flush is per-session anyway. A throw (failed flush,
 * rejected rename) is one row's problem, not the batch's.
 */
export async function deleteArchivedSessions(ctx, sessionIds) {
    const results = [];
    for (const sessionId of sessionIds) {
        let result;
        try {
            result = await deleteArchivedSession(ctx, sessionId);
        }
        catch (error) {
            result = { ok: false, code: DELETION_CODE.unknown, detail: String(error?.message ?? error) };
        }
        results.push({ sessionId, result });
    }
    return results;
}
//# sourceMappingURL=deletion.js.map