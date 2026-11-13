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
 * Delete one archived session's files, and nothing else.
 *
 * Answers a domain outcome (`{ok:true, moved?, retained?}` or `{ok:false, reason}`);
 * mapping that onto an HTTP status is the route's job, so this stays callable from
 * a test or a future CLI without inventing a receipt shape.
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