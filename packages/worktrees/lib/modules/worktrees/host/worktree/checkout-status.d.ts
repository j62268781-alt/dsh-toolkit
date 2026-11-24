export type CheckoutStatus = 'present' | 'missing' | 'unknown';
/** Report the recorded directory's current presence, not Git registration or cleanup eligibility. */
export declare function readCheckoutStatuses(worktrees: readonly {
    path: string;
}[], signal: AbortSignal): Promise<Map<string, CheckoutStatus>>;
