import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { registerManagedWorktreesRoute } from '../../src/modules/worktrees/host/routes/managed.js'
import { MANAGED_WORKTREE_CHECK_PATH, MANAGED_WORKTREE_SNAPSHOTS_PATH, MANAGED_WORKTREES_PATH } from '../../src/modules/worktrees/host/constants.js'

const record = (id) => ({ header: { id } })
const entry = (branch, path = 'checkout-one', owned = true) => ({
  owned, worktree: { branch, path, repositoryRoot: '/repo', baseCommit: 'abc' },
})
const owner = { principal: { kind: 'owner' }, signal: new AbortController().signal }

function setup(services, connection = { admit() {} }) {
  const routes = new Map()
  let lookups = 0
  registerManagedWorktreesRoute({
    get(name) { lookups++; return services[name] },
    connection,
    effect(fn) { fn() },
    webServer: { register(value) { routes.set(value.path, value) } },
  })
  assert.deepEqual([...routes.keys()], [MANAGED_WORKTREE_CHECK_PATH, MANAGED_WORKTREE_SNAPSHOTS_PATH, MANAGED_WORKTREES_PATH])
  for (const route of routes.values()) assert.equal(route.auth, connection.requestRejection ? undefined : 'required')
  function open(peer, method = 'GET', url = MANAGED_WORKTREES_PATH, req = {}) {
    const res = new EventEmitter()
    const headers = {}
    const replies = []
    res.setHeader = (name, value) => { headers[name] = value }
    res.destroy = () => {
      res.destroyed = true
      res.emit('close')
    }
    res.end = payload => { replies.push([res.statusCode, payload ? JSON.parse(payload) : undefined]) }
    const route = routes.get(url.split('?')[0])
    const finished = Promise.resolve(route.handler(Object.assign(req, { method, url }), res, peer))
    return { res, headers, replies, finished }
  }
  return {
    get lookups() { return lookups },
    open,
    async request(peer, method, url, req) {
      const request = open(peer, method, url, req)
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
  assert.deepEqual(await api.request(owner), [200, { ok: true, cleanupCheck: true, snapshots: true, worktrees: [
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
  assert.deepEqual(await setup(services).request(owner), [200, { ok: true, cleanupCheck: true, snapshots: true, worktrees: [] }])
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
  assert.deepEqual(request.replies, [[200, { ok: true, cleanupCheck: true, snapshots: true, worktrees: [
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
  assert.deepEqual(second.replies, [[200, { ok: true, cleanupCheck: true, snapshots: true, worktrees: [
    { path: 'checkout-fresh', branch: 'fresh', repositoryRoot: '/repo', sessionId: 'queued', status: 'unknown' },
  ] }]])
})

function checkFixture(repositoryRoot, path, route = MANAGED_WORKTREE_CHECK_PATH) {
  const selected = { repositoryRoot, path, branch: 'topic', baseCommit: 'a'.repeat(40) }
  const reference = { owned: true, worktree: selected }
  const views = { target: { worktree: [reference], workingDirectory: repositoryRoot } }
  const inspected = []
  let scans = 0
  const services = {
    worktrees: {}, workspaceRegistry: { archivedSessionIds: ['target'] },
    sessionQuery: {
      async listSessions() { scans++; return Object.keys(views).reverse().map(record) },
      async inspectSession(id, callback, signal) { signal.throwIfAborted(); inspected.push(id); return callback(record(id)) },
    },
    sessionProjections: { snapshot(session) { return { values: views[session.header.id] } } },
  }
  const api = setup(services)
  const url = (change = {}) => `${route}?${new URLSearchParams({ sessionId: 'target', repositoryRoot, path, ...change })}`
  return { selected, reference, views, inspected, services, api, url, get scans() { return scans } }
}

const checkResult = reason => [200, { ok: true, eligible: reason === 'clean', reason }]
const checkMissing = [404, { ok: false, reason: 'managed-worktree-not-found' }]

test('check authenticates before parsing and probes only the fresh owned projection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'managed-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = checkFixture(root, join(root, 'missing'))
  assert.deepEqual(await f.api.request(undefined, 'GET', MANAGED_WORKTREE_CHECK_PATH), [401, undefined])
  assert.deepEqual(await f.api.request({ ...owner, principal: { kind: 'guest' } }, 'GET', f.url()), [403, undefined])
  assert.equal(f.api.lookups, 0)
  assert.deepEqual(await f.api.request(owner, 'GET', `${f.url()}&path=/arbitrary`), [400, { ok: false, reason: 'invalid-worktree-check' }])
  assert.deepEqual(await f.api.request(owner, 'POST', f.url()), [404, { ok: false, reason: 'not-found' }])
  assert.deepEqual(await f.api.request(owner, 'GET', f.url({ path: '/arbitrary' })), checkMissing)
  assert.deepEqual(await f.api.request(owner, 'GET', f.url({ repositoryRoot: '/arbitrary' })), checkMissing)
  f.reference.owned = false
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkMissing)
  f.reference.owned = true
  f.services.remoteAccess = { allows: () => false }
  const prior = f.inspected.length
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkMissing)
  assert.equal(f.inspected.length, prior)
  delete f.services.remoteAccess
  f.services.workspaceRegistry.archivedSessionIds = []
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('not-archived'))
  delete f.services.workspaceRegistry
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('archive-unknown'))
  f.services.workspaceRegistry = { archivedSessionIds: ['target'] }
  const missing = f.api.open(owner, 'GET', f.url())
  await missing.finished
  assert.deepEqual(missing.replies, [checkResult('checkout-missing')])
  assert.equal(missing.headers['cache-control'], 'no-store')
  assert.equal(f.scans, 0)
})

test('check rejects superseded rows, active users, and denied corpus reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'managed-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = await mkdtemp(join(root, 'checkout-'))
  const f = checkFixture(root, path)
  f.views.other = { worktree: [{ ...f.reference }], workingDirectory: root }
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkMissing)
  f.views.other.worktree[0].owned = false
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('in-use'))
  f.views.other = { worktree: [], workingDirectory: join(path, 'nested') }
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('in-use'))
  f.services.remoteAccess = { allows: ({ id }) => id !== 'other' }
  f.inspected.length = 0
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('check-unavailable'))
  assert.ok(!f.inspected.includes('other'))
})

