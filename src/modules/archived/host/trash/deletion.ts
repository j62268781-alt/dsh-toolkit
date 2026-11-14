import { archivedIds } from "./reconcile.js";
import { deleteSessionFiles, markPendingDeletion } from "./files.js";

/**
 * 删除一个 session 的结果码 —— 这个模块对外的全部词汇。
 *
 * 以前失败只回 `reason` 字符串，`move-failed: <系统错误>` 那种拼串既没法穷举，路由
 * 还得靠 `startsWith` / `===` 去猜意图，客户端再按猜出来的字符串分支：一处措辞改动
 * 会静默改掉 HTTP 状态码。现在判断只认 `code`，`detail` 只给日志和人看。
 *
 * 成功只有两种：`deleted`（目录已搬进回收站）与 `retained`（文件搬走了，但归档登记
 * 作为 tombstone 留在宿主里，因为宿主还持有这个 session）。
 */
export type DeletionCode =
  | "deleted"
  | "retained"
  | "invalid-session-id"
  | "no-sessions-directory"
  | "not-found"
  | "move-failed"
  | "session-loaded"
  | "session-busy"
  | "unknown";

export interface DeletionSuccess {
  ok: true;
  code: "deleted" | "retained";
  /** 回收站里的落点，给日志和测试看。 */
  moved?: string;
}
export interface DeletionFailure {
  ok: false;
  code: Exclude<DeletionCode, "deleted" | "retained">;
  /** 系统原始错误信息（rename 的 EPERM、flush 抛出的 message），不参与判断。 */
  detail?: string;
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
 * Answers a domain result (`{ok:true, code}` or `{ok:false, code, detail?}`); mapping
 * that onto an HTTP status is the route's job, so this stays callable from a test or
 * a future CLI without inventing a receipt shape.
 */
export async function deleteArchivedSession(ctx: any, sessionId: string): Promise<DeletionResult> {
  const live = ctx.sessions?.get?.(sessionId);
  if (live === undefined || live === null) {
    return deleteSessionFiles(sessionId);
  }

  // A session still held in memory but no longer archived is in use by the
  // ordinary sidebar; deleting its files behind that list is not our call.
  if (!archivedIds(ctx).includes(sessionId)) return { ok: false, code: "session-loaded" };
  if (busy(ctx, sessionId)) return { ok: false, code: "session-busy" };

  // Idle persistence still buffers ~200ms of events; move only after they land.
  if (typeof ctx.sessions.flush === "function") await ctx.sessions.flush(live);
  // `flush` awaited real I/O: re-check the verdicts it may have invalidated.
  if (!archivedIds(ctx).includes(sessionId)) return { ok: false, code: "session-loaded" };
  if (busy(ctx, sessionId)) return { ok: false, code: "session-busy" };

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
    return { ok: true, code: "retained", moved: result.moved };
  }
  // The files are already gone: clearing this registration is the only work left,
  // and the marker is what lets that happen once the host releases the session.
  if (result.code === "not-found") {
    await markPendingDeletion(sessionId);
    return { ok: true, code: "retained" };
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
export async function deleteArchivedSessions(ctx: any, sessionIds: readonly string[]): Promise<Array<{ sessionId: string; result: DeletionResult }>> {
  const results = [];
  for (const sessionId of sessionIds) {
    let result: DeletionResult;
    try {
      result = await deleteArchivedSession(ctx, sessionId);
    } catch (error) {
      result = { ok: false, code: "unknown", detail: String((error as Error | undefined)?.message ?? error) };
    }
    results.push({ sessionId, result });
  }
  return results;
}
