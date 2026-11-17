import { type GitReasonKey } from './constants.js';
export interface GitCommandResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly spawnError?: Error;
}
export type GitRunner = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>;
export interface BranchSnapshot {
    readonly ok: true;
    readonly root: string;
    readonly branch: string;
    readonly detached: boolean;
    readonly dirty: boolean;
    readonly branches: readonly string[];
    /** 远端跟踪引用（`origin/main` 这种短名）；`origin/HEAD` 是符号引用，不算分支。 */
    readonly remotes: readonly string[];
}
export interface BranchFailure {
    readonly ok: false;
    readonly reason: GitReasonKey;
    /** 给面板看的一行原因（git 的 stderr 首行），不参与判断。 */
    readonly detail: string;
}
export type BranchResult = BranchSnapshot | BranchFailure;
export declare function createRepository(run?: GitRunner): {
    /** 一次拿全：仓库根、当前分支、是否有未提交改动、本地分支列表。 */
    snapshot(cwd: unknown): Promise<BranchResult>;
    checkout(cwd: unknown, name: unknown): Promise<BranchResult>;
    createBranch(cwd: unknown, name: unknown): Promise<BranchResult>;
};
//# sourceMappingURL=repository.d.ts.map