test('check recognizes active cwd through symlink aliases and fails closed on unresolved cwd', { skip: process.platform === 'win32' }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-check-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = await mkdtemp(join(root, 'checkout-'))
  const alias = join(root, 'alias')
  await symlink(path, alias)
  const f = checkFixture(root, path)
  f.views.other = { worktree: [], workingDirectory: alias }
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('in-use'))
  f.views.other.workingDirectory = join(root, 'unresolved')
  assert.deepEqual(await f.api.request(owner, 'GET', f.url()), checkResult('check-unavailable'))
})

test('check forwards peer cancellation to the fresh projection and never replies', async () => {
  const f = checkFixture('/repo', '/repo/checkout')
  const controller = new AbortController()
  let observed
  f.services.sessionQuery.inspectSession = (id, read, signal) => {
    assert.equal(id, 'target')
    observed = signal
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }
  const request = f.api.open({ ...owner, signal: controller.signal }, 'GET', f.url())
  await setImmediate()
  assert.equal(observed.aborted, false)
  controller.abort()
  await request.finished
  assert.equal(observed.aborted, true)
  assert.deepEqual(request.replies, [])
  assert.equal(request.res.destroyed, true)
  assert.equal(request.res.listenerCount('close'), 0)
})

const snapshotCommit = 'b'.repeat(40)
const snapshotInvalid = [400, { ok: false, reason: 'invalid-worktree-snapshot' }]
const snapshotUnavailable = [409, { ok: false, reason: 'snapshot-unavailable' }]

function snapshotBody(raw = JSON.stringify({ commit: snapshotCommit, branch: 'recovered' })) {
  let consumed = false
  const req = Readable.from(function* () { consumed = true; yield Buffer.from(raw) }())
  req.headers = { 'content-type': 'application/json' }
  return { req, get consumed() { return consumed } }
}

async function snapshotFixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-snapshots-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.git', 'objects'), { recursive: true })
  const f = checkFixture(root, join(root, 'removed-checkout'), MANAGED_WORKTREE_SNAPSHOTS_PATH)
  const gitCalls = []
  f.services.sandbox = {
    async confine(argv, policy) {
      assert.deepEqual(policy, { mode: 'read-only', workspaceRoot: root })
      return { enforcement: 'full', argv }
    },
  }
  f.services.subprocess = {
    async resolveExecutable(name) {
      gitCalls.push(name)
      return join(root, 'fake-git')
    },
    spawn({ argv, cwd }) {
      gitCalls.push(argv)
      assert.equal(cwd, root)
      assert.ok(argv.includes('for-each-ref'))
      const prefix = argv.at(-1)
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: `${prefix}${snapshotCommit}\0${snapshotCommit}\0commit\0\n`, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
        terminate() {},
        async waitForExit() { return true },
      }
    },
  }
  return { ...f, gitCalls }
}

