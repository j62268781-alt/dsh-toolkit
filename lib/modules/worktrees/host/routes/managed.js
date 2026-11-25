import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readBody, sendJson } from '../../../../host/http.js';
import { httpFailure, registerAuthenticatedRoute } from '../../../../host/routes.js';
import { MANAGED_WORKTREE_CHECK_PATH, MANAGED_WORKTREE_SNAPSHOTS_PATH, MANAGED_WORKTREES_PATH } from '../constants.js';
import { checkManagedCheckout, checkoutPresence, commitId } from '../worktree/check.js';
import { readCheckoutStatuses } from '../worktree/checkout-status.js';
import { createManagedWorktreeIndex } from '../worktree/managed.js';
import { listWorktreeSnapshots, restoreWorktreeSnapshot } from '../worktree/snapshot.js';
const unavailable = httpFailure(404, 'managed-worktrees-unavailable');
const failed = httpFailure(500, 'managed-worktrees-failed');
const invalidCheck = httpFailure(400, 'invalid-worktree-check');
const missingCheck = httpFailure(404, 'managed-worktree-not-found');
const invalidSnapshot = httpFailure(400, 'invalid-worktree-snapshot');
const snapshotUnavailable = httpFailure(409, 'snapshot-unavailable');
const CHECK_TIMEOUT_MS = 20_000;
const CHECK_CONCURRENCY = 4;
function checkSelector(url) {
    if (!url || url.length > 32_768)
        throw invalidCheck;
    const params = new URL(url, 'http://localhost').searchParams;
    const sessionId = params.get('sessionId');
    const repositoryRoot = params.get('repositoryRoot');
    const path = params.get('path');
    if (params.size !== 3 || !sessionId || sessionId.length > 256 || /[\x00-\x20\x7f]/.test(sessionId)
        || !repositoryRoot || !path || [repositoryRoot, path].some(value => value.length > 4096 || /[\0\r\n]/.test(value)))
        throw invalidCheck;
    return { sessionId, repositoryRoot, path };
}
function readWorktreeReferences(value) {
    if (!Array.isArray(value))
        throw failed;
    for (const entry of value) {
        const { owned, worktree } = entry ?? {};
        if (typeof owned !== 'boolean' || !worktree || [worktree.path, worktree.repositoryRoot, worktree.branch, worktree.baseCommit]
            .some(field => typeof field !== 'string' || !field))
            throw failed;
    }
    return value;
}
function sameDirectory(left, right) {
    return isAbsolute(left) && isAbsolute(right) && resolve(left).toLowerCase() === resolve(right).toLowerCase();
}
function directoryInCheckout(directory, path) {
    if (!isAbsolute(directory) || !isAbsolute(path))
        throw failed;
    const rel = relative(path.toLowerCase(), directory.toLowerCase());
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function archivedSessionIds(registry) {
    // An optional registry may not have loaded its state yet.
    try {
        const ids = registry?.archivedSessionIds;
        if (Array.isArray(ids))
            return new Set(ids);
    }
    catch { }
}
async function checkAdmission(ctx, selector, signal, scanOthers = false, onOwner) {
    const get = (name) => ctx.get?.(name);
    const query = get('sessionQuery');
    const projections = get('sessionProjections');
    const canRead = (id) => {
        const access = get('remoteAccess');
        return access === undefined || access.allows({ kind: 'session', id }) === true;
    };
    const { sessionId, path, repositoryRoot } = selector;
    if (!canRead(sessionId))
        throw missingCheck;
    if (!get('worktrees') || typeof query?.inspectSession !== 'function' || typeof query?.listSessions !== 'function'
        || typeof projections?.snapshot !== 'function')
        return 'check-unavailable';
    const candidate = await query.inspectSession(sessionId, (session) => {
        if (!canRead(sessionId) || session.header.id !== sessionId)
            return null;
        const { values } = projections.snapshot(session, ['worktree']);
        const latest = readWorktreeReferences(values.worktree).findLast(entry => entry.owned && entry.worktree.path === path)?.worktree;
        if (latest?.repositoryRoot !== repositoryRoot)
            return null;
        onOwner?.(session);
        return { ...latest };
    }, signal);
    signal.throwIfAborted();
    if (!candidate || !canRead(sessionId))
        throw missingCheck;
    const archived = archivedSessionIds(get('workspaceRegistry'));
    if (!archived)
        return 'archive-unknown';
    if (!archived.has(sessionId))
        return 'not-archived';
    if (!scanOthers)
        return candidate;
    // A newer own record can supersede the selected one. Active forks may also
    // retain inherited references or have moved their working directory here.
    // Never open a denied session, and don't assert eligibility through that gap.
    const records = await query.listSessions(signal);
    signal.throwIfAborted();
    const selectedIndex = records.findIndex(record => record.header.id === sessionId);
    if (selectedIndex < 0)
        throw missingCheck;
    let next = 0;
    let blocked = false;
    let superseded = false;
    let inUse = false;
    const worker = async () => {
        while (next < records.length && !superseded) {
            signal.throwIfAborted();
            const index = next++;
            const { id } = records[index].header;
            if (id === sessionId || (index > selectedIndex && archived.has(id)))
                continue;
            if (!canRead(id)) {
                blocked = true;
                continue;
            }
            const active = !archived.has(id);
            let conflict = await query.inspectSession(id, (session) => {
                if (!canRead(id) || session.header.id !== id)
                    return 'unknown';
                const { values } = projections.snapshot(session, active ? ['worktree', 'workingDirectory'] : ['worktree']);
                const references = readWorktreeReferences(values.worktree).filter(entry => sameDirectory(candidate.path, entry.worktree.path));
                if (index < selectedIndex && references.some(entry => entry.owned))
                    return 'superseded';
                if (active) {
                    if (references.length)
                        return 'in-use';
                    const cwd = values.workingDirectory === null ? get('workingDirectory')?.defaultDirectory : values.workingDirectory;
                    if (typeof cwd !== 'string' || !isAbsolute(cwd))
                        return 'unknown';
                    if (directoryInCheckout(cwd, candidate.path))
                        return 'in-use';
                    return { cwd };
                }
                return 'clear';
            }, signal);
            signal.throwIfAborted();
            if (canRead(id) && conflict && typeof conflict === 'object') {
                try {
                    conflict = directoryInCheckout(await realpath(conflict.cwd), candidate.path) ? 'in-use' : 'clear';
                }
                catch {
                    conflict = 'unknown';
                }
                signal.throwIfAborted();
            }
            if (!canRead(id))
                blocked = true;
            else if (conflict === 'superseded')
                superseded = true;
            else if (conflict === 'in-use')
                inUse = true;
            else if (conflict !== 'clear')
                blocked = true;
        }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, records.length) }, worker));
    if (!canRead(sessionId) || superseded)
        throw missingCheck;
    if (blocked)
        return 'check-unavailable';
    const latestArchive = archivedSessionIds(get('workspaceRegistry'));
    if (!latestArchive)
        return 'archive-unknown';
    if (!latestArchive.has(sessionId))
        return 'not-archived';
    if (archived.size !== latestArchive.size || [...archived].some(id => !latestArchive.has(id)))
        return 'check-unavailable';
    return inUse ? 'in-use' : candidate;
}
function registerManagedWorktreeCheckRoute(ctx) {
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: MANAGED_WORKTREE_CHECK_PATH,
        async handler(req, res, peer) {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET') {
                sendJson(res, 404, { ok: false, reason: 'not-found' });
                return;
            }
            const closed = new AbortController();
            const onClose = () => closed.abort();
            res.once('close', onClose);
            const request = peer?.signal ? AbortSignal.any([closed.signal, peer.signal]) : closed.signal;
            const signal = AbortSignal.any([request, AbortSignal.timeout(CHECK_TIMEOUT_MS)]);
            try {
                if (res.destroyed || request.aborted)
                    return;
                const selector = checkSelector(req.url);
                const candidate = await checkAdmission(ctx, selector, signal);
                let reason;
                if (typeof candidate === 'string')
                    reason = candidate;
                else {
                    const presence = await checkoutPresence(candidate);
                    signal.throwIfAborted();
                    if (presence)
                        reason = presence;
                    else {
                        const admitted = await checkAdmission(ctx, selector, signal, true);
                        if (typeof admitted === 'string')
                            reason = admitted;
                        else {
                            if (admitted.branch !== candidate.branch || admitted.baseCommit !== candidate.baseCommit)
                                throw missingCheck;
                            reason = await checkManagedCheckout(ctx, admitted, signal);
                            if (reason === 'clean') {
                                const fresh = await checkAdmission(ctx, selector, signal, true);
                                if (typeof fresh === 'string')
                                    reason = fresh;
                                else if (fresh.branch !== admitted.branch || fresh.baseCommit !== admitted.baseCommit)
                                    throw missingCheck;
                            }
                        }
                    }
                }
                signal.throwIfAborted();
                const access = ctx.get?.('remoteAccess');
                if (access !== undefined && access.allows({ kind: 'session', id: selector.sessionId }) !== true)
                    throw missingCheck;
                if (!res.destroyed)
                    sendJson(res, 200, { ok: true, eligible: reason === 'clean', reason });
            }
            catch (error) {
                if (request.aborted || res.destroyed)
                    return;
                const failure = error === invalidCheck ? invalidCheck : error === missingCheck ? missingCheck : undefined;
                if (failure)
                    sendJson(res, failure.status, { ok: false, reason: failure.reason });
                else
                    sendJson(res, 200, { ok: true, eligible: false, reason: 'check-unavailable' });
            }
            finally {
                closed.abort();
                res.off('close', onClose);
                if (peer?.signal?.aborted && !res.destroyed)
                    res.destroy();
            }
        },
    });
}
function registerManagedWorktreeSnapshotsRoute(ctx) {
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: MANAGED_WORKTREE_SNAPSHOTS_PATH,
        async handler(req, res, peer) {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET' && req.method !== 'POST') {
                sendJson(res, 404, { ok: false, reason: 'not-found' });
                return;
            }
            const closed = new AbortController();
            const onClose = () => closed.abort();
            res.once('close', onClose);
            const request = peer?.signal ? AbortSignal.any([closed.signal, peer.signal]) : closed.signal;
            const signal = AbortSignal.any([request, AbortSignal.timeout(CHECK_TIMEOUT_MS)]);
            const stopUpload = () => { if (!req.complete)
                req.destroy(); };
            try {
                signal.throwIfAborted();
                const selector = checkSelector(req.url);
                const readOwner = async () => {
                    let policy;
                    const candidate = await checkAdmission(ctx, selector, signal, false, req.method === 'POST' ? session => {
                        policy = ctx.get?.('sandboxPolicy')?.resolve?.({ session });
                    } : undefined);
                    if (typeof candidate === 'string')
                        throw snapshotUnavailable;
                    return { owner: { ...candidate, sessionId: selector.sessionId }, policy };
                };
                if (req.method === 'GET') {
                    const { owner } = await readOwner();
                    const commits = await listWorktreeSnapshots(ctx, owner, signal);
                    const fresh = await readOwner();
                    if (fresh.owner.branch !== owner.branch || fresh.owner.baseCommit !== owner.baseCommit)
                        throw missingCheck;
                    signal.throwIfAborted();
                    sendJson(res, 200, { ok: true, commits });
                    return;
                }
                if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
                    throw invalidSnapshot;
                let body;
                signal.addEventListener('abort', stopUpload, { once: true });
                try {
                    body = JSON.parse(await readBody(req, 4096));
                }
                catch {
                    throw invalidSnapshot;
                }
                finally {
                    signal.removeEventListener('abort', stopUpload);
                }
                if (typeof body?.commit !== 'string' || !commitId.test(body.commit) || typeof body.branch !== 'string')
                    throw invalidSnapshot;
                const { owner, policy } = await readOwner();
                const result = await restoreWorktreeSnapshot(ctx, owner, body.commit, body.branch, policy, async () => {
                    const fresh = await readOwner();
                    if (fresh.owner.branch !== owner.branch || fresh.owner.baseCommit !== owner.baseCommit)
                        return undefined;
                    return fresh.policy;
                }, signal);
                if (request.aborted || res.destroyed)
                    return;
                sendJson(res, result.ok === true ? 201 : result.reason === 'invalid-branch' ? 400 : 409, result);
            }
            catch (error) {
                if (request.aborted || res.destroyed)
                    return;
                const failure = error === invalidCheck || error === invalidSnapshot ? invalidSnapshot : error === missingCheck ? missingCheck : snapshotUnavailable;
                sendJson(res, failure.status, { ok: false, reason: failure.reason });
            }
            finally {
                closed.abort();
                res.off('close', onClose);
                if (peer?.signal?.aborted && !res.destroyed)
                    res.destroy();
            }
        },
    });
}
export function registerManagedWorktreesRoute(ctx) {
    registerManagedWorktreeCheckRoute(ctx);
    registerManagedWorktreeSnapshotsRoute(ctx);
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
                        cleanupCheck: true,
                        snapshots: true,
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
