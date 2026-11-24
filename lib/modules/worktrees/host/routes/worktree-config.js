import { httpFailure, jsonRoute, registerAuthenticatedRoute } from '../../../../host/routes.js';
import { isWorktreeConfigUpdate, readWorktreeConfig, updateWorktreeConfig } from '../worktree/config.js';
export function registerWorktreeConfigRoutes(ctx, path) {
    // Optional on older hosts: resolve only once an owner request reaches the handler.
    const editor = () => {
        try {
            return ctx.get?.('configEditor');
        }
        catch {
            throw httpFailure(500, 'worktree-config-failed');
        }
    };
    const get = jsonRoute(ctx, {
        path,
        method: 'GET',
        run: () => [200, { ok: true, ...readWorktreeConfig(editor()) }],
    });
    const post = jsonRoute(ctx, {
        path,
        limit: 8192,
        check: isWorktreeConfigUpdate,
        reason: 'invalid-worktree-config',
        run: async (_ctx, value) => [200, { ok: true, ...await updateWorktreeConfig(editor(), value) }],
    });
    // One exact path registration applies the owner's authentication before dispatch/body parsing.
    return registerAuthenticatedRoute(ctx, {
        ...get,
        handler: (req, res) => (req.method === 'GET' ? get : post).handler(req, res),
    });
}
