import type { JsonRouteSpec } from "../../../../host/routes.js";
import { pendingDeletions } from "../trash/reconcile.js";
import type { DeletionResult } from "../trash/deletion.js";
import { deleteArchivedSession, deleteArchivedSessions } from "../trash/deletion.js";
import { DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH } from "../constants.js";

/** One session id per single request; a page of rows arrives on the bulk route. */
const SINGLE_BODY_LIMIT = 8_192;
const BATCH_BODY_LIMIT = 65_536;
const BATCH_MAX_IDS = 500;

/**
 * Domain outcome → HTTP status.
 *
 * `move-failed` is almost always a held handle or a permission denial: retryable,
 * not corrupt, so the caller is told the session is busy and never which system
 * error fired.
 */
function statusOf(result: DeletionResult): number {
  if (result.ok === true) return 200;
  if (result.reason.startsWith("move-failed")) return 409;
  if (result.reason === "invalid-session-id" || result.reason === "not-found") return 404;
  if (result.reason === "session-loaded" || result.reason === "session-busy") return 409;
  return 500;
}

function payloadOf(result: DeletionResult): Record<string, unknown> {
  if (result.ok === true) return { ...result };
  if (result.reason.startsWith("move-failed")) return { ok: false, reason: "session-busy" };
  return { ok: false, reason: result.reason };
}

function receipt(result: DeletionResult): [number, unknown] {
  return [statusOf(result), payloadOf(result)];
}

/**
 * The three archived routes, as data.
 *
 * Everything protocol-shaped lives in `jsonRoute` (method guard, body cap, bad JSON,
 * thrown errors); this file only says which field to read and what the domain
 * answers. The bulk route is the same work as N single calls, one round trip: a row
 * that cannot go (loaded, running, half-moved) fails alone and the rest completes.
 */
export function createDeletionRoutes(): JsonRouteSpec[] {
  return [
    {
      path: DELETE_SESSION_PATH,
      limit: SINGLE_BODY_LIMIT,
      pick: (body) => body?.sessionId,
      check: (sessionId) => typeof sessionId === "string" && sessionId !== "",
      reason: "bad-session-id",
      run: async (ctx, sessionId) => receipt(await deleteArchivedSession(ctx, String(sessionId))),
    },
    {
      path: DELETE_SESSIONS_PATH,
      limit: BATCH_BODY_LIMIT,
      pick: (body) => body?.sessionIds,
      check: (sessionIds) =>
        Array.isArray(sessionIds) &&
        sessionIds.length > 0 &&
        sessionIds.length <= BATCH_MAX_IDS &&
        sessionIds.every((id) => typeof id === "string" && id !== ""),
      reason: "bad-session-ids",
      run: async (ctx, sessionIds) => {
        const results = await deleteArchivedSessions(ctx, sessionIds as string[]);
        return [200, { ok: true, results: results.map(({ sessionId, result }) => ({
          sessionId,
          status: statusOf(result),
          ...payloadOf(result),
        })) }];
      },
    },
    {
      // Read-only: the archived list filters these ids out so deletions survive a reload.
      path: PENDING_DELETIONS_PATH,
      method: "GET",
      run: async (ctx) => [200, { ok: true, sessionIds: await pendingDeletions(ctx) }],
    },
  ];
}
