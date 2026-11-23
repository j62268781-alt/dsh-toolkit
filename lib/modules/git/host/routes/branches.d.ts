/**
 * 分支按钮的三条路由：读快照、切分支、建分支。
 *
 * 状态码只在这一层决定：领域层给 `{ok:false, reason}`，这里按「改输入能解决」和
 * 「当前状态不允许」分成 400 / 409。client 只认 `reason` 字符串，不解析文案。
 */
import type { JsonRouteSpec } from '../../../../host/routes.js';
import type { BranchResult } from '../repository.js';
interface Repository {
    snapshot(cwd: unknown): Promise<BranchResult>;
    checkout(cwd: unknown, name: unknown): Promise<BranchResult>;
    createBranch(cwd: unknown, name: unknown): Promise<BranchResult>;
}
export declare function createGitRoutes({ repository }: {
    repository: Repository;
}): JsonRouteSpec[];
export {};
