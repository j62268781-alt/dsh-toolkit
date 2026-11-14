import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE } from '../../src/modules/notification/host/constants.ts'
import { apply } from '../../src/modules/notification/host/index.ts'
import { SERVICE_WORKER_SOURCE } from '../../src/modules/notification/host/service-worker.ts'

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = value },
  }
}

/** 装一遍模块，返回注册到的路由表。 */
function mount() {
  const routes = []
  const disposals = []
  const ctx = {
    effect(run) { disposals.push(run()); return () => {} },
    webServer: { register(route) { routes.push(route); return () => {} } },
    // 只要 handler 走了这条通道就会被记下来：SW 脚本恰恰不该走。
    connection: { requestRejection() { rejected.push('requestRejection'); return 401 } },
  }
  const rejected = []
  apply(ctx)
  return { routes, disposals, rejected }
}

test('service worker 脚本路由不鉴权，带对 scope 头，且只回固定文本', async () => {
  const { routes, rejected } = mount()
  const route = routes.find((entry) => entry.path === SERVICE_WORKER_PATH)
  assert.ok(route, 'apply() 必须挂上 SW 脚本路由')
  assert.equal(route.kind, 'exact')
  // 脚本请求带不上页面 token，鉴权只会有 401 一种结局。
  assert.deepEqual(rejected, [])

  const res = response()
  await route.handler({ method: 'GET', url: SERVICE_WORKER_PATH }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8')
  // 放宽 scope 到站点根：只有控制住应用页面，clients.matchAll() 才看得到那个标签页。
  assert.equal(res.headers['service-worker-allowed'], '/')
  // 不做长缓存，改完脚本要能被下一次注册立刻发现。
  assert.equal(res.headers['cache-control'], 'no-cache')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(Number(res.headers['content-length']), Buffer.byteLength(SERVICE_WORKER_SOURCE))
  assert.equal(res.body.toString('utf8'), SERVICE_WORKER_SOURCE)
})

test('service worker 脚本只做点击处理，不拦截请求', async () => {
  // 拦截 fetch 会把整个应用拖下水（scope 是站点根）：这条断言防止以后有人手滑加进去。
  assert.equal(/addEventListener\(\s*['"]fetch['"]/.test(SERVICE_WORKER_SOURCE), false)
  for (const needle of ['notificationclick', 'clients.openWindow', 'clients.matchAll', 'client.focus()', 'postMessage']) {
    assert.ok(SERVICE_WORKER_SOURCE.includes(needle), `脚本体里应该有 ${needle}`)
  }
  assert.equal(SERVICE_WORKER_SCOPE, '/')
})

test('非 GET 请求回 404，HEAD 不回正文', async () => {
  const { routes } = mount()
  const route = routes.find((entry) => entry.path === SERVICE_WORKER_PATH)
  const post = response()
  await route.handler({ method: 'POST', url: SERVICE_WORKER_PATH }, post)
  assert.equal(post.statusCode, 404)
  assert.equal(post.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(String(post.body)), { ok: false, reason: 'not-found' })

  const head = response()
  await route.handler({ method: 'HEAD', url: SERVICE_WORKER_PATH }, head)
  assert.equal(head.statusCode, 200)
  assert.equal(head.body, undefined)
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(SERVICE_WORKER_SOURCE))
})
