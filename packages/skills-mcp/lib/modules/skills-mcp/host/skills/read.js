/**
 * Skill body read over HTTP: `GET /<name>/skill?path=...`.
 *
 * The editor and the preview need the contents of one `SKILL.md`; the list deliberately
 * carries no bodies. This used to be `skillRequest { op: 'read' }` in settings, which cost
 * a 600 ms poll and put a transient request into the profile patch.
 *
 * `path` is client-supplied, so the Host only reads a file that its own scan has found (the
 * injected `resolve` enforces that; see `src/index.js`). This route is read-only and carries
 * no body.
 */
import { API_PREFIX } from '../identity.js';
import { registerAuthenticatedRoute } from '../../../../host/routes.js';
export const SKILL_READ_PATH = `${API_PREFIX}/skill`;
export function registerSkillReadRoute(ctx, { resolve }) {
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: SKILL_READ_PATH,
        handler: async (req, res) => {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET') {
                res.statusCode = 405;
                res.setHeader('allow', 'GET');
                res.end();
                return;
            }
            let wanted = '';
            try {
                const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1');
                wanted = url.searchParams.get('path') ?? '';
            }
            catch {
                wanted = '';
            }
            res.setHeader('content-type', 'application/json; charset=utf-8');
            try {
                res.statusCode = 200;
                res.end(JSON.stringify(await resolve(wanted)));
            }
            catch (error) {
                ctx.logger.warn('dsh-toolkit-skills-mcp: skill read failed: %s', String(error?.message ?? error));
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: false, reason: String(error?.message ?? error) }));
            }
        },
    });
}
//# sourceMappingURL=read.js.map