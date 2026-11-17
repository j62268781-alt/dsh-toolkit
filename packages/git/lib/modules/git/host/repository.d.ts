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
/**
 * 「执行一条会改动仓库状态的命令」的结果。
 *
 * 与 `BranchResult` 分开：切完/建完要回读快照给面板，而这些命令（提交、同步、删/改分支）
 * 只要「跑过什么、git 说了什么」，回读反而多一次进程调用。
 */
export interface CommandSuccess {
    readonly ok: true;
    /** 实际跑的命令（不含 `git` 本身），工具层拿它拼回显。 */
    readonly command: readonly string[];
    readonly stdout: string;
    readonly stderr: string;
}
export type CommandOutcome = CommandSuccess | BranchFailure;
/** 这个本地分支跟踪谁（`origin/main` 这种）；空串表示还没有上游。工具层也要用它写提示。 */
export declare function upstreamOf(run: GitRunner, cwd: string, branch: string): Promise<string>;
export declare function createRepository(run?: GitRunner): {
    /** 一次拿全：仓库根、当前分支、是否有未提交改动、本地分支列表。 */
    snapshot(cwd: unknown): Promise<BranchResult>;
    checkout(cwd: unknown, name: unknown): Promise<BranchResult>;
    createBranch(cwd: unknown, name: unknown): Promise<BranchResult>;
    /**
     * 提交改动。
     *
     * 三种入口按「谁来挑改动」分：`paths` 只提交指定路径、`all` 先 `add -A`、都不给则只提交
     * 已经暂存的内容。`diff --cached --quiet` 的退出码是这里的判别式（0=没有暂存内容，
     * 1=有），先探一次是因为空提交在任何入口下都是错的——尤其是模型「以为改过」的时候。
     */
    commit(cwd: unknown, message: unknown, options?: {
        readonly all?: boolean;
        readonly paths?: readonly string[];
    }): Promise<CommandOutcome>;
    /**
     * 同步远端：`fetch` 只更新跟踪引用，`pull` 把上游合进来（默认 rebase）。
     *
     * 三条前置检查都在本地做，因为它们各自的下一步完全不同：游离 HEAD（先切分支）、
     * 工作区脏（先提交或 stash）、没有上游（先推一次 -u）。交给 git 只能得到
     * 「failed to pull」一句话。
     */
    sync(cwd: unknown, action: unknown, rebase: unknown): Promise<CommandOutcome>;
    /** 删除本地分支：默认 `-d`（只删已合并的），要删未合并的必须显式 force。 */
    deleteBranch(cwd: unknown, name: unknown, force: unknown): Promise<CommandOutcome>;
    /** 重命名本地分支：`from` 省略时改当前分支。改名不会动远端，也不自动改上游名。 */
    renameBranch(cwd: unknown, from: unknown, to: unknown): Promise<CommandOutcome>;
};
//# sourceMappingURL=repository.d.ts.map