import { WORKTREE_CONFIG_PATH } from './constants.js';
import { registerManagedWorktreesRoute } from './routes/managed.js';
import { registerWorktreeConfigRoutes } from './routes/worktree-config.js';
export const name = 'dsh-toolkit-worktrees';
export const inject = ['webServer', 'connection'];
export function apply(ctx) {
    registerWorktreeConfigRoutes(ctx, WORKTREE_CONFIG_PATH);
    registerManagedWorktreesRoute(ctx);
}
