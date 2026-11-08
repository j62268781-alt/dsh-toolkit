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
  purposes: { 'browser.action': { connection: 'main' } },
  ledger: { enabled: false },
}

test('root schema preserves module defaults and existing volatile boundaries', () => {
  const config = Config({ mobile: { enabled: false, routePrefix: '/custom-mobile' } })
  assert.deepEqual(Object.keys(config).sort(), ['archived', 'boot', 'browser', 'judgement', 'mobile', 'notification', 'pet', 'shell', 'skillsMcp', 'theme', 'weixinClawbot'])
  assert.equal(isVolatile(config.browser), false)
  assert.equal(isVolatile(config.browser.enabled), true)
  assert.equal(config.browser.enabled.get(), true)
  assert.equal(config.browser.limits.get().commandTimeoutMs, 30_000)
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

test('root mounts both services without revalidating refs and runs Service.init', async (t) => {
  const { ctx, fiber } = await boot(t, {
    browser: { enabled: false },
    judgement: judgmentConfig,
  })
  const browser = ctx.get('browser')
  const judgment = ctx.get('judgment')
  assert.ok(browser)
  assert.ok(judgment)
  assert.equal(browser.config, fiber.config.browser)
  assert.equal(judgment.config, fiber.config.judgement)
  assert.equal(judgment.status().connections[0].credentialPresent, true)
  assert.deepEqual(ctx.get('credentials').described, ['JUDGMENT_API_KEY_1'])
  assert.equal(judgment.typertRemote.serviceKey, 'judgment')
  assert.equal(browser.typertRemote.serviceKey, 'browser')
  assert.deepEqual(remoteMethods(judgment).map(({ method }) => method).sort(), ['health', 'status'])
  assert.deepEqual(remoteMethods(browser).map(({ method }) => method).sort(), ['checkJudgment', 'installCli', 'probe'])
})

test('volatile writes reach the existing browser instance and update registered tools', async (t) => {
  const { ctx, fiber } = await boot(t, { browser: { enabled: false } })
  const browser = ctx.get('browser')
  const enabled = fiber.config.browser.enabled
  assert.equal(ctx.get('tools').registered.length, 0)
  updateVolatile(enabled, Config({ browser: { enabled: true } }).browser.enabled)
  ctx.emit('loader/volatile-update')
  // Context reads create traceable Service proxies; compare their binding,
  // which is owned by the live instance, instead of comparing those proxies.
  assert.equal(ctx.get('browser').typertRemote, browser.typertRemote)
  assert.equal(fiber.config.browser.enabled, enabled)
  assert.equal(ctx.get('tools').registered.length, 5)
  updateVolatile(enabled, Config({ browser: { enabled: false } }).browser.enabled)
  ctx.emit('loader/volatile-update')
  assert.equal(ctx.get('tools').registered.length, 0)
})

test('missing module dependencies do not block independent services', async (t) => {
  const withoutTools = await boot(t, {
    browser: { enabled: false },
    judgement: judgmentConfig,
  }, { tools: false })
  assert.equal(withoutTools.ctx.get('browser'), undefined)
  assert.equal(withoutTools.ctx.get('judgment').status().connections[0].credentialPresent, true)

  const withoutCredentials = await boot(t, { browser: { enabled: false } }, { credentials: false })
  assert.equal(withoutCredentials.ctx.get('judgment'), undefined)
  assert.ok(withoutCredentials.ctx.get('browser'))
  // No sessions or loader services are installed in either boot: their children
  // stay pending while the independent browser/judgment children are active.
  assert.equal(withoutCredentials.fiber.state, 2)
})

test('boot injects its assets without sessions and unregisters with the root', async (t) => {
  const { ctx, fiber } = await boot(t, { browser: { enabled: false } })
  assert.equal(ctx.get('sessions'), undefined)
  const table = []
  await ctx.emit('webserver/index-inject', table)
  assert.deepEqual(table.map(({ kind }) => kind), ['style', 'html', 'script'])
  assert.match(table[1].html, /sk-boot/)
  assert.match(table[1].html, /data-sk-animation="draw"/)
  assert.match(table[1].html, /data-sk-duration="2400"/)
  assert.match(table[0].text, /data-sk-animation="abyss"/)
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
  const fiber = ctx.plugin(toolkit, { mobile: { enabled: false }, browser: { enabled: false } })
  t.after(() => fiber.dispose())
  await fiber
  await settle(ctx)
  const server = ctx.get('webServer')
  const soundRoutes = () => server.routes.filter(({ path }) => path.startsWith('/api/plugins/dsh-toolkit/notification/'))
  assert.deepEqual(soundRoutes(), [], 'webServer alone cannot activate the authenticated notification child')
  await ctx.plugin(Connection)
  await settle(ctx)
  assert.deepEqual(soundRoutes().map(({ kind, path }) => [kind, path]), [
    ['exact', '/api/plugins/dsh-toolkit/notification/sounds'],
    ['exact', '/api/plugins/dsh-toolkit/notification/sound'],
    ['exact', '/api/plugins/dsh-toolkit/notification/raise'],
  ])
  for (const route of soundRoutes()) {
    // 提窗路由只认 POST，GET 会被预取/缓存命中，等于用户没点也提窗。
    const request = { method: route.path.endsWith('/raise') ? 'POST' : 'GET', url: route.path }
    const response = { statusCode: 0, ended: false, end() { this.ended = true } }
    await route.handler(request, response)
    assert.equal(response.statusCode, 401)
    assert.equal(response.ended, true)
    assert.equal(ctx.get('connection').requests.at(-1), request, 'routes use the injected host authentication boundary')
  }
  await fiber.dispose()
  assert.deepEqual(soundRoutes(), [])
})

test('disposing the root removes child services and their effects', async (t) => {
  const { ctx, fiber } = await boot(t)
  const tools = ctx.get('tools')
  assert.equal(tools.registered.length, 5)
  await fiber.dispose()
  assert.equal(ctx.get('browser'), undefined)
  assert.equal(ctx.get('judgment'), undefined)
  assert.equal(tools.registered.length, 0)
})
