import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as archived from '../../src/modules/archived/host/index.ts'
import { DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH } from '../../src/modules/archived/host/constants.ts'
import { pruneArchivedTombstones } from '../../src/modules/archived/host/trash/reconcile.ts'
import { listPendingDeletions } from '../../src/modules/archived/host/trash/files.ts'
import { readPendingDeletions, removeSessionViaHost, removeSessionsViaHost } from '../../src/modules/archived/client/deletion.ts'

function response() {
  let finish
  return {
    statusCode: 0,
    headers: {},
    ended: false,
    body: '',
    done: new Promise(resolve => { finish = resolve }),
    setHeader(name, value) { this.headers[name] = value },
    end(value = '') { this.body = value; this.ended = true; finish() },
    json() { return JSON.parse(this.body) },
  }
}

function incoming(body = '', method = 'POST') {
  const req = new PassThrough()
  req.method = method
  req.url = DELETE_SESSION_PATH
  req.headers = { 'content-type': 'application/json' }
  return { req, res: response(), body }
}

async function request(route, body = '', method = 'POST') {
  const io = incoming(body, method)
  route.handler(io.req, io.res)
  io.req.end(body)
  await io.res.done
  return io
}

async function host(t, options = {}) {
  const { getSession = () => undefined, getAgent = () => undefined, archivedIds = [], flush } = options
  const ctx = new Context()
  const routes = new Map()
  const reads = []
  const guarded = []
  const flushes = []
  const calls = { unarchive: [], unpin: [] }
  let rejection
  let cleanups = 0
  const sessions = { get(id) { reads.push(id); return getSession(id) } }
  // Only present when a test cares that durability is awaited before the move.
  if (flush !== undefined) {
    sessions.flush = async (session) => { flushes.push(session); await flush(session) }
  }
  ctx.provide('sessions', sessions)
  ctx.provide('agents', { get(id) { return getAgent(id) } })
  ctx.provide('workspaceRegistry', {
    get archivedSessionIds() { return archivedIds },
    async unarchiveSession(id) { calls.unarchive.push(id) },
    async unpinSession(id) { calls.unpin.push(id) },
  })
  ctx.provide('connection', { requestRejection(req) { guarded.push(req); return rejection } })
  ctx.provide('webServer', {
    register(route) {
      assert.equal(route.kind, 'exact')
      assert.equal(routes.has(route.path), false, 'reloading must not leave a duplicate route')
      routes.set(route.path, route)
      return () => { cleanups++; routes.delete(route.path) }
    },
  })
  const fiber = ctx.plugin(archived)
  await fiber
  t.after(() => fiber.dispose())
  assert.equal(fiber.state, 2)
  return {
    ctx, fiber, routes, reads, guarded, flushes, calls,
    route: routes.get(DELETE_SESSION_PATH),
    bulkRoute: routes.get(DELETE_SESSIONS_PATH),
    pendingRoute: routes.get(PENDING_DELETIONS_PATH),
    rejectWith(status) { rejection = status },
    get cleanups() { return cleanups },
  }
}

async function home(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archived-delete-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    const actual = await realpath(root)
    const parent = await realpath(tmpdir())
    assert.equal(dirname(actual), parent)
    assert.match(actual.slice(parent.length + 1), /^dsh-archived-delete-/)
    await rm(actual, { recursive: true })
  })
  return root
}

test('archived entry owns its authenticated routes, unloads, and reloads without index injection', async (t) => {
  assert.deepEqual(archived.inject, ['sessions', 'agents', 'workspaceRegistry', 'webServer', 'connection'])
  const service = await host(t)
  assert.deepEqual([...service.routes.keys()].sort(), [DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH].sort())
  const table = []
  await service.ctx.emit('webserver/index-inject', table)
  assert.deepEqual(table, [])
  await service.fiber.dispose()
  await service.fiber.dispose()
  assert.equal(service.routes.size, 0)
  assert.equal(service.cleanups, 3)
  const second = service.ctx.plugin(archived)
  await second
  assert.equal(second.state, 2)
  assert.equal(service.routes.size, 3)
  await second.dispose()
  assert.equal(service.routes.size, 0)
  assert.equal(service.cleanups, 6)
})

