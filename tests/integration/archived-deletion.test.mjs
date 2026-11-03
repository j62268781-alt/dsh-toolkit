import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as archived from '../../src/modules/archived/host/index.js'
import { DELETE_SESSION_PATH } from '../../src/modules/archived/host/paths.js'
import { removeSessionViaHost } from '../../src/modules/archived/client/deletion.js'

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

async function host(t, getSession = () => undefined) {
  const ctx = new Context()
  const routes = new Map()
  const reads = []
  const guarded = []
  let rejection
  let cleanups = 0
  ctx.provide('sessions', { get(id) { reads.push(id); return getSession(id) } })
  ctx.provide('connection', { requestRejection(req) { guarded.push(req); return rejection } })
  ctx.provide('webServer', {
    register(route) {
      assert.equal(route.kind, 'exact')
      assert.equal(route.path, DELETE_SESSION_PATH)
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
    ctx, fiber, routes, reads, guarded,
    route: routes.get(DELETE_SESSION_PATH),
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

test('archived entry owns one authenticated route, unloads, and reloads without index injection', async (t) => {
  assert.deepEqual(archived.inject, ['sessions', 'webServer', 'connection'])
  const service = await host(t)
  assert.equal(service.routes.size, 1)
  const table = []
  await service.ctx.emit('webserver/index-inject', table)
  assert.deepEqual(table, [])
  await service.fiber.dispose()
  await service.fiber.dispose()
  assert.equal(service.routes.size, 0)
  assert.equal(service.cleanups, 1)
  const second = service.ctx.plugin(archived)
  await second
  assert.equal(second.state, 2)
  assert.equal(service.routes.size, 1)
  await second.dispose()
  assert.equal(service.routes.size, 0)
  assert.equal(service.cleanups, 2)
})

test('archived entry waits for all three host dependencies before registering', async () => {
  const ctx = new Context()
  let registrations = 0
  ctx.provide('sessions', { get() {} })
  const fiber = ctx.plugin(archived)
  try {
    await fiber
    assert.equal(fiber.state, 0)
    assert.equal(registrations, 0)
    ctx.provide('webServer', { register() { registrations++; return () => { registrations-- } } })
    await fiber
    assert.equal(fiber.state, 0)
    assert.equal(registrations, 0)
    ctx.provide('connection', { requestRejection() {} })
    await fiber
    assert.equal(fiber.state, 2)
    assert.equal(registrations, 1)
  } finally {
    await fiber.dispose()
  }
  assert.equal(registrations, 0)
})

test('host identity and origin rejections stop archived deletion before body and session lookup', async (t) => {
  const service = await host(t, () => { throw new Error('rejected request reached sessions') })
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

test('archived route preserves methods, JSON, session ID, loaded-session, and path guards', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const outside = join(root, 'outside')
  await mkdir(join(root, 'sessions', 'bucket'), { recursive: true })
  await writeFile(outside, 'keep')
  const service = await host(t, id => id === 'live' ? {} : undefined)
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
    ['{"sessionId":"live"}', 409, 'session-loaded'],
    ['{"sessionId":"../outside"}', 404, 'invalid-session-id'],
    ['{"sessionId":"/absolute"}', 404, 'invalid-session-id'],
    ['{"sessionId":"a\\\\b"}', 404, 'invalid-session-id'],
    ['{"sessionId":"missing"}', 404, 'not-found'],
  ]) {
    const { res } = await request(service.route, body)
    assert.equal(res.statusCode, status)
    assert.deepEqual(res.json(), { ok: false, reason })
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  }
  assert.equal(await readFile(outside, 'utf8'), 'keep')
  assert.deepEqual(await readdir(join(root, 'sessions', 'bucket')), [])
})

test('archived route keeps the 8192 decoded raw-input limit and destroys oversized requests before business', { timeout: 5000 }, async (t) => {
  const service = await host(t, () => ({}))
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

test('authenticated archived deletion moves real session files and projection cache only after the live guard', { timeout: 5000 }, async (t) => {
  const root = await home(t)
  const sessionId = 'archived-123.test'
  const sessionDir = join(root, 'sessions', '2026-11-03', sessionId)
  const loadedDir = join(root, 'sessions', '2026-11-03', 'live')
  const cacheDir = join(root, 'storages', 'session_projcache', 'sessions')
  const trashDir = join(root, 'dsh-delete-session-trash')
  await Promise.all([
    mkdir(sessionDir, { recursive: true }),
    mkdir(loadedDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
  ])
  await writeFile(join(sessionDir, 'messages.jsonl'), '{"role":"user","text":"preserved"}\n')
  await writeFile(join(cacheDir, `${sessionId}.json`), '{"title":"archived"}')
  await writeFile(join(loadedDir, 'messages.jsonl'), 'live remains')
  const service = await host(t, id => id === 'live' ? {} : undefined)

  const loaded = await request(service.route, '{"sessionId":"live"}')
  assert.equal(loaded.res.statusCode, 409)
  assert.equal(await readFile(join(loadedDir, 'messages.jsonl'), 'utf8'), 'live remains')
  await assert.rejects(stat(trashDir), { code: 'ENOENT' }, 'live guard must not even create the trash directory')

  const { res } = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(res.statusCode, 200)
  const result = res.json()
  assert.equal(result.ok, true)
  assert.equal(dirname(result.moved), trashDir)
  assert.ok(result.moved.endsWith(`-${sessionId}`))
  await assert.rejects(stat(sessionDir), { code: 'ENOENT' })
  await assert.rejects(stat(join(cacheDir, `${sessionId}.json`)), { code: 'ENOENT' })
  assert.equal(await readFile(join(result.moved, 'messages.jsonl'), 'utf8'), '{"role":"user","text":"preserved"}\n')
  assert.equal(await readFile(`${result.moved}.projcache.json`, 'utf8'), '{"title":"archived"}')
  assert.equal(await readFile(join(loadedDir, 'messages.jsonl'), 'utf8'), 'live remains')
  const again = await request(service.route, JSON.stringify({ sessionId }))
  assert.equal(again.res.statusCode, 404)
  assert.deepEqual(again.res.json(), { ok: false, reason: 'not-found' })
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

test('archived client preserves error receipts and reports a failed request', async (t) => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'session-loaded' }) })
  assert.deepEqual(await removeSessionViaHost('live'), { ok: false, reason: 'session-loaded' })
  globalThis.fetch = async () => { throw new Error('connection lost') }
  assert.deepEqual(await removeSessionViaHost('archived'), { ok: false, reason: 'connection lost' })
})
