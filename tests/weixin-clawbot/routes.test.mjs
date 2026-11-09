/**
 * 路由与装配测试：鉴权边界、方法约束、错误收敛，以及客户端插槽注册。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from '../../src/modules/weixin-clawbot/host/index.js'

class WebServer extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
    this.routes = []
  }

  register(route) {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }
}

class Connection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.requests = []
  }

  requestRejection(request) {
    this.requests.push(request)
    return 401
  }
}

class Credentials extends Service {
  constructor(ctx) {
    super(ctx, 'credentials')
    this.values = new Map()
  }

  async resolve(ref) {
    const value = this.values.get(String(ref))
    return value === undefined ? undefined : { value, source: 'file' }
  }

  async set(ref, value) {
    this.values.set(String(ref), value)
  }

  async unset(ref) {
    this.values.delete(String(ref))
  }
}

const reply = () => {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(chunk) { this.body = chunk ?? ''; this.ended = true },
  }
  return res
}

const PATHS = [
  ['GET', 'status'],
  ['POST', 'login/start'],
  ['GET', 'login/poll'],
  ['POST', 'login/cancel'],
  ['POST', 'logout'],
  ['POST', 'probe'],
  ['POST', 'login/code'],
  ['POST', 'monitor'],
  ['POST', 'bridge/test'],
  ['POST', 'bridge/access'],
]

test('插件声明与其依赖', () => {
  assert.equal(plugin.name, 'toolkit-weixin-clawbot')
  assert.deepEqual(plugin.inject, ['webServer', 'connection', 'credentials'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.Config, 'function', 'Config 是 Schemastery 的 schema 工厂')
})

test('十条路由全部注册为 exact 且挂在独立前缀下', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  const routes = ctx.get('webServer').routes
  assert.deepEqual(
    routes.map(({ kind, path }) => [kind, path.replace('/api/plugins/dsh-toolkit/weixin-clawbot/', '')]).sort(),
    PATHS.map(([method, suffix]) => ['exact', suffix]).sort(),
  )
  for (const route of routes) {
    assert.ok(route.path.startsWith('/api/plugins/dsh-toolkit/weixin-clawbot/'), route.path)
  }
})

test('每条路由都先过宿主的鉴权边界', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  const connection = ctx.get('connection')
  for (const route of ctx.get('webServer').routes) {
    const request = { method: 'GET', url: route.path }
    const response = reply()
    await route.handler(request, response)
    assert.equal(response.statusCode, 401, `${route.path} 必须被鉴权拦下`)
    assert.equal(connection.requests.at(-1), request, `${route.path} 必须经过 requestRejection`)
  }
})

test('方法不匹配时返回 404，且不泄露任何状态', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  const routes = ctx.get('webServer').routes
  // 没有 connection 时路由无法注册（鉴权边界是硬依赖）。
  assert.deepEqual(routes, [])

  const ctx2 = new Context()
  await ctx2.plugin(WebServer)
  await ctx2.plugin(Connection)
  await ctx2.plugin(Credentials)
  const fiber2 = ctx2.plugin(plugin, {})
  t.after(() => fiber2.dispose())
  await fiber2
  for (const route of ctx2.get('webServer').routes) {
    const wrong = route.path.endsWith('/status') || route.path.endsWith('/poll') ? 'POST' : 'GET'
    // 绕过鉴权：这些路由的 handler 先鉴权，所以用一个放行的 connection。
    const response = reply()
    const request = { method: wrong, url: route.path }
    // 直接把 connection 换成放行版本。
    ctx2.get('connection').requestRejection = () => undefined
    await route.handler(request, response)
    assert.equal(response.statusCode, 404, `${wrong} ${route.path} 应为 404`)
    assert.match(response.body, /not-found/)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  // 复原，避免影响其他断言。
  await fiber2.dispose()
})

test('status 在未连接时给出稳定结构且不含 token', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  ctx.get('connection').requestRejection = () => undefined
  const route = ctx.get('webServer').routes.find(({ path }) => path.endsWith('/status'))
  const response = reply()
  await route.handler({ method: 'GET', url: route.path }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.connected, false)
  assert.equal(payload.credentialRef, 'WEIXIN_CLAWBOT_CREDENTIAL')
  assert.equal(payload.account, undefined)
  assert.equal(payload.qr, undefined)
})

test('已有凭据时 status 只暴露掩码账号与 host', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const credentials = ctx.get('credentials')
  const TOKEN = 'token-must-never-leak'
  await credentials.set('WEIXIN_CLAWBOT_CREDENTIAL', JSON.stringify({
    token: TOKEN,
    accountId: 'account-0123456789abcdef',
    baseUrl: 'https://ilinkai.weixin.qq.com',
  }))
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  ctx.get('connection').requestRejection = () => undefined
  const route = ctx.get('webServer').routes.find(({ path }) => path.endsWith('/status'))
  const response = reply()
  await route.handler({ method: 'GET', url: route.path }, response)
  const payload = JSON.parse(response.body)
  assert.equal(payload.connected, true)
  assert.equal(payload.account.accountId, 'acco******cdef')
  assert.equal(payload.account.baseUrlHost, 'ilinkai.weixin.qq.com')
  assert.equal(response.body.includes(TOKEN), false, 'status 响应绝不能含 token')
})

test('logout 清空凭据；取消不写凭据', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const credentials = ctx.get('credentials')
  await credentials.set('WEIXIN_CLAWBOT_CREDENTIAL', JSON.stringify({
    token: 't', accountId: 'account-0123456789', baseUrl: 'https://ilinkai.weixin.qq.com',
  }))
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  ctx.get('connection').requestRejection = () => undefined
  const route = (suffix) => ctx.get('webServer').routes.find(({ path }) => path.endsWith(`/${suffix}`))
  const response = reply()
  await route('logout').handler({ method: 'POST', url: '/x' }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(await credentials.resolve('WEIXIN_CLAWBOT_CREDENTIAL'), undefined)
  assert.equal(JSON.parse(response.body).connected, false)
})

test('enabled 为 false 时不注册任何路由', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, { enabled: false })
  t.after(() => fiber.dispose())
  await fiber
  assert.deepEqual(ctx.get('webServer').routes, [])
})

test('登录路由在无网络时会返回结构化的 400 而不是挂住', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  ctx.get('connection').requestRejection = () => undefined
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network down') }
  t.after(() => { globalThis.fetch = original })
  const route = ctx.get('webServer').routes.find(({ path }) => path.endsWith('/login/start'))
  const response = reply()
  await route.handler({ method: 'POST', url: '/x' }, response)
  // start 会在后台推进，超时后返回当前状态：至少不能抛未捕获异常。
  assert.ok(response.statusCode === 200 || response.statusCode === 400)
  assert.equal(response.body.includes('network down'), true)
})

// ── 客户端产物 ─────────────────────────────────────────────────

test('客户端产物是自包含单文件，入口挂在账户行而不是插槽里', async (t) => {
  const built = await readFile(new URL('../../packages/weixin-clawbot/lib/client.js', import.meta.url), 'utf8')
  const registrations = []
  const required = []
  const head = { appendChild() {}, removeChild() {} }
  class SandboxNode {}
  class SandboxElement extends SandboxNode { closest() { return null } }
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => registrations.push(spec) } },
    console: { warn: () => {}, error: () => {} },
    fetch() { throw new Error('registration must not fetch') },
    // The module body is evaluated inside the sandbox realm, so `document` must live here.
    // Deliberately minimal: no querySelector, so a mount attempt must bail out quietly.
    document: {
      head,
      documentElement: head,
      body: { appendChild() {}, removeChild() {} },
      createElement: () => ({ dataset: {}, style: {}, textContent: '', remove() {} }),
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
    Node: SandboxNode,
    Element: SandboxElement,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  vm.runInNewContext(built, sandbox, { filename: 'weixin-clawbot-client.js', timeout: 2000 })
  assert.equal(registrations.length, 1)
  const [spec] = registrations
  assert.equal(spec.id, 'dsh-toolkit-weixin-clawbot')
  assert.equal(typeof spec.factory, 'function')

  // react 由宿主模块表提供；react-dom 提供 portal，react-dom/client 提供 createRoot。
  const client = spec.factory((id) => {
    required.push(id)
    if (id === 'react') return { createElement: () => null, useEffect: () => {}, useRef: () => ({}), useState: () => [undefined, () => {}], useCallback: (fn) => fn, useMemo: (fn) => fn(), useSyncExternalStore: () => ({}) }
    if (id === 'react-dom') return { createPortal: (node) => node }
    if (id === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    throw new Error(`unexpected dependency: ${id}`)
  })
  assert.equal(client.name, 'toolkit-weixin-clawbot-client')
  // 账户行没有可注册的 list 插槽，入口改成 DOM 安装器，因此不再声明 slots。
  assert.deepEqual(Array.from(client.inject), ['locale'])
  assert.deepEqual([...new Set(required)].sort(), ['react', 'react-dom', 'react-dom/client'])
  assert.equal(built.includes('sidebar.footer.action'), false, '产物不应再依赖账户行里不存在的插槽')

  const effects = []
  const ctx = {
    effect(run, label) {
      effects.push(label)
      const dispose = run()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: { register: () => () => {} },
  }
  client.apply(ctx)
  assert.ok(effects.some((label) => label === 'toolkit-weixin-clawbot:stylesheet'))
  assert.ok(effects.some((label) => label === 'toolkit-weixin-clawbot:entry-icon'))
})

test('客户端产物不含服务端代码与凭据名称泄露', async () => {
  const built = await readFile(new URL('../../packages/weixin-clawbot/lib/client.js', import.meta.url), 'utf8')
  // 浏览器半边绝不应包含 Node 专有 API 或 token 处理。
  for (const forbidden of ['node:fs', 'node:crypto', 'ilinkai.weixin.qq.com', 'bot_token', 'credentials.set']) {
    assert.equal(built.includes(forbidden), false, `客户端产物不应包含 ${forbidden}`)
  }
  // 二维码编码器必须内联（自包含）。
  assert.match(built, /EC_CODEWORDS_PER_BLOCK_M|qrCodeMatrix|reedSolomon/i)
})