test('snapshots route rejects unauthenticated uploads before reading the body on either host auth path', async () => {
  const url = `${MANAGED_WORKTREE_SNAPSHOTS_PATH}?${new URLSearchParams({ sessionId: 'target', repositoryRoot: '/repo', path: '/repo/checkout' })}`
  const api = setup({})
  const guest = { ...owner, principal: { kind: 'guest' } }
  const revoked = { ...owner, signal: AbortSignal.abort() }
  for (const [peer, status] of [[undefined, 401], [guest, 403], [revoked, 403]]) {
    const body = snapshotBody('{')
    assert.deepEqual(await api.request(peer, 'POST', url, body.req), [status, undefined])
    assert.equal(body.consumed, false)
    assert.equal(body.req.listenerCount('data'), 0)
  }
  assert.equal(api.lookups, 0)

  const legacy = setup({}, { requestRejection: () => 403 })
  const denied = snapshotBody('{')
  assert.deepEqual(await legacy.request(owner, 'POST', url, denied.req), [403, undefined])
  assert.equal(denied.consumed, false)
  assert.equal(denied.req.listenerCount('data'), 0)
  assert.equal(legacy.lookups, 0)

  const admitted = snapshotBody('{')
  assert.deepEqual(await api.request(owner, 'POST', url, admitted.req), snapshotInvalid)
  assert.equal(admitted.consumed, true)
})

test('snapshots route does not invoke Git for invalid selectors, denied access, inherited or unarchived ownership', async t => {
  const f = await snapshotFixture(t)
  for (const method of ['GET', 'POST']) {
    const request = (url = f.url()) => f.api.request(owner, method, url, snapshotBody().req)
    assert.deepEqual(await request(`${f.url()}&path=/arbitrary`), snapshotInvalid)
    assert.deepEqual(f.inspected, [])

    f.services.remoteAccess = { allows: () => false }
    assert.deepEqual(await request(), checkMissing)
    assert.deepEqual(f.inspected, [])
    delete f.services.remoteAccess

    assert.deepEqual(await request(f.url({ repositoryRoot: '/arbitrary' })), checkMissing)
    f.reference.owned = false
    assert.deepEqual(await request(), checkMissing)
    f.reference.owned = true

    f.services.workspaceRegistry.archivedSessionIds = []
    assert.deepEqual(await request(), snapshotUnavailable)
    f.services.workspaceRegistry.archivedSessionIds = ['target']
    assert.deepEqual(f.inspected.splice(0), ['target', 'target', 'target'])
    assert.deepEqual(f.gitCalls, [])
  }
})

test('snapshot restore does not trust archive state from before the upload completes', async t => {
  const f = await snapshotFixture(t)
  const req = new PassThrough()
  req.headers = { 'content-type': 'application/json' }
  const request = f.api.open(owner, 'POST', f.url(), req)
  req.write(`{"commit":"${snapshotCommit}",`)
  await setImmediate()
  assert.deepEqual(request.replies, [])

  f.services.workspaceRegistry.archivedSessionIds = []
  req.complete = true
  req.end('"branch":"recovered"}')
  await request.finished
  assert.deepEqual(request.replies, [snapshotUnavailable])
  assert.ok(f.inspected.includes('target'))
  assert.deepEqual(f.gitCalls, [])
})

test('snapshots lists pins without a checkout and revalidates the archived owner before replying', async t => {
  const f = await snapshotFixture(t)
  const listed = f.api.open(owner, 'GET', f.url())
  await listed.finished
  assert.deepEqual(listed.replies, [[200, { ok: true, commits: [snapshotCommit] }]])
  assert.equal(listed.headers['cache-control'], 'no-store')
  assert.deepEqual(f.inspected.splice(0), ['target', 'target'])
  assert.equal(f.gitCalls.length, 2)

  const subprocess = f.services.subprocess
  const spawn = subprocess.spawn
  for (const [change, reset, expected] of [
    [() => { f.selected.branch = 'reassigned' }, () => { f.selected.branch = 'topic' }, checkMissing],
    [() => { f.services.workspaceRegistry.archivedSessionIds = [] }, () => { f.services.workspaceRegistry.archivedSessionIds = ['target'] }, snapshotUnavailable],
  ]) {
    subprocess.spawn = options => {
      change()
      return spawn(options)
    }
    assert.deepEqual(await f.api.request(owner, 'GET', f.url()), expected)
    assert.deepEqual(f.inspected.splice(0), ['target', 'target'])
    reset()
  }
})
