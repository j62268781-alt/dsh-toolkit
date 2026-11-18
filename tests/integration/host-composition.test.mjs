import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import toolkit, { Config } from '../../lib/index.js'

// Resolve the exact Cosmokit instance used by the installed schema runtime.
// The resolved specifier is a native path, so it must be a file URL before import.
const schemaRequire = createRequire(import.meta.resolve('@deepseek-ai/schemastery'))
const { isVolatile, updateVolatile } = await import(pathToFileURL(schemaRequire.resolve('@deepseek-ai/cosmokit')).href)

class Tools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    this.registered = []
  }

  register(definition) {
    this.registered.push(definition)
    return this.ctx.effect(() => () => {
      const index = this.registered.indexOf(definition)
      if (index >= 0) this.registered.splice(index, 1)
    })
  }
}

class Credentials extends Service {
  constructor(ctx) {
    super(ctx, 'credentials')
    this.described = []
  }

  async describe(ref) {
    this.described.push(String(ref))
    return { configured: true }
  }
}

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

async function settle(ctx) {
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) await fiber.await()
  }
}

async function boot(t, config = {}, { tools = true, credentials = true } = {}) {
  const ctx = new Context()
  if (tools) await ctx.plugin(Tools)
  if (credentials) await ctx.plugin(Credentials)
  const fiber = ctx.plugin(toolkit, { mobile: { enabled: false }, ...config })
  t.after(() => fiber.dispose())
  await fiber
  await settle(ctx)
  return { ctx, fiber }
}

const judgmentConfig = {
  connections: {
    main: { credentialRef: 'JUDGMENT_API_KEY_1' },
  },
  purposes: { 'phone.action': { connection: 'main' } },
  ledger: { enabled: false },
}

test('root schema preserves module defaults and existing volatile boundaries', () => {
  const config = Config({ mobile: { enabled: false, routePrefix: '/custom-mobile' } })
  assert.deepEqual(Object.keys(config).sort(), ['archived', 'boot', 'git', 'hooks', 'judgement', 'mobile', 'monitor', 'notification', 'pet', 'remote', 'shell', 'skillsMcp', 'theme'])
  // 浏览器模块已整体删除：根配置不应再冒出 browser 键（防止注册点被误加回来）。
  assert.equal(Object.hasOwn(config, 'browser'), false)
  assert.equal(isVolatile(config.judgement.connections), true)
  assert.deepEqual(config.judgement.connections.get(), {})
  assert.equal(isVolatile(config.skillsMcp.toolFilters), true)
  assert.equal(isVolatile(config.mobile), false)
  assert.equal(config.mobile.enabled, false)
  assert.equal(config.mobile.routePrefix, '/custom-mobile')
  assert.equal(isVolatile(config.boot), false)
  for (const field of ['animation', 'theme', 'showWordmark', 'allowSkip']) {
    assert.equal(isVolatile(config.boot[field]), true, `boot.${field} must stay volatile`)
  }
  assert.equal(config.boot.animation.get(), 'draw')
  assert.equal(Object.hasOwn(config.boot, 'durationMs'), false)
  assert.equal(config.boot.theme.get(), 'auto')
  assert.equal(config.boot.showWordmark.get(), true)
  assert.equal(config.boot.allowSkip.get(), true)
  assert.equal(isVolatile(config.theme), false)
  assert.equal(isVolatile(config.theme.palette), true)
  assert.equal(config.theme.palette.get(), 'native')
  // Every writable notification leaf stays volatile, including the global sound.
  // Its host child serves the authenticated system sound catalogue.
  assert.equal(isVolatile(config.notification), false)
  for (const field of [
    'enabled', 'soundEnabled', 'volume', 'currentMode', 'sound', 'scope',
    'completedEnabled', 'completedSound', 'failedEnabled', 'failedSound',
    'questionEnabled', 'questionSound', 'permissionEnabled', 'permissionSound',
  ]) {
    assert.equal(isVolatile(config.notification[field]), true, `notification.${field} must stay volatile`)
  }
  assert.equal(config.notification.enabled.get(), true)
  assert.equal(config.notification.soundEnabled.get(), true)
  assert.equal(config.notification.volume.get(), 1)
  assert.equal(config.notification.currentMode.get(), 'unfocused')
  assert.equal(config.notification.sound.get(), 'system')
  assert.equal(config.notification.scope.get(), 'main-wait')
  assert.equal(config.notification.completedSound.get(), 'chime')
  assert.equal(config.notification.failedSound.get(), 'fault')
  assert.equal(config.notification.questionSound.get(), 'pop')
  assert.equal(config.notification.permissionSound.get(), 'alert')
})

test('root mounts judgment without revalidating refs and runs Service.init', async (t) => {
  const { ctx, fiber } = await boot(t, { judgement: judgmentConfig })
  const judgment = ctx.get('judgment')
  assert.ok(judgment)
  assert.equal(ctx.get('browser'), undefined)
  assert.equal(judgment.config, fiber.config.judgement)
  assert.equal(judgment.status().connections[0].credentialPresent, true)
  assert.deepEqual(ctx.get('credentials').described, ['JUDGMENT_API_KEY_1'])
  assert.equal(judgment.typertRemote.serviceKey, 'judgment')
  assert.deepEqual(remoteMethods(judgment).map(({ method }) => method).sort(), ['health', 'status'])
})

