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
export type DeletionCode = "deleted" | "retained" | "invalid-session-id" | "no-sessions-directory" | "not-found" | "move-failed" | "session-loaded" | "session-busy" | "unknown";
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
 * Delete one archived session's files, and nothing else.
 *
 * Answers a domain result (`{ok:true, code}` or `{ok:false, code, detail?}`); mapping
 * that onto an HTTP status is the route's job, so this stays callable from a test or
 * a future CLI without inventing a receipt shape.
 */
export declare function deleteArchivedSession(ctx: any, sessionId: string): Promise<DeletionResult>;
/**
 * Delete a page of archived sessions, one verdict per id.
 *
 * Serial on purpose: two deletes of the same session directory would race on the
 * rename, and the host's flush is per-session anyway. A throw (failed flush,
 * rejected rename) is one row's problem, not the batch's.
 */
export declare function deleteArchivedSessions(ctx: any, sessionIds: readonly string[]): Promise<Array<{
    sessionId: string;
    result: DeletionResult;
}>>;
//# sourceMappingURL=deletion.d.ts.map