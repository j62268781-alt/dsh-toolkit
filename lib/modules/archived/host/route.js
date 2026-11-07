import { sendJson } from "../../../host/http.js";
import { registerAuthenticatedRoute } from "../../../host/routes.js";
import { DELETE_SESSION_PATH, PENDING_DELETIONS_PATH } from "./paths.js";
import { deleteSessionFiles, markPendingDeletion } from "./files.js";
import { archivedIds, pendingDeletions } from "./reconcile.js";

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

/** `move-failed` is almost always a held handle or a permission denial: retryable, not corrupt. */
function failure(result) {
  if (result.reason === "invalid-session-id" || result.reason === "not-found") {
    return [404, { ok: false, reason: result.reason }];
  }
  if (result.reason.startsWith("move-failed")) return [409, { ok: false, reason: "session-busy" }];
  return [500, { ok: false, reason: result.reason }];
}

export function registerDeleteSessionRoute(ctx) {
  const route = {
    kind: "exact",
    path: DELETE_SESSION_PATH,
    handler(req, res) {
      const send = (status, payload) => sendJson(res, status, payload);
      res.setHeader("cache-control", "no-store");
      if (req.method !== "POST") {
        send(404, { ok: false, reason: "not-found" });
        return;
      }

      let raw = "";
      let oversized = false;
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
        // Preserve the original limit on the decoded raw input, including Unicode.
        if (raw.length > 8_192) {
          oversized = true;
          req.destroy();
        }
      });
      req.on("end", () => {
        if (oversized) return;
        let sessionId;
        try {
          sessionId = JSON.parse(raw)?.sessionId;
        } catch {
          send(400, { ok: false, reason: "bad-json" });
          return;
        }
        if (typeof sessionId !== "string" || sessionId === "") {
          send(400, { ok: false, reason: "bad-session-id" });
          return;
        }
        deleteArchivedSession(ctx, sessionId).then(
          ([status, payload]) => send(status, payload),
          // Anything thrown after the body was accepted (a failed flush, a rejected
          // rename) must still answer the caller instead of dying as an unhandled
          // rejection: the deletion did not happen and the files are still there.
          (error) => send(500, { ok: false, reason: String(error?.message ?? error) }),
        );
      });
    },
  };
  return registerAuthenticatedRoute(ctx, route);
}

async function deleteArchivedSession(ctx, sessionId) {
  const live = ctx.sessions?.get?.(sessionId);
  if (live === undefined || live === null) {
    const result = await deleteSessionFiles(sessionId);
    return result.ok ? [200, result] : failure(result);
  }

  // A session still held in memory but no longer archived is in use by the
  // ordinary sidebar; deleting its files behind that list is not our call.
  if (!archivedIds(ctx).includes(sessionId)) return [409, { ok: false, reason: "session-loaded" }];
  if (busy(ctx, sessionId)) return [409, { ok: false, reason: "session-busy" }];

  // Idle persistence still buffers ~200ms of events; move only after they land.
  if (typeof ctx.sessions.flush === "function") await ctx.sessions.flush(live);
  // `flush` awaited real I/O: re-check the verdicts it may have invalidated.
  if (!archivedIds(ctx).includes(sessionId)) return [409, { ok: false, reason: "session-loaded" }];
  if (busy(ctx, sessionId)) return [409, { ok: false, reason: "session-busy" }];

  // Never unarchive here: the host still holds the session, so clearing the
  // registration would put it back in the sidebar, where it could be opened and
  // would write a fresh log into the directory just moved away. The registration
  // stays as the tombstone that hides it; the marker written below lets the list
  // retire it once the host no longer holds the session. See reconcile.js.
  const result = await deleteSessionFiles(sessionId);
  if (result.ok) {
    await markPendingDeletion(sessionId);
    return [200, { ok: true, moved: result.moved, retained: true }];
  }
  if (result.reason === "not-found") {
    await markPendingDeletion(sessionId);
    return [200, { ok: true, retained: true }];
  }
  return failure(result);
}

/** Read-only: the archived list filters these ids out so deletions survive a reload. */
export function registerPendingDeletionsRoute(ctx) {
  return registerAuthenticatedRoute(ctx, {
    kind: "exact",
    path: PENDING_DELETIONS_PATH,
    async handler(req, res) {
      res.setHeader("cache-control", "no-store");
      if (req.method !== "GET") {
        sendJson(res, 404, { ok: false, reason: "not-found" });
        return;
      }
      try {
        sendJson(res, 200, { ok: true, sessionIds: await pendingDeletions(ctx) });
      } catch (error) {
        sendJson(res, 500, { ok: false, reason: String(error?.message ?? error) });
      }
    },
  });
}
