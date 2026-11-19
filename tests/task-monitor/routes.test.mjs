import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { registerJsonRoutes } from '../../src/host/routes.js'
import {
  TASK_MONITOR_REASON,
  TASK_MONITOR_SNAPSHOT_PATH,
  TASK_MONITOR_SOURCE_ADD_PATH,
  TASK_MONITOR_SOURCE_REMOVE_PATH,
} from '../../src/modules/task-monitor/host/constants.js'
import { createTaskMonitorStore } from '../../src/modules/task-monitor/host/domain/store.js'
import { createTaskMonitorRoutes } from '../../src/modules/task-monitor/host/routes/highlights.js'

async function harness(t, { enabled } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-monitor-routes-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const store = createTaskMonitorStore({ home, persistDelayMs: 5, enabled })
  const routes = new Map()
  const rejections = []
  const ctx = new Context()
  ctx.provide('webServer', {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  })
  ctx.provide('connection', {
    requestRejection(req) {
      rejections.push(req)
      return undefined
    },
  })
  const fiber = ctx.plugin((child) => {
    registerJsonRoutes(child, createTaskMonitorRoutes({ store }))
  })
  await fiber
  t.after(() => fiber.dispose())

  async function call(path, body, { method = 'POST', raw } = {}) {
    const route = routes.get(path)
    assert.ok(route, `route ${path} registered`)
    const req = new PassThrough()
    req.method = method
    req.headers = {}
    const res = {
      statusCode: 0,
      headers: {},
      body: undefined,
      setHeader(name, value) { this.headers[name] = value },
      end(payload) { this.body = payload },
    }
    const done = new Promise((resolve) => { res.end = (payload) => { res.body = payload; resolve() } })
    const pending = route.handler(req, res)
    if (raw !== undefined) req.end(raw)
    else if (body !== undefined) req.end(JSON.stringify(body))
    else req.end()
    await Promise.resolve(pending)
    await done
    return { status: res.statusCode, payload: JSON.parse(res.body), headers: res.headers, req }
  }
  return { store, call, rejections, routes }
}

test('三条路由挂在统一前缀下，身份拒绝先于读 body', async (t) => {
  const { call, rejections, routes } = await harness(t)
  assert.deepEqual([...routes.keys()].sort(), [TASK_MONITOR_SNAPSHOT_PATH, TASK_MONITOR_SOURCE_ADD_PATH, TASK_MONITOR_SOURCE_REMOVE_PATH].sort())
  const result = await call(TASK_MONITOR_SNAPSHOT_PATH, { sessionId: 's1' })
  assert.equal(result.status, 200)
  assert.equal(result.payload.ok, true)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(rejections.length, 1)
})

test('方法不符 404，坏 JSON 400，形状不符 400 带 reason', async (t) => {
  const { call } = await harness(t)
  const wrongMethod = await call(TASK_MONITOR_SNAPSHOT_PATH, { sessionId: 's1' }, { method: 'GET' })
  assert.equal(wrongMethod.status, 404)
  assert.deepEqual(wrongMethod.payload, { ok: false, reason: 'not-found' })
  const badJson = await call(TASK_MONITOR_SNAPSHOT_PATH, undefined, { raw: '{oops' })
  assert.equal(badJson.status, 400)
  assert.deepEqual(badJson.payload, { ok: false, reason: 'bad-json' })
  const badShape = await call(TASK_MONITOR_SOURCE_ADD_PATH, { sessionId: 's1', kind: 'url', value: 42 })
  assert.equal(badShape.status, 400)
  assert.match(badShape.payload.reason, /字符串/)
})

test('业务码折算 HTTP：4102→400、4103→409、4104→404、4105→409', async (t) => {
  const { call, store } = await harness(t)
  const invalid = await call(TASK_MONITOR_SOURCE_ADD_PATH, { sessionId: 's1', kind: 'url', value: 'javascript:alert(1)' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.payload.code, TASK_MONITOR_REASON.invalidSource)

  await store.record('s1', [{ kind: 'source', id: 'auto', label: 'auto', detail: '' }], 'ok')
  const notManual = await call(TASK_MONITOR_SOURCE_REMOVE_PATH, { sessionId: 's1', id: 'auto' })
  assert.equal(notManual.status, 409)
  assert.equal(notManual.payload.code, TASK_MONITOR_REASON.notManual)
  const notFound = await call(TASK_MONITOR_SOURCE_REMOVE_PATH, { sessionId: 's1', id: 'ghost' })
  assert.equal(notFound.status, 404)
  assert.equal(notFound.payload.code, TASK_MONITOR_REASON.notFound)

  const added = await call(TASK_MONITOR_SOURCE_ADD_PATH, { sessionId: 's1', kind: 'file', value: '/repo/a.md' })
  assert.equal(added.status, 200)
  assert.equal(added.payload.entry.manual, true)
  const removed = await call(TASK_MONITOR_SOURCE_REMOVE_PATH, { sessionId: 's1', id: added.payload.entry.id })
  assert.equal(removed.status, 200)
})

test('disabled 时快照回 409/4105', async (t) => {
  const { call } = await harness(t, { enabled: () => false })
  const result = await call(TASK_MONITOR_SNAPSHOT_PATH, { sessionId: 's1' })
  assert.equal(result.status, 409)
  assert.equal(result.payload.code, TASK_MONITOR_REASON.disabled)
})

test('8192 个中文字符接受，8193 个 destroy 且永不响应', async (t) => {
  const { call } = await harness(t)
  // snapshot 的 sessionId 没有域长度上限，纯测传输层字符限流。
  const accepted = await call(TASK_MONITOR_SNAPSHOT_PATH, { sessionId: '中'.repeat(8192 - 20) })
  assert.equal(accepted.status, 200)

  const route = (await harness(t)).routes.get(TASK_MONITOR_SNAPSHOT_PATH)
  const req = new PassThrough()
  req.method = 'POST'
  req.headers = {}
  let answered = false
  let destroyed = false
  req.on('close', () => { destroyed = true })
  const res = {
    statusCode: 0,
    setHeader() {},
    end() { answered = true },
  }
  route.handler(req, res)
  req.end(JSON.stringify({ sessionId: '中'.repeat(8193) }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(answered, false)
  assert.equal(destroyed, true)
})