test('archived entry waits for every host dependency before registering', async () => {
  const ctx = new Context()
  const registered = []
  ctx.provide('sessions', { get() {} })
  const fiber = ctx.plugin(archived)
  try {
    await fiber
    assert.equal(fiber.state, 0)
    assert.deepEqual(registered, [])
    ctx.provide('agents', { get() {} })
    await fiber
    assert.equal(fiber.state, 0)
    ctx.provide('workspaceRegistry', { archivedSessionIds: [] })
    await fiber
    assert.equal(fiber.state, 0)
    ctx.provide('webServer', { register(route) { registered.push(route.path); return () => { registered.pop() } } })
    await fiber
    assert.equal(fiber.state, 0)
    assert.deepEqual(registered, [], 'a route must not register before the connection gate is available')
    ctx.provide('connection', { requestRejection() {} })
    await fiber
    assert.equal(fiber.state, 2)
  } finally {
    await fiber.dispose()
  }
  assert.deepEqual(registered, [])
})

test('host identity and origin rejections stop archived deletion before body and session lookup', async (t) => {
  const service = await host(t, { getSession: () => { throw new Error('rejected request reached sessions') } })
  for (const status of [401, 403]) {
    service.rejectWith(status)
    const io = incoming('{')
    service.route.handler(io.req, io.res)
    await io.res.done
    assert.equal(io.res.statusCode, status)
    assert.equal(io.res.body, '')
    assert.deepEqual(io.res.headers, {})
    assert.equal(io.req.readableEncoding, null)
    assert.equal(io.req.listenerCount('data'), 0)
    assert.equal(service.guarded.at(-1), io.req)
    io.req.destroy()
  }
  assert.deepEqual(service.reads, [])
})

test('archived route preserves methods, JSON, session ID, and path guards', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const outside = join(root, 'outside')
  await mkdir(join(root, 'sessions', 'bucket'), { recursive: true })
  await writeFile(outside, 'keep')
  // Loaded but not archived: the ordinary sidebar owns it, so nothing may move.
  const service = await host(t, { getSession: id => id === 'live' ? {} : undefined })
  for (const method of ['GET', 'OPTIONS']) {
    const { res } = await request(service.route, '', method)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { ok: false, reason: 'not-found' })
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  }
  for (const [body, status, reason] of [
    ['{', 400, 'bad-json'],
    ['{}', 400, 'bad-session-id'],
    ['{"sessionId":null}', 400, 'bad-session-id'],
    ['{"sessionId":""}', 400, 'bad-session-id'],
  ]) {
    const { res } = await request(service.route, body)
    assert.equal(res.statusCode, status)
    // 传输层的坏输入仍然用 `reason`（`host/routes.ts` 的协议词汇，全仓共用）；
    // 业务判定才用 `code`。两者不互相转换。
    assert.deepEqual(res.json(), { ok: false, reason })
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  }
  for (const [body, status, code] of [
    ['{"sessionId":"live"}', 409, 'session-loaded'],
    ['{"sessionId":"../outside"}', 404, 'invalid-session-id'],
    ['{"sessionId":"/absolute"}', 404, 'invalid-session-id'],
    ['{"sessionId":"a\\\\b"}', 404, 'invalid-session-id'],
    ['{"sessionId":"missing"}', 404, 'not-found'],
  ]) {
    const { res } = await request(service.route, body)
    assert.equal(res.statusCode, status)
    assert.deepEqual(res.json(), { ok: false, code })
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  }
  assert.equal(await readFile(outside, 'utf8'), 'keep')
  assert.deepEqual(await readdir(join(root, 'sessions', 'bucket')), [])
})

test('an archived session is deletable while loaded, and a running one is still refused', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const idleId = 'archived-idle'
  const runningId = 'archived-running'
  await mkdir(join(root, 'sessions', 'bucket', idleId), { recursive: true })
  await mkdir(join(root, 'sessions', 'bucket', runningId), { recursive: true })
  const loaded = new Map([[idleId, {}], [runningId, {}]])
  const service = await host(t, {
    getSession: id => loaded.get(id),
    // `status` is the host's own notion of busy; anything else is idle.
    getAgent: id => id === runningId ? { status: 'running' } : { status: 'idle' },
    archivedIds: [idleId, runningId],
  })

  const busy = await request(service.route, JSON.stringify({ sessionId: runningId }))
  assert.equal(busy.res.statusCode, 409)
  assert.deepEqual(busy.res.json(), { ok: false, code: 'session-busy' })
  await assert.rejects(stat(join(root, 'dsh-delete-session-trash')), { code: 'ENOENT' })

  const idle = await request(service.route, JSON.stringify({ sessionId: idleId }))
  assert.equal(idle.res.statusCode, 200)
  const result = idle.res.json()
  assert.equal(result.ok, true)
  assert.equal(result.code, 'retained', 'a loaded session keeps its tombstone until the host drops it')
  await assert.rejects(stat(join(root, 'sessions', 'bucket', idleId)), { code: 'ENOENT' })
  // The archive registration must survive: clearing it would put the record back in
  // the sidebar while the host still holds the session.
  assert.deepEqual(service.calls.unarchive, [])
})

