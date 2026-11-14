import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { dshHome } from '../../src/host/dsh-home.ts'
import { readBody, sendJson } from '../../src/host/http.ts'
import { sleep } from '../../src/host/time.ts'
import { findOnPath } from '../../src/modules/mobile/host/device/path.ts'
import { findExecutableOnPath, findCommandOnPath, isWindowsShim, resolveSpawnTarget, windowsExecutableExtensions } from '../../src/host/executable.ts'
import { registerImportRoute } from '../../src/modules/skills-mcp/host/import/route.ts'
import { registerSkillRoute } from '../../src/modules/skills-mcp/host/skills/route.ts'
import { registerRowRoute } from '../../src/modules/skills-mcp/host/mcp/rows.ts'
import { registerReconnectRoute } from '../../src/modules/skills-mcp/host/mcp/reconnect.ts'
import { registerOAuthRoute } from '../../src/modules/skills-mcp/host/mcp/oauth/route.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

function response() {
  const headers = {}
  let body = ''
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) { headers[name] = value },
    end(value = '') { body = value },
    json() { return JSON.parse(body) },
  }
}

async function request(route, body = '', { method = 'POST', url = route.path } = {}) {
  const req = new PassThrough()
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json' }
  const res = response()
  const pending = route.handler(req, res)
  req.end(body)
  await pending
  return { req, res }
}

test('shared body reader counts bytes across UTF-8 chunk boundaries and accepts the exact limit', async () => {
  const text = 'A中文🙂Z'
  const bytes = Buffer.from(text)
  const req = new PassThrough()
  const pending = readBody(req, bytes.length)
  req.write(bytes.subarray(0, 3))
  req.write(bytes.subarray(3, 8))
  req.end(bytes.subarray(8))
  assert.equal(await pending, text)

  const empty = new PassThrough()
  const result = readBody(empty, 0)
  empty.end()
  assert.equal(await result, '')
})

test('shared body reader rejects oversize and stream errors without truncating a receipt', async () => {
  const req = new PassThrough()
  const rejected = assert.rejects(readBody(req, 3), { message: 'body too large' })
  req.write(Buffer.from('123'))
  req.end(Buffer.from('4'))
  await rejected
  assert.equal(req.destroyed, true)

  const broken = new PassThrough()
  const error = new Error('request disconnected')
  const failed = assert.rejects(readBody(broken, 10), (caught) => caught === error)
  broken.destroy(error)
  await failed

  const res = response()
  sendJson(res, 409, { ok: false, reason: '中文🙂' })
  assert.equal(res.statusCode, 409)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(res.json(), { ok: false, reason: '中文🙂' })
})

const commandRoutes = [
  ['import', 16 * 1024, registerImportRoute],
  ['skills', 256 * 1024, registerSkillRoute],
  ['rows', 32 * 1024, registerRowRoute],
  ['reconnect', 8 * 1024, registerReconnectRoute],
  ['oauth', 8 * 1024, registerOAuthRoute],
]

