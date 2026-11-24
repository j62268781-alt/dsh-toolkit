import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { registerManagedWorktreesRoute } from '../../src/modules/worktrees/host/routes/managed.js'
import { MANAGED_WORKTREES_PATH } from '../../src/modules/worktrees/host/constants.js'

const record = (id) => ({ header: { id } })
const entry = (branch, path = 'checkout-one', owned = true) => ({
  owned, worktree: { branch, path, repositoryRoot: '/repo', baseCommit: 'abc' },
})
const owner = { principal: { kind: 'owner' }, signal: new AbortController().signal }

function setup(services, connection = { admit() {} }) {
  let route
  let lookups = 0
  registerManagedWorktreesRoute({
    get(name) { lookups++; return services[name] },
    connection,
    effect(fn) { fn() },
    webServer: { register(value) { route = value } },
  })
  assert.equal(route.path, MANAGED_WORKTREES_PATH)
  assert.equal(route.auth, connection.requestRejection ? undefined : 'required')
  function open(peer, method = 'GET') {
    const res = new EventEmitter()
    const headers = {}
    const replies = []
    res.setHeader = (name, value) => { headers[name] = value }
    res.destroy = () => {
      res.destroyed = true
      res.emit('close')
    }
    res.end = payload => { replies.push([res.statusCode, payload ? JSON.parse(payload) : undefined]) }
    const finished = Promise.resolve(route.handler({ method }, res, peer))
    return { res, headers, replies, finished }
  }
  return {
    get lookups() { return lookups },
    open,
    async request(peer) {
      const request = open(peer)
      await request.finished
      assert.equal(request.replies.length, 1)
      return request.replies[0]
    },
  }
}

test('returns latest owned native records by path without inspecting unauthorized sessions', async t => {
  const checkout = await mkdtemp(join(tmpdir(), 'worktrees-managed-'))
  t.after(() => rm(checkout, { recursive: true, force: true }))
  const missing = join(checkout, 'missing')
  const inspected = []
  const creations = {
    latest: [entry('first', missing), entry('current', missing), entry('second', checkout)],
    fork: [entry('inherited', 'inherited', false)],
    prior: [entry('older', missing)],
  }
  const api = setup({
    worktrees: {},
    workspaceRegistry: { archivedSessionIds: ['latest'] },
    remoteAccess: { allows({ kind, id }) { return kind === 'session' && id !== 'denied' } },
    sessionQuery: {
      listSessions: async () => ['denied', 'latest', 'fork', 'prior'].map(record),
      async inspectSession(id, callback) { inspected.push(id); return callback(id) },
    },
    sessionProjections: {
      snapshot(id, keys) {
        assert.deepEqual(keys, ['worktree', 'title'])
        return { values: { worktree: creations[id], title: id === 'latest' ? 'Newest session' : null } }
      },
    },
  })
  assert.deepEqual(await api.request(), [401, undefined])
  assert.deepEqual(await api.request({ ...owner, principal: { kind: 'guest' } }), [403, undefined])
  assert.equal(api.lookups, 0)
  assert.deepEqual(await api.request(owner), [200, { ok: true, worktrees: [
    { path: checkout, branch: 'second', repositoryRoot: '/repo', sessionId: 'latest', sessionTitle: 'Newest session', sessionArchived: true, status: 'present' },
    { path: missing, branch: 'current', repositoryRoot: '/repo', sessionId: 'latest', sessionTitle: 'Newest session', sessionArchived: true, status: 'missing' },
  ] }])
  assert.deepEqual(inspected, ['latest', 'fork', 'prior'])
})

test('distinguishes unavailable and failed projections from a valid empty list', async () => {
  assert.deepEqual(await setup({}).request(owner), [404, { ok: false, reason: 'managed-worktrees-unavailable' }])
  const services = {
    worktrees: {},
    sessionQuery: { listSessions: async () => [], inspectSession: async () => {} },
    sessionProjections: { snapshot() {} },
  }
  assert.deepEqual(await setup(services).request(owner), [200, { ok: true, worktrees: [] }])
  services.sessionQuery.listSessions = async () => [record('missing')]
  assert.deepEqual(await setup(services).request(owner), [500, { ok: false, reason: 'managed-worktrees-failed' }])
})

