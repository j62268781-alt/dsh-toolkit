import { sendJson } from '../../../../host/http.js';
import { httpFailure, registerAuthenticatedRoute } from '../../../../host/routes.js';
import { MANAGED_WORKTREES_PATH } from '../constants.js';
import { readCheckoutStatuses } from '../worktree/checkout-status.js';
import { createManagedWorktreeIndex } from '../worktree/managed.js';
const unavailable = httpFailure(404, 'managed-worktrees-unavailable');
const failed = httpFailure(500, 'managed-worktrees-failed');
function archivedSessionIds(registry) {
    // An optional registry may not have loaded its state yet.
    try {
        const ids = registry?.archivedSessionIds;
        if (Array.isArray(ids))
            return new Set(ids);
    }
    catch { }
}
export function registerManagedWorktreesRoute(ctx) {
    let listManagedWorktrees = createManagedWorktreeIndex();
    let projectionGeneration;
    const liveIdentities = new WeakMap();
    const liveRevision = (session) => {
        if (!Number.isSafeInteger(session.seq) || session.seq < 0)
            return;
        let identity = liveIdentities.get(session);
        if (identity === undefined)
            liveIdentities.set(session, identity = Symbol());
        return { source: 'live', identity, revision: session.seq };
    };
    // The corpus scan needs the response's lifetime; jsonRoute only passes the body to run().
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: MANAGED_WORKTREES_PATH,
        async handler(req, res, peer) {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET') {
                sendJson(res, 404, { ok: false, reason: 'not-found' });
                return;
            }
            const closed = new AbortController();
            const onClose = () => closed.abort();
            res.once('close', onClose);
            const signal = peer?.signal ? AbortSignal.any([closed.signal, peer.signal]) : closed.signal;
            try {
                if (res.destroyed || signal.aborted)
                    return;
                const get = (name) => ctx.get?.(name);
                const query = get('sessionQuery');
                const projections = get('sessionProjections');
                if (!get('worktrees') || typeof projections?.snapshot !== 'function'
                    || typeof query?.listSessions !== 'function' || typeof query?.inspectSession !== 'function') {
                    throw unavailable;
                }
                // DSH returns the same key set until a projection is registered/unregistered.
                const generation = projections.summaryKeys?.();
                if (generation !== projectionGeneration) {
                    projectionGeneration = generation;
                    listManagedWorktrees = createManagedWorktreeIndex();
                }
                const sessions = get('sessions');
                const getLive = generation !== undefined && typeof sessions?.get === 'function'
                    ? (id) => sessions.get(id)
                    : undefined;
                const persistence = get('sessionPersistence');
                const persistenceIdentity = persistence?.identity;
                const canCheckPersistence = getLive !== undefined && typeof persistenceIdentity === 'symbol'
                    && typeof persistence?.list === 'function' && typeof query.observeSession === 'function';
                const persisted = new Map();
                const access = get('remoteAccess');
                const canRead = (id) => access === undefined || access.allows({ kind: 'session', id });
                const worktrees = await listManagedWorktrees({
                    async listSessions(signal) {
                        const records = await query.listSessions(signal);
                        signal.throwIfAborted();
                        // SessionQuery retains canonical ordering but its public list omits revisions.
                        // One metadata pass avoids probing the entire storage tree for each cold id.
                        if (canCheckPersistence && records.some(record => record.live === false && canRead(record.header.id))) {
                            try {
                                const storedSessions = await persistence.list({ signal });
                                for (const stored of storedSessions) {
                                    if (typeof stored.revision === 'string')
                                        persisted.set(stored.header.id, stored.revision);
                                }
                            }
                            catch {
                                signal.throwIfAborted();
                                persisted.clear(); // Optional revision lookup failed; don't guess from the headers.
                            }
                        }
                        return records;
                    },
                    canRead,
                    revision(record) {
                        const id = record.header.id;
                        const live = getLive?.(id);
                        if (live)
                            return liveRevision(live);
                        const revision = record.live === false ? persisted.get(id) : undefined;
                        if (revision !== undefined && get('sessionPersistence')?.identity === persistenceIdentity) {
                            return { source: 'persisted', identity: persistenceIdentity, revision };
                        }
                    },
                    async readProjection({ header: { id } }, revision, signal) {
                        // The cold lease records the revision seen by the actual query and pins
                        // its prepared log until the targeted snapshot; do not cache a different cut.
                        const observation = revision?.source === 'persisted'
                            ? await query.observeSession(id, { projectionMode: 'none', signal })
                            : undefined;
                        try {
                            signal.throwIfAborted();
                            if (!canRead(id))
                                return null;
                            return await query.inspectSession(id, (session) => {
                                if (!canRead(id))
                                    return null;
                                const { values } = projections.snapshot(session, ['worktree', 'title']);
                                const live = getLive?.(id);
                                const cacheable = revision?.source === 'live'
                                    ? live === session && session.seq === revision.revision && liveIdentities.get(session) === revision.identity
                                    : revision?.source === 'persisted' && observation?.source === 'prepared' && live === undefined
                                        && get('sessionPersistence')?.identity === revision.identity && observation.revision === revision.revision
                                        && observation.header === session.header;
                                return { values, cacheable };
                            }, signal);
                        }
                        finally {
                            observation?.[Symbol.dispose]();
                        }
                    },
                }, signal);
                const statuses = await readCheckoutStatuses(worktrees, signal);
                const archived = archivedSessionIds(get('workspaceRegistry'));
                if (!signal.aborted && !res.destroyed)
                    sendJson(res, 200, {
                        ok: true,
                        worktrees: worktrees.filter(worktree => canRead(worktree.sessionId)).map(worktree => ({
                            ...worktree,
                            ...(archived === undefined ? {} : { sessionArchived: archived.has(worktree.sessionId) }),
                            status: statuses.get(worktree.path) ?? 'unknown',
                        })),
                    });
            }
            catch (error) {
                if (signal.aborted || res.destroyed)
                    return;
                // Only expose the unavailable status; a scan failure can contain local log details.
                const failure = error === unavailable ? unavailable : failed;
                sendJson(res, failure.status, { ok: false, reason: failure.reason });
            }
            finally {
                res.off('close', onClose);
                if (peer?.signal?.aborted && !res.destroyed)
                    res.destroy();
            }
        },
    });
}