for (const [name, maxBytes, register] of commandRoutes) {
  test(`${name} route preserves its byte limit and JSON receipt after sharing HTTP helpers`, async (t) => {
    let route
    let schemaCalls = 0
    let commandCalls = 0
    const cleanups = []
    const ctx = {
      effect(fn) { cleanups.push(fn()) },
      webServer: { register(value) { route = value; return () => {} } },
      connection: { requestRejection: () => undefined },
      logger: { warn() {} },
    }
    const run = () => { commandCalls += 1; return { ok: true } }
    register(ctx, {
      schema(value) { schemaCalls += 1; return value },
      scan: run, run, apply: run,
    })
    t.after(() => cleanups.reverse().forEach((dispose) => dispose?.()))

    const prefix = '{"text":"中文🙂'
    const suffix = '"}'
    const exact = prefix + 'x'.repeat(maxBytes - Buffer.byteLength(prefix + suffix)) + suffix
    assert.equal(Buffer.byteLength(exact), maxBytes)
    const accepted = await request(route, exact)
    assert.equal(accepted.res.statusCode, 200)
    assert.deepEqual(accepted.res.json(), { ok: true })
    assert.equal(accepted.res.headers['cache-control'], 'no-store')
    assert.equal(accepted.res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(schemaCalls, 1)
    assert.equal(commandCalls, 1)

    const rejected = await request(route, `${exact} `)
    assert.equal(rejected.res.statusCode, 400)
    assert.deepEqual(rejected.res.json(), { ok: false, reason: 'body too large' })
    assert.equal(rejected.req.destroyed, true)
    assert.equal(schemaCalls, 1, 'an oversized request must not reach validation')
    assert.equal(commandCalls, 1, 'an oversized request must not reach the command')
  })
}

test('mobile PATH helper keeps native executable ordering, empty entries and Windows shim rules', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-host-path-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const first = join(dir, 'first')
  const second = join(dir, 'second')
  await Promise.all([mkdir(first), mkdir(second)])
  const extension = process.platform === 'win32' ? '.exe' : ''
  await Promise.all([writeFile(join(first, `native${extension}`), ''), writeFile(join(second, `native${extension}`), '')])
  assert.equal(findOnPath('native', [first, '', second].join(delimiter)), join(first, `native${extension}`))
  assert.equal(findOnPath('native', ''), null)
  assert.equal(findOnPath('missing', delimiter), null)

  const windowsFiles = new Set(['C:\\first\\tool.cmd', 'C:\\first\\tool.bat', 'D:\\second\\tool.com', 'D:\\second\\tool.exe'])
  const windowsOptions = { platform: 'win32', exists: (file) => windowsFiles.has(file) }
  assert.equal(findExecutableOnPath('tool', { ...windowsOptions, pathValue: 'C:\\first;;D:\\second' }), 'D:\\second\\tool.exe')
  assert.equal(findExecutableOnPath('tool', { ...windowsOptions, pathValue: 'C:\\first' }), null)
})

