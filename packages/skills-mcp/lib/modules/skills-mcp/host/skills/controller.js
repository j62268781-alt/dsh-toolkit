import { readFile } from 'node:fs/promises';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { SkillRequest } from '../config.js';
import { configuredWorkspaces } from '../runtime/rows.js';
import { beat } from '../diagnostics/heartbeat.js';
import { agentsHome, projectRootOf } from './reconcile.js';
import { bodyOf, discoverSkills } from './discover.js';
import { createSkill, deleteSkill, renameSkill, updateSkill, writableRoots } from './write.js';
import { registerSkillRoute } from './route.js';
import { registerSkillReadRoute } from './read.js';
/** Disk scan state and skill commands for one panel scope. */
export function createSkillsController(ctx, { agents, lastBeat, refresh }) {
    /** Latest disk-skill scan, refreshed on a timer (the scan itself is async). */
    let discoveredSkills = [];
    /** Last skill/import op, surfaced on the heartbeat for outside diagnosis. */
    let lastOp = null;
    let discoveryInfo = { at: '', roots: [], count: 0, error: '' };
    const refreshDiscovered = async (projectRoots) => {
        const roots = Array.isArray(projectRoots) ? projectRoots.slice(0, 12) : [];
        try {
            discoveredSkills = await discoverSkills({
                projectRoots: roots,
                dshHome: resolveDshHome(),
                agentsHome: agentsHome(),
            });
            discoveryInfo = { at: new Date().toISOString(), roots, count: discoveredSkills.length, error: '' };
            // The periodic heartbeat only fires on change, and the first one happens
            // before this async scan finishes — so publish the diagnostics explicitly.
            beat({ ...lastBeat(), at: new Date().toISOString(), discovery: discoveryInfo });
        }
        catch (error) {
            // A failed scan must not look like "there are no skills on disk", and the
            // reason must survive into the published diagnostics.
            discoveryInfo = { at: new Date().toISOString(), roots, count: 0, error: String(error?.message ?? error) };
            beat({ ...lastBeat(), at: new Date().toISOString(), discovery: discoveryInfo });
            if (process.env.SMP_DEBUG)
                console.error('[dsh-skills-mcp-manager] skill scan failed', error);
            discoveredSkills = [];
        }
    };
    const installScan = () => {
        // ── Disk skill scan (memory only; served by `/runtime`) ─────────────────────────────
        //
        // The skills tab has no config source any more: the four roots on disk are the whole
        // truth. The scan is periodic so `/runtime` is cheap, but it never writes anything.
        ctx.effect(() => {
            const scan = () => {
                const roots = [];
                const add = (dir) => {
                    if (typeof dir !== 'string' || dir === '')
                        return;
                    const root = projectRootOf(dir);
                    if (!roots.includes(root))
                        roots.push(root);
                };
                for (const entry of agents.values())
                    add(entry.cwd);
                for (const workspace of configuredWorkspaces(ctx)) {
                    add(typeof workspace === 'string' ? workspace : workspace?.path);
                }
                void refreshDiscovered(roots);
            };
            scan();
            const timer = setInterval(scan, 5000);
            return () => clearInterval(timer);
        });
    };
    const registerRoutes = () => {
        // ── Skill writes over HTTP ──────────────────────────────────────────────────────────
        //
        // A skill is a directory on disk and nothing else. The four roots are the whole model:
        // create/update/rename/delete go straight to `SKILL.md`, and the list is the disk scan.
        const applySkillWrite = async (skillReq) => {
            const at = () => new Date().toISOString();
            const fail = (reason) => ({ ok: false, reason, name: '', body: '', nonce: String(skillReq?.nonce ?? ''), at: at() });
            const op = String(skillReq?.op ?? '');
            const roots = writableRoots({
                dshHome: resolveDshHome(),
                agentsHome: agentsHome(),
                projectRoot: skillReq?.project === '' ? '' : projectRootOf(String(skillReq.project)),
            });
            const target = roots.find((entry) => entry.scope === skillReq?.scope && entry.id === skillReq?.id);
            let result;
            if (String(skillReq?.scope ?? '') === 'project' && String(skillReq?.project ?? '') === '') {
                // Never guess: an empty project used to fall back to the cwd and wrote
                // the skill into the wrong workspace.
                result = fail('未选择项目，无法写入项目级技能');
            }
            else if (target === undefined) {
                result = fail('未知的写入区域');
            }
            else {
                const payload = {
                    dir: target.dir, name: String(skillReq?.name ?? ''),
                    description: String(skillReq?.description ?? ''), body: String(skillReq?.body ?? ''),
                };
                // A disk op that throws (a failing copy, a permission error) must
                // still produce an answer: without a receipt the panel's card kept
                // spinning on 「删除中…」 forever.
                let done;
                try {
                    done = op === 'create' ? await createSkill(payload)
                        : op === 'rename' ? await renameSkill({ ...payload, from: String(skillReq?.prevName ?? ''), to: String(skillReq?.name ?? '') })
                            : op === 'delete' ? await deleteSkill(payload)
                                : await updateSkill(payload);
                }
                catch (error) {
                    done = { ok: false, reason: String(error?.message ?? error) };
                }
                result = { ok: done.ok === true, reason: String(done.reason ?? ''), name: String(done.name ?? ''), body: '', nonce: String(skillReq?.nonce ?? ''), at: at() };
            }
            if (result.ok === true) {
                // Re-scan so `/runtime` shows the change now. The periodic scan already covers every
                // project, but a write must refresh the roots it touched.
                try {
                    const projectScopes = [...new Set(discoveredSkills
                            .map((entry) => entry.scope)
                            .filter((scope) => typeof scope === 'string' && scope !== '' && scope !== 'global'))];
                    await refreshDiscovered([...new Set([
                            ...roots.map((entry) => projectRootOf(entry.dir)),
                            ...projectScopes,
                        ])].filter((root) => typeof root === 'string' && root !== ''));
                }
                catch (error) {
                    if (process.env.SMP_DEBUG)
                        console.error('[dsh-skills-mcp-manager] post-write rescan failed', error);
                }
            }
            return result;
        };
        /** Record what just happened (diagnostics); `/runtime` refreshes on its own. */
        const finishSkillOp = (op, skillReq, result) => {
            lastOp = {
                op: String(op ?? ''), name: String(skillReq?.name ?? ''),
                nonce: String(result?.nonce ?? ''), ok: result?.ok === true,
                at: new Date().toISOString(),
            };
            try {
                refresh();
            }
            catch (error) {
                console.error('[dsh-skills-mcp-manager] post-skill refresh failed:', error);
            }
        };
        ctx.inject(['webServer', 'connection'], (skillRouteCtx) => registerSkillRoute(skillRouteCtx, {
            schema: (payload) => SkillRequest(payload),
            apply: async (request) => {
                const op = String(request?.op ?? '');
                // The route is writes-only; a read has its own GET endpoint.
                if (op === 'read')
                    return { ok: false, reason: 'read 不走此路由', name: '', body: '', nonce: String(request?.nonce ?? ''), at: new Date().toISOString() };
                const result = await applySkillWrite(request);
                finishSkillOp(op, request, result);
                return result;
            },
        }));
        /**
         * Resolve one skill body for the editor/preview.
         *
         * Only files the scanner actually found are readable — the path is a client-supplied
         * string, so it must be proved to be one of *our* skill roots before reading it. A stale
         * list (a skill created a moment ago) is handled by one rescan, never by widening the
         * check.
         */
        const resolveSkillBody = async (wanted) => {
            const path = String(wanted ?? '');
            if (path === '')
                return { ok: false, reason: '缺少 path' };
            const isKnown = () => Array.isArray(discoveredSkills) && discoveredSkills.some((entry) => entry.path === path);
            if (!isKnown()) {
                try {
                    const extra = [];
                    for (const agent of agents.values())
                        extra.push(projectRootOf(agent.cwd));
                    for (const workspace of configuredWorkspaces(ctx))
                        extra.push(projectRootOf(String(workspace?.path ?? workspace?.dir ?? '')));
                    const scopes = discoveredSkills.map((entry) => entry.scope).filter((scope) => typeof scope === 'string' && scope !== '' && scope !== 'global');
                    const nextRoots = [...new Set([...scopes, ...extra])].filter((root) => typeof root === 'string' && root !== '');
                    await refreshDiscovered(nextRoots);
                }
                catch (error) {
                    if (process.env.SMP_DEBUG)
                        console.error('[dsh-skills-mcp-manager] read rescan failed', error);
                }
            }
            if (!isKnown())
                return { ok: false, reason: '该技能不在当前扫描结果里' };
            try {
                const text = await readFile(path, 'utf8');
                return { ok: true, reason: '', name: '', body: bodyOf(text), at: new Date().toISOString() };
            }
            catch (error) {
                return { ok: false, reason: String(error?.message ?? error) };
            }
        };
        ctx.inject(['webServer', 'connection'], (readCtx) => registerSkillReadRoute(readCtx, { resolve: resolveSkillBody }));
    };
    return {
        get discovered() { return discoveredSkills; },
        get discoveryInfo() { return discoveryInfo; },
        get lastOp() { return lastOp; },
        installScan,
        registerRoutes,
    };
}
//# sourceMappingURL=controller.js.map