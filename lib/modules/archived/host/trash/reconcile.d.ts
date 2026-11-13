/** The registry-global archive set, without letting an unstarted registry break a request. */
export declare function archivedIds(ctx: any): string[];
/**
 * Sessions deleted from disk while the host still held them in memory.
 *
 * Reading the list is also the moment to retire tombstones: this only ever asks
 * once the page is back up, and a marker whose session the host no longer holds
 * (i.e. after a restart) can be dropped right then. Pruning here instead of at
 * startup keeps it deterministic — plugin startup must not depend on I/O timing.
 */
export declare function pendingDeletions(ctx: any): Promise<string[]>;
/**
 * Retire markers whose session is no longer held in memory, cleaning up the
 * registration that was left behind as its tombstone.
 *
 * A tombstone becomes removable only once the session left memory — i.e. after a
 * restart. Without this pass a registration would outlive its session forever and
 * resurface as an unreadable archived row.
 */
export declare function pruneArchivedTombstones(ctx: any): Promise<string[]>;
//# sourceMappingURL=reconcile.d.ts.map