test('maps host revisions to the warm index without caching mismatched cold observations', async () => {
  const active = { header: { id: 'active' }, seq: 1 }
  let stored = { header: { id: 'stored' } }
  let currentRevision = 'initial'
  let observedRevision = currentRevision
  let generation = new Set(['worktree', 'title'])
  let denied = false
  let released = 0
  const inspected = []
  const services = {
    worktrees: {},
    workspaceRegistry: { archivedSessionIds: [] },
    remoteAccess: { allows: ({ id }) => id !== 'active' || !denied },
    sessions: { get: id => id === 'active' ? active : undefined },
    sessionPersistence: {
      identity: Symbol(),
      async list({ signal }) {
        assert.equal(signal.aborted, false)
        return [{ header: stored.header, revision: currentRevision }]
      },
    },
    sessionQuery: {
      async listSessions() { return [{ ...record('active'), live: true }, { ...record('stored'), live: false }] },
      async inspectSession(id, read) { inspected.push(id); return read(id === 'active' ? active : stored) },
      async observeSession(id, { projectionMode, signal }) {
        assert.equal(id, 'stored')
        assert.equal(projectionMode, 'none')
        assert.equal(signal.aborted, false)
        return { source: 'prepared', revision: observedRevision, header: stored.header, [Symbol.dispose]() { released++ } }
      },
    },
    sessionProjections: {
      summaryKeys: () => generation,
      snapshot(session) { return { values: { worktree: [entry(session.header.id, session.header.id)] } } },
    },
  }
  const api = setup(services)
  assert.equal((await api.request(owner))[0], 200)
  assert.equal((await api.request(owner))[0], 200)
  assert.deepEqual(inspected.splice(0).sort(), ['active', 'stored'])
  assert.equal(released, 1)

  active.seq++
  currentRevision = 'changed'
  stored = { header: { id: 'stored' } }
  services.workspaceRegistry.archivedSessionIds = ['stored']
  assert.equal((await api.request(owner))[1].worktrees[1].sessionArchived, true)
  assert.equal((await api.request(owner))[0], 200)
  assert.deepEqual(inspected.splice(0).sort(), ['active', 'stored', 'stored'])
  assert.equal(released, 3)

  observedRevision = currentRevision
  denied = true
  assert.deepEqual((await api.request(owner))[1].worktrees.map(row => row.sessionId), ['stored'])
  assert.deepEqual(inspected.splice(0), ['stored'])
  assert.equal(released, 4)
  generation = new Set(generation)
  assert.equal((await api.request(owner))[0], 200)
  assert.deepEqual(inspected, ['stored'])
  assert.equal(released, 5)
})

function blockedInspections(ids) {
  const reads = new Map()
  const signals = []
  const services = {
    worktrees: {},
    sessionQuery: {
      async listSessions(signal) { signals.push(signal); return ids.map(record) },
      inspectSession(id, callback, signal) {
        return new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          reads.set(id, {
            signal,
            finish(creations) {
              signal.removeEventListener('abort', abort)
              resolve(callback(creations))
            },
            fail(error) {
              signal.removeEventListener('abort', abort)
              reject(error)
            },
          })
        })
      },
    },
    sessionProjections: { snapshot: worktree => ({ values: { worktree } }) },
  }
  return { services, reads, signals }
}

test('overlaps at most four reads, scans the whole corpus and merges in corpus order', async () => {
  const { services, reads } = blockedInspections(['newest', 'older', 'a', 'b', 'last'])
  const request = setup(services).open(owner)
  await setImmediate()
  assert.deepEqual([...reads.keys()], ['newest', 'older', 'a', 'b'])
  reads.get('older').finish([entry('older-duplicate')])
  await setImmediate()
  assert.ok(reads.has('last'), 'next inspection starts without waiting for oldest in-flight read')
  reads.get('last').finish([entry('last', 'checkout-last')])
  reads.get('b').finish([])
  reads.get('a').finish([])
  reads.get('newest').finish([entry('newest')])
  await request.finished
  assert.deepEqual(request.replies, [[200, { ok: true, worktrees: [
    { path: 'checkout-one', branch: 'newest', repositoryRoot: '/repo', sessionId: 'newest', status: 'unknown' },
    { path: 'checkout-last', branch: 'last', repositoryRoot: '/repo', sessionId: 'last', status: 'unknown' },
  ] }]])
  assert.equal(request.headers['cache-control'], 'no-store')
  assert.equal(request.res.listenerCount('close'), 0)
})

test('HTTP disconnect and owner revocation cancel only their own scan without writing a response', async () => {
  for (const revoke of [false, true]) {
    const { services, reads, signals } = blockedInspections(['a', 'b', 'c', 'd', 'queued'])
    const controller = new AbortController()
    // Installed desktop uses requestRejection; admit-only hosts forward an owner Peer.
    const connection = revoke ? undefined : { requestRejection: () => undefined }
    const request = setup(services, connection).open({ ...owner, signal: controller.signal })
    await setImmediate()
    assert.equal(reads.size, 4)
    assert.equal(signals[0].aborted, false)
    if (revoke) controller.abort()
    else request.res.destroy()
    await request.finished
    assert.equal(signals[0].aborted, true)
    assert.ok([...reads.values()].every(({ signal }) => signal.aborted))
    assert.equal(reads.has('queued'), false)
    assert.equal(request.res.destroyed, true)
    assert.deepEqual(request.replies, [])
    assert.equal(request.res.listenerCount('close'), 0)
  }
})

test('a failed inspection cancels sibling reads and a subsequent request reads fresh', async () => {
  const { services, reads } = blockedInspections(['bad', 'b', 'c', 'd', 'queued'])
  const api = setup(services)
  const first = api.open(owner)
  await setImmediate()
  reads.get('bad').fail(new Error('private-log-path'))
  await first.finished
  assert.ok([...reads.values()].every(({ signal }) => signal.aborted))
  assert.equal(reads.has('queued'), false)
  assert.deepEqual(first.replies, [[500, { ok: false, reason: 'managed-worktrees-failed' }]])
  services.sessionQuery.listSessions = async () => [record('queued')]
  const second = api.open(owner)
  await setImmediate()
  reads.get('queued').finish([entry('fresh', 'checkout-fresh')])
  await second.finished
  assert.deepEqual(second.replies, [[200, { ok: true, worktrees: [
    { path: 'checkout-fresh', branch: 'fresh', repositoryRoot: '/repo', sessionId: 'queued', status: 'unknown' },
  ] }]])
})