test('deleting a loaded archived session drains persistence before moving anything', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const sessionId = 'archived-flush'
  const sessionDir = join(root, 'sessions', 'bucket', sessionId)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'buffered')
  let dirAtFlush
  const service = await host(t, {
    getSession: id => id === sessionId ? { id } : undefined,
    archivedIds: [sessionId],
    flush: async () => { dirAtFlush = await stat(sessionDir).then(() => true, () => false) },
  })

  const { res } = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(res.statusCode, 200)
  assert.equal(service.flushes.length, 1)
  assert.equal(dirAtFlush, true, 'the directory must still exist when the flush runs')
  await assert.rejects(stat(sessionDir), { code: 'ENOENT' })
})

test('a failed flush aborts the deletion and keeps the session intact', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const sessionId = 'archived-flush-failure'
  const sessionDir = join(root, 'sessions', 'bucket', sessionId)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'unsaved')
  const service = await host(t, {
    getSession: id => id === sessionId ? { id } : undefined,
    archivedIds: [sessionId],
    flush: async () => { throw new Error('disk full') },
  })

  const { res } = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.json(), { ok: false, reason: 'disk full' })
  assert.equal(await readFile(join(sessionDir, 'session.v4.jsonl.zstd'), 'utf8'), 'unsaved')
  assert.deepEqual(await listPendingDeletions(), [])
})

test('archived route keeps the 8192 decoded raw-input limit and destroys oversized requests before business', { timeout: 5000 }, async (t) => {
  const service = await host(t, { getSession: () => ({}) })
  const value = JSON.stringify({ sessionId: 'live', padding: '中🙂'.repeat(1800) })
  const exact = value.padEnd(8192, ' ')
  assert.equal(exact.length, 8192)
  assert.ok(Buffer.byteLength(exact) > 8192, 'the original limit counts decoded input, not bytes')
  const accepted = incoming()
  const bytes = Buffer.from(exact)
  service.route.handler(accepted.req, accepted.res)
  accepted.req.write(bytes.subarray(0, 33))
  accepted.req.end(bytes.subarray(33))
  await accepted.res.done
  assert.equal(accepted.res.statusCode, 409)
  assert.deepEqual(service.reads, ['live'])

  const oversized = incoming()
  service.route.handler(oversized.req, oversized.res)
  const closed = once(oversized.req, 'close')
  oversized.req.end(`${exact} `)
  await closed
  // Even an unexpected end notification after destruction must not parse or delete.
  oversized.req.emit('end')
  assert.equal(oversized.req.destroyed, true)
  assert.equal(oversized.res.ended, false)
  assert.deepEqual(service.reads, ['live'])
})

test('authenticated archived deletion moves real session files and projection cache', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const sessionId = 'archived-123.test'
  const sessionDir = join(root, 'sessions', '2026-11-03', sessionId)
  const cacheDir = join(root, 'storages', 'session_projcache', 'sessions')
  const trashDir = join(root, 'dsh-delete-session-trash')
  await Promise.all([mkdir(sessionDir, { recursive: true }), mkdir(cacheDir, { recursive: true })])
  await writeFile(join(sessionDir, 'messages.jsonl'), '{"role":"user","text":"preserved"}\n')
  await writeFile(join(cacheDir, `${sessionId}.json`), '{"title":"archived"}')
  const service = await host(t)

  const { res } = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(res.statusCode, 200)
  const result = res.json()
  assert.equal(result.ok, true)
  assert.equal(result.code, 'deleted', 'an unloaded session needs no tombstone')
  assert.equal(dirname(result.moved), trashDir)
  assert.ok(result.moved.endsWith(`-${sessionId}`))
  await assert.rejects(stat(sessionDir), { code: 'ENOENT' })
  await assert.rejects(stat(join(cacheDir, `${sessionId}.json`)), { code: 'ENOENT' })
  assert.equal(await readFile(join(result.moved, 'messages.jsonl'), 'utf8'), '{"role":"user","text":"preserved"}\n')
  assert.equal(await readFile(`${result.moved}.projcache.json`, 'utf8'), '{"title":"archived"}')
  const again = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(again.res.statusCode, 404)
  assert.deepEqual(again.res.json(), { ok: false, code: 'not-found' })
})

