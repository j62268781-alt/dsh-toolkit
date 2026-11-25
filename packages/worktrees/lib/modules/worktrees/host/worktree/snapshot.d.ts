import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import { type WorktreeCheckReason, type WorktreeCheckRecord } from './check.js';
interface SnapshotOwner extends WorktreeCheckRecord {
    sessionId: string;
}
type CaptureResult = {
    ok: true;
    commit: string;
} | {
    ok: false;
    reason: Exclude<WorktreeCheckReason, 'clean'> | 'snapshot-unavailable';
};
type RestoreResult = {
    ok: true;
    branch: string;
    commit: string;
} | {
    ok: false;
    reason: 'invalid-branch' | 'branch-in-use' | 'snapshot-unavailable' | 'restore-not-writable' | 'restore-unconfirmed';
};
/** Host-only. The caller must freshly authorize the native archived owner; this never makes removal safe. */
export declare function captureWorktreeSnapshot(ctx: any, owner: SnapshotOwner, policy: SandboxExecutionPolicy, signal: AbortSignal): Promise<CaptureResult>;
/** Resolve only the recorded pin, even after the checkout or original branch is gone. */
export declare function resolveWorktreeSnapshot(ctx: any, owner: SnapshotOwner, commit: string, signal: AbortSignal): Promise<string | undefined>;
/** Enumerate pins only for a previously authorized archived owner, on demand. */
export declare function listWorktreeSnapshots(ctx: any, owner: SnapshotOwner, signal: AbortSignal): Promise<string[]>;
/** Restore a local branch at the exact pin. No checkout, branch move, or fallback. */
export declare function restoreWorktreeSnapshot(ctx: any, owner: SnapshotOwner, commit: string, branch: string, policy: SandboxExecutionPolicy | undefined, authorize: () => Promise<SandboxExecutionPolicy | undefined>, signal: AbortSignal): Promise<RestoreResult>;
export {};
