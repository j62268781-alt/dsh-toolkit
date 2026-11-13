import { archivedIds } from "./reconcile.js";
import type { TrashFailure, TrashResult } from "./files.js";
import { deleteSessionFiles, markPendingDeletion } from "./files.js";

/**
 * What a deletion attempt answers, in domain terms.
 *
 * `retained` marks a session whose files moved but whose archive registration stays
 * behind as a tombstone; `moved` is the trash path, for logs and tests.
 */
export interface DeletionFailure {
  ok: false;
  reason: string;
}
export interface DeletionSuccess {
  ok: true;
  moved?: string;
  retained?: boolean;
}
export type DeletionResult = DeletionSuccess | DeletionFailure;

/**
 * "Busy" is the host's own notion (`agent.status`), not "the store still holds it".
 *
 * `ctx.sessions.get(id)` also answers for idle sessions that were merely opened in
 * this process — the host keeps them in memory with no eviction API — so treating
 * that as busy is what made every archived session undeletable.
 */
function busy(ctx: any, sessionId: string): boolean {
  const status = ctx.agents?.get?.(sessionId)?.status;
  return status !== undefined && status !== "idle";
}

/**
 * Delete one archived session's files, and nothing else.
 *
 * Answers a domain outcome (`{ok:true, moved?, retained?}` or `{ok:false, reason}`);
 * mapping that onto an HTTP status is the route's job, so this stays callable from
 * a test or a future CLI without inventing a receipt shape.
 */
export async function deleteArchivedSession(ctx: any, sessionId: string): Promise<DeletionResult> {
  const live = ctx.sessions?.get?.(sessionId);
  if (live === undefined || live === null) {
    return deleteSessionFiles(sessionId);
  }

  // A session still held in memory but no longer archived is in use by the
  // ordinary sidebar; deleting its files behind that list is not our call.
  if (!archivedIds(ctx).includes(sessionId)) return { ok: false, reason: "session-loaded" };
  if (busy(ctx, sessionId)) return { ok: false, reason: "session-busy" };

  // Idle persistence still buffers ~200ms of events; move only after they land.
  if (typeof ctx.sessions.flush === "function") await ctx.sessions.flush(live);
  // `flush` awaited real I/O: re-check the verdicts it may have invalidated.
  if (!archivedIds(ctx).includes(sessionId)) return { ok: false, reason: "session-loaded" };
  if (busy(ctx, sessionId)) return { ok: false, reason: "session-busy" };

  // Never unarchive here: the host still holds the session, so clearing the
  // registration would put it back in the sidebar, where it could be opened and
  // would write a fresh log into the directory just moved away. The registration
  // stays as the tombstone that hides it; the marker written below lets the list
  // retire it once the host no longer holds the session. See reconcile.js.
  const result = await deleteSessionFiles(sessionId);
  // Compare against the literal instead of relying on truthiness: with
  // `strictNullChecks` off (the emit program) `if (result.ok)` does not narrow a
  // discriminated union, so `reason` would not be reachable below.
  if (result.ok === true) {
    await markPendingDeletion(sessionId);
    return { ok: true, moved: result.moved, retained: true };
  }
  const failure = result as TrashFailure;
  if (failure.reason === "not-found") {
    await markPendingDeletion(sessionId);
    return { ok: true, retained: true };
  }
  return failure;
}

/**
 * Delete a page of archived sessions, one verdict per id.
 *
 * Serial on purpose: two deletes of the same session directory would race on the
 * rename, and the host's flush is per-session anyway. A throw (failed flush,
 * rejected rename) is one row's problem, not the batch's.
 */
export async function deleteArchivedSessions(ctx: any, sessionIds: readonly string[]): Promise<Array<{ sessionId: string; result: DeletionResult }>> {
  const results = [];
  for (const sessionId of sessionIds) {
    let result: DeletionResult;
    try {
      result = await deleteArchivedSession(ctx, sessionId);
    } catch (error) {
      result = { ok: false, reason: String((error as Error | undefined)?.message ?? error) };
    }
    results.push({ sessionId, result });
  }
  return results;
}