test('pending deletions survive a reload and are pruned once the host drops the session', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const sessionId = 'archived-pending'
  await mkdir(join(root, 'sessions', 'bucket', sessionId), { recursive: true })
  const service = await host(t, {
    getSession: id => id === sessionId ? { id } : undefined,
    archivedIds: [sessionId],
  })

  const deleted = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(deleted.res.statusCode, 200)
  assert.deepEqual(await listPendingDeletions(), [sessionId])

  // The host still holds it: the lookup keeps both the marker and the registration,
  // because unarchiving now would surface a session whose files are gone.
  const listed = await request(service.pendingRoute, '', 'GET')
  assert.equal(listed.res.statusCode, 200)
  assert.deepEqual(listed.res.json(), { ok: true, sessionIds: [sessionId] })
  assert.deepEqual(service.calls.unarchive, [])
  assert.deepEqual(await listPendingDeletions(), [sessionId])

  // After a restart the session is no longer live, so the same lookup retires it.
  const restarted = await host(t, { archivedIds: [sessionId] })
  const pruned = await request(restarted.pendingRoute, '', 'GET')
  assert.equal(pruned.res.statusCode, 200)
  assert.deepEqual(pruned.res.json(), { ok: true, sessionIds: [] })
  assert.deepEqual(restarted.calls.unarchive, [sessionId])
  assert.deepEqual(restarted.calls.unpin, [sessionId])
  assert.deepEqual(await listPendingDeletions(), [])
})

test('pruning without markers never touches the workspace registry', { timeout: 5000 }, async (t) => {
  await home(t)
  const service = await host(t, { archivedIds: ['archived-kept'] })
  // Nothing was deleted through this module, so no registration may be retired.
  assert.deepEqual(await pruneArchivedTombstones(service.ctx), [])
  assert.deepEqual(service.calls.unarchive, [])
  assert.deepEqual(service.calls.unpin, [])
})

test('bulk route validates the id list before touching any session', { timeout: 5000 }, async (t) => {
  await home(t)
  const service = await host(t, { getSession: () => ({}) })
  assert.ok(service.bulkRoute, 'the page needs a route that takes a whole batch')
  for (const [body, reason] of [
    ['{', 'bad-json'],
    ['{}', 'bad-session-ids'],
    ['{"sessionIds":[]}', 'bad-session-ids'],
    ['{"sessionIds":"one"}', 'bad-session-ids'],
    ['{"sessionIds":[null]}', 'bad-session-ids'],
    ['{"sessionIds":[""]}', 'bad-session-ids'],
    [`{"sessionIds":${JSON.stringify(Array.from({ length: 501 }, (_, i) => `id-${i}`))}}`, 'bad-session-ids'],
  ]) {
    const { res } = await request(service.bulkRoute, body)
    assert.equal(res.statusCode, 400, body.slice(0, 60))
    assert.deepEqual(res.json(), { ok: false, reason })
    assert.equal(res.headers['cache-control'], 'no-store')
  }
  // Validation runs before any lookup, so nothing was probed and nothing moved.
  assert.deepEqual(service.reads, [])
  for (const method of ['GET', 'OPTIONS']) {
    const { res } = await request(service.bulkRoute, '', method)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { ok: false, reason: 'not-found' })
  }
})