test('Windows 上 npm 的 .cmd shim 既能被找到，也能被翻译成 cmd.exe 调用', () => {
  // PATHEXT 的顺序即优先级，但原生映像永远先试：同名 shim 不能盖掉真正的二进制。
  assert.deepEqual(windowsExecutableExtensions({ PATHEXT: '.COM;.EXE;.BAT;.CMD' }), ['.com', '.exe', '.bat', '.cmd'])
  assert.deepEqual(windowsExecutableExtensions({ PATHEXT: '.EXE;.CMD' }), ['.exe', '.cmd'])
  assert.deepEqual(windowsExecutableExtensions({}), ['.com', '.exe', '.bat', '.cmd'])

  const shims = new Set(['C:\\npm\\agent-browser.cmd', 'C:\\npm\\agent-browser.ps1'])
  const options = { platform: 'win32', pathValue: 'C:\\npm', exists: (file) => shims.has(file) }
  // 只认 .exe/.com 时会得出「本机没安装」的错结论 —— 这正是 agent-browser 自检踩到的坑。
  assert.equal(findExecutableOnPath('agent-browser', options), null)
  assert.equal(findCommandOnPath('agent-browser', options), 'C:\\npm\\agent-browser.cmd')

  assert.equal(isWindowsShim('C:\\npm\\agent-browser.cmd'), true)
  assert.equal(isWindowsShim('C:\\npm\\agent-browser.BAT'), true)
  assert.equal(isWindowsShim('C:\\npm\\agent-browser.exe'), false)

  const target = resolveSpawnTarget('C:\\npm\\agent-browser.cmd', ['--version', 'a b'], 'win32', { ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe' })
  assert.equal(target.command, 'C:\\WINDOWS\\system32\\cmd.exe')
  assert.deepEqual(target.args, ['/d', '/s', '/c', 'C:\\npm\\agent-browser.cmd --version "a b"'])
  assert.equal(target.windowsVerbatimArguments, true)

  // 原生 .exe 与 posix 命令都必须原样传，不能被包进 shell。
  assert.deepEqual(resolveSpawnTarget('C:\\tools\\x.exe', ['--a'], 'win32', {}), { command: 'C:\\tools\\x.exe', args: ['--a'] })
  assert.deepEqual(resolveSpawnTarget('/usr/bin/x', ['--a'], 'linux', {}), { command: '/usr/bin/x', args: ['--a'] })
})

async function bundleModule(contents, plugins = []) {
  const output = await build({
    stdin: { contents, resolveDir: root, sourcefile: 'host-utils-fixture.mjs', loader: 'js' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins,
  })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}

test('dshHome is the one place that decides where $DSH_HOME points', () => {
  // 共享解析器：DSH_HOME 非空即用（两端空白裁掉），否则退回 `~/.dsh`。
  assert.equal(dshHome({ DSH_HOME: '/tmp/dsh-home' }, '/home/u'), '/tmp/dsh-home')
  assert.equal(dshHome({ DSH_HOME: '  /tmp/spaced  ' }, '/home/u'), '/tmp/spaced')
  assert.equal(dshHome({ DSH_HOME: '   ' }, '/home/u'), join('/home/u', '.dsh'))
  assert.equal(dshHome({ DSH_HOME: '' }, '/home/u'), join('/home/u', '.dsh'))
  assert.equal(dshHome({}, '/home/u'), join('/home/u', '.dsh'))
  assert.equal(dshHome(null, '/home/u'), join('/home/u', '.dsh'))
  // 默认参数读进程环境，并且**每次调用重新读**：测试与宿主都可能中途改它。
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/live-dsh-home'
    assert.equal(dshHome(), '/tmp/live-dsh-home')
    delete process.env.DSH_HOME
    assert.equal(dshHome(), join(homedir(), '.dsh'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('Judgment request validation uses the shared finite JSON predicate', async () => {
  const { isJson, isJsonValue, validateRequest } = await bundleModule(`
    export { isJson, validateRequest } from './src/modules/judgment/host/provider/request.ts'
    export { isJsonValue } from './src/modules/judgment/host/provider/wire.ts'
  `)
  assert.equal(isJson, isJsonValue)
  for (const value of [null, false, 0, 'text', [1, { valid: true }], { nested: [null, 1.5] }]) assert.equal(isJson(value), true)
  for (const value of [undefined, NaN, Infinity, 1n, { nested: undefined }, [Symbol('x')]]) assert.equal(isJson(value), false)
  assert.equal(validateRequest({ value: Infinity }, { q: { kind: 'noul', prompt: 'valid?' } }).rule, 'state-serializable')
})

test('browser task sleep re-export retains the shared timer behavior', async () => {
  // Mark the shared module external to compare the public re-export with its source instance.
  const { sleep: taskSleep } = await bundleModule(`export { sleep } from './src/modules/browser/host/task/utils.ts'`, [{
    name: 'shared-time-instance',
    setup(builder) {
      builder.onResolve({ filter: /[/\\]host[/\\]time\.js$/ }, () => ({
        path: new URL('../../src/host/time.ts', import.meta.url).href, external: true,
      }))
    },
  }])
  assert.equal(taskSleep, sleep)
  let settled = false
  const pending = sleep(0).then(() => { settled = true })
  assert.equal(settled, false)
  await pending
  assert.equal(settled, true)
})

test('Skills host split activates routes, adopts agents, reconnects projects and disposes effects', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skills-lifecycle-'))
  const previousEnv = { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME }
  process.env.DSH_HOME = join(dir, 'dsh')
  process.env.DSH_AGENTS_HOME = join(dir, 'agents')
  t.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(dir, { recursive: true, force: true })
  })

  const timers = new Map()
  const originalTimers = {
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  }
  const schedule = (kind, callback, ms) => {
    const handle = { kind, callback, ms }
    timers.set(handle, handle)
    return handle
  }
  globalThis.setInterval = (fn, ms) => schedule('interval', fn, ms)
  globalThis.setTimeout = (fn, ms) => schedule('timeout', fn, ms)
  globalThis.clearInterval = (handle) => { timers.delete(handle) }
  globalThis.clearTimeout = (handle) => { timers.delete(handle) }
  t.after(() => Object.assign(globalThis, originalTimers))

  const host = await bundleModule(`export { apply } from './src/modules/skills-mcp/host/index.ts'`, [{
    name: 'isolate-optional-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-mcp-client$/ }, () => ({ path: 'mcp-client', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const name = '@deepseek-ai/dsh-mcp-client'; export function apply() {}; export const inject = []; export const Config = undefined;` }))
      // The importer is a resolved path, so it carries the real extension (.ts under
      // the TypeScript tree). Accept both rather than pinning one.
      builder.onResolve({ filter: /^\.\/sdk\.js$/ }, (args) => /[/\\]mcp[/\\]oauth[/\\]controller\.(?:js|ts)$/.test(args.importer)
        ? { path: 'oauth-sdk', namespace: 'fixture-sdk' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'fixture-sdk' }, () => ({ contents: `export async function loadSdk() { return { ok: false, reason: 'fixture-unavailable', detail: '' } }; export const oauthSdkReasonText = value => value.reason;` }))
      // Diagnostics are not part of this lifecycle assertion; avoid an unawaited side-channel write.
      builder.onResolve({ filter: /[/\\]diagnostics[/\\]heartbeat\.js$/ }, () => ({ path: 'heartbeat', namespace: 'fixture-heartbeat' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture-heartbeat' }, () => ({ contents: 'export async function beat() {}' }))
      builder.onResolve({ filter: /^(?:@deepseek-ai\/|yaml$)/ }, (args) => ({ path: import.meta.resolve(args.path), external: true }))
      // Data modules have no package-resolution base; provide the actual installed anchor.
      builder.initialOptions.define = { 'import.meta.resolve': '__fixtureResolve' }
      builder.initialOptions.banner = { js: `const __fixtureResolve = () => ${JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-mcp-client'))};` }
    },
  }])

  const routes = new Map()
  const listeners = new Map()
  const cleanups = []
  const installed = []
  const disposed = []
  const workspace = join(dir, 'project')
  const agent = {
    session: { cwd: workspace },
    ctx: { plugin(_plugin, config) {
      installed.push(config)
      return { state: 2, dispose() { disposed.push(config.serverName) } }
    } },
  }
  const rows = [{
    id: 'project-mcp', disabled: true,
    options: { name: '@deepseek-ai/dsh-mcp-client', config: {
      serverName: 'project', scope: workspace, transport: 'streamable-http', url: 'https://example.invalid/mcp',
    } },
  }]
  const tools = { register() { return () => {} }, schemas() { return [{ name: 'mcp__project__search', description: 'Search' }] } }
  const originalRegister = tools.register
  const services = {
    loader: { *entries() { yield* rows } },
    tools,
    mcpResources: { async request() { return {} } },
    agents: { list() { return [agent] } },
    workspaceRegistry: { list() { return [{ id: 'project', title: 'Project', path: workspace }] } },
    webServer: { getOrigin: () => 'http://127.0.0.1:31415', register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } },
    connection: { requestRejection: () => undefined },
  }
  const ctx = {
    ...services,
    logger: { info() {}, warn() {}, error() {} },
    get(name) { return services[name] },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); return dispose },
    inject(names, callback) { if (names.every((name) => services[name] !== undefined)) return callback(ctx) },
    on(name, callback) { listeners.set(name, callback); cleanups.push(() => listeners.delete(name)) },
  }
  let didDispose = false
  const dispose = () => {
    if (didDispose) return
    didDispose = true
    for (const stop of cleanups.reverse()) stop()
  }
  t.after(dispose)
  assert.equal(host.apply(ctx, { toolFilters: {} }), undefined, 'Host apply stays synchronous')
  await Promise.resolve()
  await Promise.resolve()
  const prefix = '/api/plugins/toolkit/skills-mcp'
  assert.deepEqual([...routes.keys()].sort(), [
    '/import', '/oauth', '/oauth/callback', '/reconnect', '/rows', '/runtime', '/skill', '/skills',
  ].map((suffix) => prefix + suffix).sort())
  assert.notEqual(tools.register, originalRegister)
  assert.equal(installed.length, 0, 'the first observation preserves the two-tick debounce')
  const reconcile = [...timers.values()].find((timer) => timer.ms === 2000)
  assert.ok(reconcile)
  reconcile.callback()
  assert.equal(installed.length, 1)
  assert.equal(installed[0].serverName, 'project')

  const runtime = await request(routes.get(`${prefix}/runtime`), '', { method: 'GET' })
  assert.equal(runtime.res.statusCode, 200)
  assert.equal(runtime.res.json().currentWorkspace, workspace)
  assert.equal(runtime.res.json().serverStatus[0].tier, 'project')
  assert.equal(runtime.res.json().serverStatus[0].status, 'connected')
  assert.equal(runtime.res.json().oauth.reason, 'fixture-unavailable')
  assert.equal(runtime.res.json().oauth.callbackReady, true)
  assert.equal(runtime.res.json().oauth.redirectUri, `http://127.0.0.1:31415${prefix}/oauth/callback`)

  const reconnect = await request(routes.get(`${prefix}/reconnect`), JSON.stringify({ tier: 'project', serverName: 'project' }))
  assert.deepEqual(reconnect.res.json(), { ok: true, reason: '' })
  assert.equal(installed.length, 2)
  assert.deepEqual(disposed, ['project'])
  dispose()
  assert.equal(routes.size, 0)
  assert.equal(listeners.size, 0)
  assert.equal(timers.size, 0)
  assert.equal(tools.register, originalRegister)
  assert.deepEqual(disposed, ['project', 'project'])
})
