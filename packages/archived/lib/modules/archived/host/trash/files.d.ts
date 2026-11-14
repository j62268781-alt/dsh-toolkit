import type { DeletionResult } from "./deletion.js";
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
/**
 * Move one session's directory out of `sessions/` and into the trash.
 *
 * Answers the same result vocabulary as the domain (`./deletion.js`): moving to the
 * trash *is* the deletion, so success is `code: "deleted"`. A held handle or a denied
 * permission surfaces as `move-failed` with the system text in `detail` — the caller
 * branches on the code and never has to parse that message.
 */
export declare function deleteSessionFiles(sessionId: string): Promise<DeletionResult>;
//# sourceMappingURL=files.d.ts.map