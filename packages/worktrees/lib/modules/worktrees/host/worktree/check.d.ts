export interface WorktreeCheckRecord {
    path: string;
    repositoryRoot: string;
    branch: string;
    baseCommit: string;
}
export type WorktreeCheckReason = 'clean' | 'archive-unknown' | 'not-archived' | 'checkout-missing' | 'checkout-mismatch' | 'locked' | 'prunable' | 'dirty' | 'in-use' | 'check-unavailable';
export interface VerifiedCheckout {
    head: string;
    commonDir: string;
    objectFormat: 'sha1' | 'sha256';
}
type CheckoutFailure = Exclude<WorktreeCheckReason, 'clean'>;
export declare const commitId: RegExp;
export declare function checkoutPresence(record: WorktreeCheckRecord): Promise<'checkout-missing' | 'checkout-mismatch' | undefined>;
/** Advisory only; the result is not permission to remove a checkout. */
export declare function checkManagedCheckout(ctx: any, record: WorktreeCheckRecord, signal: AbortSignal): Promise<WorktreeCheckReason>;
export declare function verifyManagedCheckout(ctx: any, record: WorktreeCheckRecord, signal: AbortSignal): Promise<VerifiedCheckout | CheckoutFailure>;
export {};