test('bulk route answers one receipt per session and a rejected row does not abort the batch', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const removable = 'bulk-removable'
  const loaded = 'bulk-loaded'
  const running = 'bulk-running'
  for (const id of [removable, loaded, running]) await mkdir(join(root, 'sessions', 'bucket', id), { recursive: true })
  const live = new Map([[loaded, {}], [running, {}]])
  const service = await host(t, {
    getSession: id => live.get(id),
    // `status` is the host's own notion of busy; anything else is idle.
    getAgent: id => id === running ? { status: 'running' } : { status: 'idle' },
    archivedIds: [removable, loaded, running],
  })

  const { res } = await request(service.bulkRoute, JSON.stringify({ sessionIds: [removable, running, loaded, 'bulk-missing'] }))
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.ok, true)
  // Order follows the request, and each row carries its own verdict: one moved, one
  // still running, one that was loaded, one whose files were already gone. The HTTP
  // status of a row travels as `statusCode`; the business verdict travels as `code`.
  const verdicts = body.results.map(({ sessionId, statusCode, ok, code, detail }) => ({ sessionId, statusCode, ok, code, detail }))
  assert.deepEqual(verdicts, [
    { sessionId: removable, statusCode: 200, ok: true, code: 'deleted', detail: undefined },
    { sessionId: running, statusCode: 409, ok: false, code: 'session-busy', detail: undefined },
    { sessionId: loaded, statusCode: 200, ok: true, code: 'retained', detail: undefined },
    { sessionId: 'bulk-missing', statusCode: 404, ok: false, code: 'not-found', detail: undefined },
  ])
  assert.ok(body.results[0].moved.endsWith(`-${removable}`), 'the receipt reports where the files went')
  await assert.rejects(stat(join(root, 'sessions', 'bucket', removable)), { code: 'ENOENT' })
  await assert.doesNotReject(stat(join(root, 'sessions', 'bucket', running)), 'a refused row keeps its directory')
  // A row the host still holds leaves the same tombstone the single route does, so a
  // restart still cleans its archive registration up.
  assert.deepEqual(await listPendingDeletions(), [loaded])
})

test('archived client posts a relative URL with host credentials on a remote DSH origin', async (t) => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  const origin = 'https://dsh.example.test:8443'
  const calls = []
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options, destination: new URL(input, origin).href })
    return { ok: true, status: 200, json: async () => ({ ok: true, moved: '/temporary/trash' }) }
  }
  assert.deepEqual(await removeSessionViaHost('archived-123'), { ok: true, moved: '/temporary/trash' })
  assert.equal(calls.length, 1)
  const [{ input, options, destination }] = calls
  assert.equal(input, DELETE_SESSION_PATH)
  assert.equal(destination, `${origin}${DELETE_SESSION_PATH}`)
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'same-origin')
  assert.deepEqual(options.headers, { 'content-type': 'application/json' })
  assert.deepEqual(JSON.parse(options.body), { sessionId: 'archived-123' })
})

test('archived client sends the whole page to the bulk route and keeps its receipts', async (t) => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  const origin = 'https://dsh.example.test:8443'
  const calls = []
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options, destination: new URL(input, origin).href })
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, results: [{ sessionId: 'a1', statusCode: 200, ok: true, code: 'deleted' }, { sessionId: 'a2', statusCode: 409, ok: false, code: 'session-loaded' }] }),
    }
  }
  assert.deepEqual(await removeSessionsViaHost(['a1', 'a2']), {
    ok: true,
    results: [{ sessionId: 'a1', statusCode: 200, ok: true, code: 'deleted' }, { sessionId: 'a2', statusCode: 409, ok: false, code: 'session-loaded' }],
  })
  assert.equal(calls.length, 1, 'one round trip for a page of rows')
  const [{ input, options, destination }] = calls
  assert.equal(input, DELETE_SESSIONS_PATH)
  assert.equal(destination, `${origin}${DELETE_SESSIONS_PATH}`)
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'same-origin')
  assert.deepEqual(options.headers, { 'content-type': 'application/json' })
  assert.deepEqual(JSON.parse(options.body), { sessionIds: ['a1', 'a2'] })
})

test('archived client preserves error receipts and reports a failed request', async (t) => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'session-busy' }) })
  assert.deepEqual(await removeSessionViaHost('live'), { ok: false, code: 'session-busy' })
  globalThis.fetch = async () => { throw new Error('connection lost') }
  assert.deepEqual(await removeSessionViaHost('archived'), { ok: false, code: 'unknown', detail: 'connection lost' })
})

test('archived client treats an unavailable pending list as "nothing to hide"', async (t) => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  const calls = []
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options })
    return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: ['gone-1'] }) }
  }
  assert.deepEqual([...(await readPendingDeletions())], ['gone-1'])
  assert.equal(calls[0].input, PENDING_DELETIONS_PATH)
  assert.equal(calls[0].options.method, 'GET')

  // A failing lookup must not hide rows: it degrades to an empty set.
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) })
  assert.deepEqual([...(await readPendingDeletions())], [])
  globalThis.fetch = async () => { throw new Error('offline') }
  assert.deepEqual([...(await readPendingDeletions())], [])
})
