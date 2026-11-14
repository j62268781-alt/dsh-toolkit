/**
 * 路由与装配测试：鉴权边界、方法约束、错误收敛，以及客户端插槽注册。
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from '../../src/modules/remote/host/index.ts'

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
  ['GET', 'peers'],
  ['POST', 'local-state/purge'],
]

test('插件声明与其依赖', () => {
  assert.equal(plugin.name, 'dsh-toolkit-remote')
  assert.deepEqual(plugin.inject, ['webServer', 'connection', 'credentials'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.Config, 'function', 'Config 是 Schemastery 的 schema 工厂')
})

test('对外状态：凭据还在但监听断了就报 reconnecting，不能继续冒充已连接', () => {
  const live = { running: true, connected: true, phase: 'live' }
  // 正常在线：confirmed / connected 沿用登录态说法
  assert.equal(plugin.deriveConnectionState({ connected: true, loginState: { state: 'confirmed' }, monitorState: live }), 'confirmed')
  assert.equal(plugin.deriveConnectionState({ connected: true, loginState: { state: 'connected' }, monitorState: live }), 'connected')

  // 被顶号：凭据在、登录态还是 confirmed，但监听已经 -14 断开
  for (const phase of ['stale', 'invalid', 'error']) {
    assert.equal(
      plugin.deriveConnectionState({ connected: true, loginState: { state: 'confirmed' }, monitorState: { running: true, connected: false, phase } }),
      'reconnecting',
      `${phase} 阶段应报 reconnecting`,
    )
  }

  // 监听没开（用户关掉或在扫码阶段）不算降级，否则未监听会被误画成掉线
  assert.equal(plugin.deriveConnectionState({ connected: true, loginState: { state: 'connected' }, monitorState: { running: false, connected: false, phase: 'idle' } }), 'connected')
  assert.equal(plugin.deriveConnectionState({ connected: true, loginState: { state: 'confirmed' }, monitorState: { running: true, connected: false, phase: 'idle' } }), 'confirmed')

  // 没凭据时照实返回登录状态（扫码中等），不要冒出 connected
  assert.equal(plugin.deriveConnectionState({ connected: false, loginState: { state: 'waiting_qr' }, monitorState: { running: false, connected: false, phase: 'idle' } }), 'waiting_qr')
  assert.equal(plugin.deriveConnectionState({ connected: false, loginState: { state: 'expired' }, monitorState: { running: true, connected: false, phase: 'error' } }), 'expired')
})

test('十二条路由全部注册为 exact 且挂在独立前缀下', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  const routes = ctx.get('webServer').routes
  assert.deepEqual(
    routes.map(({ kind, path }) => [kind, path.replace('/api/plugins/toolkit/remote/', '')]).sort(),
    PATHS.map(([method, suffix]) => ['exact', suffix]).sort(),
  )
  for (const route of routes) {
    assert.ok(route.path.startsWith('/api/plugins/toolkit/remote/'), route.path)
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
  const expected = new Map(PATHS.map(([method, suffix]) => [`/api/plugins/toolkit/remote/${suffix}`, method]))
  for (const route of ctx2.get('webServer').routes) {
    const wrong = expected.get(route.path) === 'GET' ? 'POST' : 'GET'
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

test('peers：读本机 trusted-peers.json，按最近信任排序；缺参数返回 400', async (t) => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dsh-routes-peers-'))
  const SERVER_URL = 'https://dsh.r2049.cn'
  const file = join(homeDir, 'ds-harness-remote', 'servers', 'e9988d504cda7c1541adafcc', 'host', 'trusted-peers.json')
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify({
    peers: [
      { deviceId: 'phone-old', name: 'Old', fingerprint: 'AAAA', trustedAt: 1 },
      { deviceId: 'phone-new', name: 'DSH App (Android)', fingerprint: '7F2C 4CE8 0A33', trustedAt: 2, publicKey: 'secret' },
    ],
  }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeDir
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  ctx.get('connection').requestRejection = () => undefined
  const route = ctx.get('webServer').routes.find(({ path }) => path.endsWith('/peers'))

  const response = reply()
  await route.handler({ method: 'GET', url: `/api/plugins/toolkit/remote/peers?serverUrl=${encodeURIComponent(SERVER_URL)}` }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.peers.map((peer) => peer.deviceId), ['phone-new', 'phone-old'], '最近配对成功的排前面')
  assert.equal(payload.peers[0].fingerprint, '7F2C 4CE8 0A33')
  assert.equal(response.body.includes('secret'), false, '公钥不该出现在响应里')

  const missing = reply()
  await route.handler({ method: 'GET', url: '/api/plugins/toolkit/remote/peers' }, missing)
  assert.equal(missing.statusCode, 400)
  assert.match(missing.body, /serverUrl/)
})

test('local-state/purge：解绑后删掉 hostOnly 策略与旧 client 目录；缺参数 400', async (t) => {
  const homeDir = await mkdtemp(join(tmpdir(), 'dsh-routes-purge-'))
  const SERVER_URL = 'https://dsh.r2049.cn'
  const dir = join(homeDir, 'ds-harness-remote', 'servers', 'e9988d504cda7c1541adafcc')
  await mkdir(join(dir, 'host'), { recursive: true })
  await mkdir(join(dir, 'client'), { recursive: true })
  await writeFile(join(dir, 'host', 'pairing-host-only.json'), '{"hostOnly":true}')
  await writeFile(join(dir, 'host', 'device.json'), '{"deviceId":"host-1"}')
  await writeFile(join(dir, 'client', 'device.json'), '{"deviceId":"client-1"}')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = homeDir
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, {})
  t.after(() => fiber.dispose())
  await fiber
  ctx.get('connection').requestRejection = () => undefined
  const route = ctx.get('webServer').routes.find(({ path }) => path.endsWith('/local-state/purge'))

  const response = reply()
  await route.handler({ method: 'POST', url: `/api/plugins/toolkit/remote/local-state/purge?serverUrl=${encodeURIComponent(SERVER_URL)}` }, response)
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.hostOnly, true)
  assert.deepEqual(payload.removed.sort(), ['client', 'host/pairing-host-only.json'])
  await assert.rejects(readFile(join(dir, 'host', 'pairing-host-only.json'), 'utf8'), (error) => error?.code === 'ENOENT')
  // host 身份留着：运行中的 host 运行时还持有它。
  assert.equal(await readFile(join(dir, 'host', 'device.json'), 'utf8'), '{"deviceId":"host-1"}')

  const missing = reply()
  await route.handler({ method: 'POST', url: '/api/plugins/toolkit/remote/local-state/purge' }, missing)
  assert.equal(missing.statusCode, 400)
  assert.match(missing.body, /serverUrl/)
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

test('enabled 为 false 时只留配对相关的兜底路由，不注册任何 ClawBot 路由', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(Credentials)
  const fiber = ctx.plugin(plugin, { enabled: false })
  t.after(() => fiber.dispose())
  await fiber
  // peers 与 local-state/purge 都属于「手机连接」，不是微信登录：关掉 ClawBot 也要留着。
  // 没有 purge，解绑后就清不掉上游没管的 pairing-host-only 策略。
  assert.deepEqual(
    ctx.get('webServer').routes.map(({ kind, path }) => [kind, path]).sort(),
    [
      ['exact', '/api/plugins/toolkit/remote/local-state/purge'],
      ['exact', '/api/plugins/toolkit/remote/peers'],
    ],
  )
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
  const built = await readFile(new URL('../../packages/remote/lib/client.js', import.meta.url), 'utf8')
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
  vm.runInNewContext(built, sandbox, { filename: 'remote-client.js', timeout: 2000 })
  assert.equal(registrations.length, 1)
  const [spec] = registrations
  assert.equal(spec.id, 'dsh-toolkit-remote')
  assert.equal(typeof spec.factory, 'function')

  // react 由宿主模块表提供；react-dom 提供 portal，react-dom/client 提供 createRoot。
  const client = spec.factory((id) => {
    required.push(id)
    if (id === 'react') return { createElement: () => null, useEffect: () => {}, useRef: () => ({}), useState: () => [undefined, () => {}], useCallback: (fn) => fn, useMemo: (fn) => fn(), useSyncExternalStore: () => ({}) }
    if (id === 'react-dom') return { createPortal: (node) => node }
    if (id === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    throw new Error(`unexpected dependency: ${id}`)
  })
  assert.equal(client.name, 'dsh-toolkit-remote-client')
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
  assert.ok(effects.some((label) => label === 'dsh-toolkit-remote:stylesheet'))
  assert.ok(effects.some((label) => label === 'dsh-toolkit-remote:entry-icon'))
})

test('客户端产物不含服务端代码与凭据名称泄露', async () => {
  const built = await readFile(new URL('../../packages/remote/lib/client.js', import.meta.url), 'utf8')
  // 浏览器半边绝不应包含 Node 专有 API 或 token 处理。
  for (const forbidden of ['node:fs', 'node:crypto', 'ilinkai.weixin.qq.com', 'bot_token', 'credentials.set']) {
    assert.equal(built.includes(forbidden), false, `客户端产物不应包含 ${forbidden}`)
  }
  // 二维码编码器必须内联（自包含）。
  assert.match(built, /EC_CODEWORDS_PER_BLOCK_M|qrCodeMatrix|reedSolomon/i)
})
