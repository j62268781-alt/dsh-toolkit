import type { JsonRouteSpec } from "../../../../host/routes.js";
import { pendingDeletions } from "../trash/reconcile.js";
import type { DeletionFailure, DeletionResult } from "../trash/deletion.js";
import { deleteArchivedSession, deleteArchivedSessions } from "../trash/deletion.js";
import { DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH } from "../constants.js";

/** One session id per single request; a page of rows arrives on the bulk route. */
const SINGLE_BODY_LIMIT = 8_192;
const BATCH_BODY_LIMIT = 65_536;
const BATCH_MAX_IDS = 500;

/**
 * Result code → HTTP status. One table, so a status can only change here.
 *
 * `move-failed` is almost always a held handle or a permission denial: retryable, not
 * corrupt, so it stays 409 like the other "try again later" codes. A missing
 * `sessions/` directory is a broken profile rather than a bad request: 500.
 */
const FAILURE_STATUS: Record<DeletionFailure["code"], number> = {
  "invalid-session-id": 404,
  "not-found": 404,
  "session-loaded": 409,
  "session-busy": 409,
  "move-failed": 409,
  "no-sessions-directory": 500,
  unknown: 500,
};

function statusOf(result: DeletionResult): number {
  if (result.ok === true) return 200;
  return FAILURE_STATUS[result.code];
}

/** The body carries the same code the domain decided on; `detail` is human-facing. */
function payloadOf(result: DeletionResult): Record<string, unknown> {
  if (result.ok === true) return { ok: true, code: result.code, moved: result.moved };
  return { ok: false, code: result.code, detail: result.detail };
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
        // 两个名字各管一件事，互不派生：`code` 是业务码（域层决定），`statusCode` 是
        // 单条如果单独发就应该是的 HTTP 状态 —— 批量整体 200，逐行带自己的状态。
        return [200, { ok: true, results: results.map(({ sessionId, result }) => ({
          sessionId,
          statusCode: statusOf(result),
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
