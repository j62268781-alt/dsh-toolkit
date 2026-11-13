/** What moving a session to the trash can answer; the route interprets the leftovers. */
export interface TrashFailure {
    ok: false;
    reason: string;
}
export interface TrashSuccess {
    ok: true;
    moved: string;
}
export type TrashResult = TrashSuccess | TrashFailure;
/**
 * Remember a session whose files were moved while the host still held it in memory.
 *
 * Such a session keeps its archive registration on purpose (that is what hides the
 * record once the host can no longer be asked to drop it), so the deletion needs a
 * marker to survive a restart: the list filters marked ids out, and the next start
 * retires both the marker and the registration.
 */
export declare function markPendingDeletion(sessionId: string): Promise<boolean>;
/** Marked ids. An unreadable directory means "nothing to hide", never a crash. */
export declare function listPendingDeletions(): Promise<string[]>;
export declare function clearPendingDeletion(sessionId: string): Promise<boolean>;
export declare function deleteSessionFiles(sessionId: string): Promise<TrashResult>;
//# sourceMappingURL=files.d.ts.map