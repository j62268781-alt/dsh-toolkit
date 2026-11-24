export interface ManagedWorktree {
    path: string;
    branch: string;
    repositoryRoot: string;
    sessionId: string;
    sessionTitle?: string;
}
export interface WorktreeSessionRecord {
    header: {
        id: string;
    };
    live?: boolean;
}
interface SessionProjection {
    worktree?: unknown;
    title?: unknown;
}
export type WorktreeRevision = {
    source: 'live';
    identity: symbol;
    revision: number;
} | {
    source: 'persisted';
    identity: symbol;
    revision: string;
};
interface WorktreeSources {
    listSessions(signal: AbortSignal): Promise<WorktreeSessionRecord[]>;
    revision(record: WorktreeSessionRecord): WorktreeRevision | undefined;
    readProjection(record: WorktreeSessionRecord, revision: WorktreeRevision | undefined, signal: AbortSignal): Promise<{
        values: SessionProjection;
        cacheable: boolean;
    } | null>;
    canRead?(id: string): boolean;
}
/** Keep compact, detached projections, not Session objects or full event logs. */
export declare function createManagedWorktreeIndex(): (sources: WorktreeSources, signal: AbortSignal) => Promise<ManagedWorktree[]>;
export {};