test('volatile writes reach the existing judgment instance without re-registering tools', async (t) => {
  const { ctx, fiber } = await boot(t, { judgement: judgmentConfig })
  const judgment = ctx.get('judgment')
  const connections = fiber.config.judgement.connections
  assert.equal(ctx.get('tools').registered.length, 0)
  updateVolatile(connections, Config({ judgement: { connections: { other: { credentialRef: 'K' } } } }).judgement.connections)
  ctx.emit('loader/volatile-update')
  // Context reads create traceable Service proxies; compare their binding,
  // which is owned by the live instance, instead of comparing those proxies.
  assert.equal(ctx.get('judgment').typertRemote, judgment.typertRemote)
  assert.equal(fiber.config.judgement.connections, connections)
  // 没有任何模块在 volatile 更新时注册工具（原先只有浏览器模块这么做，它已删除）。
  assert.equal(ctx.get('tools').registered.length, 0)
})

test('missing module dependencies do not block independent services', async (t) => {
  const withoutTools = await boot(t, { judgement: judgmentConfig }, { tools: false })
  assert.equal(withoutTools.ctx.get('tools'), undefined)
  assert.equal(withoutTools.ctx.get('judgment').status().connections[0].credentialPresent, true)

  const withoutCredentials = await boot(t, { judgement: judgmentConfig }, { credentials: false })
  assert.equal(withoutCredentials.ctx.get('judgment'), undefined)
  // No sessions or loader services are installed in either boot: their children
  // stay pending while the independent judgment child is active.
  assert.equal(withoutCredentials.fiber.state, 2)
})

test('boot injects its assets without sessions and unregisters with the root', async (t) => {
  const { ctx, fiber } = await boot(t)
  assert.equal(ctx.get('sessions'), undefined)
  const table = []
  await ctx.emit('webserver/index-inject', table)
  assert.deepEqual(table.map(({ kind }) => kind), ['style', 'html', 'script'])
  assert.match(table[1].html, /sk-boot/)
  assert.match(table[1].html, /data-sk-animation="draw"/)
  assert.match(table[1].html, /data-sk-duration="2500"/)
  assert.match(table[0].text, /\.sk-boot--starmark/)
  assert.match(table[2].text, /MIN_SHOW\s*=\s*1700/)
  assert.equal(table.some(({ text }) => text?.includes('window.__SK_HOST =')), false)
  await fiber.dispose()
  const after = []
  await ctx.emit('webserver/index-inject', after)
  assert.deepEqual(after, [])
})

test('notification child waits for both webServer and connection, mounts authenticated routes, and disposes with root', async (t) => {
  const ctx = new Context()
  await ctx.plugin(WebServer)
  const fiber = ctx.plugin(toolkit, { mobile: { enabled: false } })
  t.after(() => fiber.dispose())
  await fiber
  await settle(ctx)
  const server = ctx.get('webServer')
  const soundRoutes = () => server.routes.filter(({ path }) => path.startsWith('/api/plugins/toolkit/notification/'))
  assert.deepEqual(soundRoutes(), [], 'webServer alone cannot activate the authenticated notification child')
  await ctx.plugin(Connection)
  await settle(ctx)
  assert.deepEqual(soundRoutes().map(({ kind, path }) => [kind, path]), [
    ['exact', '/api/plugins/toolkit/notification/sounds'],
    ['exact', '/api/plugins/toolkit/notification/sound'],
    ['exact', '/api/plugins/toolkit/notification/raise'],
    // SW 脚本是唯一不带鉴权的通知路由：浏览器注册 worker 时自己发请求，带不上页面 token。
    ['exact', '/api/plugins/toolkit/notification/sw.js'],
  ])
  // SW 脚本是唯一例外：注册 worker 时浏览器自己发脚本请求，带不上页面 token，
  // 所以它必须在不鉴权的情况下也能取到（见 sw 路由的单独断言）。
  const serviceWorkerRoute = soundRoutes().find(({ path }) => path.endsWith('/sw.js'))
  for (const route of soundRoutes().filter((entry) => entry !== serviceWorkerRoute)) {
    // 提窗路由只认 POST，GET 会被预取/缓存命中，等于用户没点也提窗。
    const request = { method: route.path.endsWith('/raise') ? 'POST' : 'GET', url: route.path }
    const response = { statusCode: 0, ended: false, end() { this.ended = true } }
    await route.handler(request, response)
    assert.equal(response.statusCode, 401)
    assert.equal(response.ended, true)
    assert.equal(ctx.get('connection').requests.at(-1), request, 'routes use the injected host authentication boundary')
  }
  const swResponse = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = value },
  }
  await serviceWorkerRoute.handler({ method: 'GET', url: serviceWorkerRoute.path }, swResponse)
  assert.equal(swResponse.statusCode, 200)
  assert.equal(swResponse.headers['service-worker-allowed'], '/')
  assert.equal(String(swResponse.body).includes('notificationclick'), true)
  await fiber.dispose()
  assert.deepEqual(soundRoutes(), [])
})

test('disposing the root removes child services and their effects', async (t) => {
  const { ctx, fiber } = await boot(t)
  const tools = ctx.get('tools')
  // 默认组合下没有任何模块注册工具（浏览器模块已删除；git 需要自己的注入面）。
  assert.equal(tools.registered.length, 0)
  await fiber.dispose()
  assert.equal(ctx.get('browser'), undefined)
  assert.equal(ctx.get('judgment'), undefined)
  assert.equal(tools.registered.length, 0)
})
