/**
 * 懒加载（按需启动）的 MCP：缓存、代理注册、第一次调用时真连、空闲断开。
 *
 * 这里是这套机制的核心契约所在：**启动时不连接**依然要让模型看到工具，靠的是「上次连上时
 * 抓到的 tools/list 快照 + 同名代理」；真连上之后代理必须整批撤掉（否则真客户端注册同名工具
 * 会撞名），并把调用转给真实定义。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createLazyRuntime, createToolCache, fingerprintOf, cacheFile,
} from '../../src/modules/skills-mcp/host/mcp/lazy.ts'
import { applyRowOp, setPatchIO } from '../../src/modules/skills-mcp/host/patch/apply.ts'
import { rowLazyOf, rowOwnedByPlugin } from '../../src/modules/skills-mcp/host/patch/rows.ts'
import { serverFromRow, projectServersFor, lazyProjectServersFor } from '../../src/modules/skills-mcp/host/mcp/serverRows.ts'
import { parseDocument } from 'yaml'

const home = await mkdtemp(join(tmpdir(), 'smp-lazy-home-'))
process.env.DSH_HOME = home
setPatchIO({
  withFileLock: (_key, run) => run(),
  writeFileAtomic: async (path, text) => writeFile(path, text, 'utf8'),
})

const server = (overrides = {}) => ({
  entryId: 'mcp-alpha',
  serverName: 'alpha',
  scope: 'global',
  transport: 'streamable-http',
  url: 'https://alpha.example/mcp',
  command: '',
  args: [],
  env: {},
  headers: {},
  runtime: 'system',
  enabled: true,
  lazy: true,
  ...overrides,
})

/** 一个够用的工具注册表替身：register / get / schemas。 */
function createRegistry() {
  const definitions = new Map()
  return {
    definitions,
    tools: {
      register(definition) {
        if (definitions.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
        definitions.set(definition.name, definition)
        return () => {
          if (definitions.get(definition.name) === definition) definitions.delete(definition.name)
        }
      },
      get(name) {
        return definitions.get(name)
      },
      schemas() {
        return [...definitions.values()].map((definition) => ({
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        }))
      },
    },
  }
}

/** 与 `createMcpToolDefinition` 同形状的最小定义工厂。 */
function createToolDefinition(_ctx, options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.inputSchema,
    output: { schema: {}, render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => options.call(args, exec),
  }
}

/** 一次「真连接」：注册真实工具，返回 fiber 与 stop。 */
function createMount(registry, registryTools, options = {}) {
  const mounts = []
  const stops = []
  const mount = (target, agent) => {
    mounts.push({ serverName: target.serverName, agent })
    if (options.fail) throw new Error('mount failed')
    const stopsHere = [
      registryTools.register({
        name: `mcp__${target.serverName}__search`,
        description: 'Search the alpha index',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
        output: { schema: {}, render: () => [{ type: 'text', text: 'hit' }] },
        execute: async (args) => ({ content: [{ type: 'text', text: `hit:${args.q}` }] }),
      }),
    ]
    return {
      fiber: { state: 2 },
      stop: () => {
        stops.push(target.serverName)
        for (const stop of stopsHere) stop()
      },
    }
  }
  return { mount, mounts, stops }
}

const exec = { signal: new AbortController().signal, agent: undefined }

test('指纹只受会改变工具清单的字段影响', () => {
  const base = server()
  assert.equal(fingerprintOf(base), fingerprintOf(server()))
  assert.notEqual(fingerprintOf(base), fingerprintOf(server({ url: 'https://other.example/mcp' })))
  assert.notEqual(fingerprintOf(base), fingerprintOf(server({ headers: { Authorization: 'x' } })))
  // 纯策略字段不该让缓存作废
  assert.equal(fingerprintOf(base), fingerprintOf(server({ failOnStartupError: true, toolCallTimeoutMs: 1234 })))
})

test('缓存读写：命中、过期（指纹不同）与落盘', async () => {
  const file = join(home, 'cache-roundtrip.json')
  const cache = createToolCache({ file })
  await cache.load()
  assert.equal(cache.get('alpha', 'fp'), null)

  await cache.put('alpha', 'fp', [{ name: 'mcp__alpha__search', description: 'Search', parameters: { type: 'object' } }])
  await cache.flush()
  const onDisk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(onDisk.alpha.tools[0].name, 'mcp__alpha__search')

  assert.deepEqual(cache.get('alpha', 'fp').stale, false)
  assert.deepEqual(cache.get('alpha', 'other-fp').stale, true)

  // 另一个实例读同一份文件：缓存跨重启有效
  const again = createToolCache({ file })
  await again.load()
  assert.equal(again.get('alpha', 'fp').tools.length, 1)
  assert.equal(cacheFile().endsWith('dsh-toolkit-skills-mcp.tool-cache.json'), true)
})

test('没有缓存的服务器在 attach 时预热一次，并把清单写进缓存', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'warm.json') })
  await cache.load()
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount,
    idleMs: 10 * 60_000, sleepMs: 1,
  })
  runtime.attach(null, [server()])
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(mounts.length, 1, '没缓存 → 预热（连一次）')
  const cached = cache.get('alpha', fingerprintOf(server()))
  assert.ok(cached, '预热必须把清单写进缓存')
  assert.equal(cached.tools[0].name, 'mcp__alpha__search')
  assert.equal(runtime.snapshot().alpha.state, 'connected')
  runtime.dispose()
  await cache.flush()
})

test('有缓存的服务器只注册同名代理，一次连接都不发生', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'proxy.json') })
  await cache.load()
  await cache.put('alpha', fingerprintOf(server()), [
    { name: 'mcp__alpha__search', description: 'Search', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
  ])
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount,
    idleMs: 10 * 60_000, sleepMs: 1,
  })
  runtime.attach(null, [server()])
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(mounts.length, 0, '有缓存 → 启动时绝不连接')
  assert.ok(registry.definitions.has('mcp__alpha__search'), '工具仍然对模型可见')
  const info = runtime.snapshot().alpha
  assert.equal(info.state, 'idle')
  assert.equal(info.cachedTools, 1)
  runtime.dispose()
})

test('第一次调用代理：撤代理 → 真连 → 把调用转给真实定义', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'call.json') })
  await cache.load()
  await cache.put('alpha', fingerprintOf(server()), [
    { name: 'mcp__alpha__search', description: 'Search', parameters: { type: 'object' } },
  ])
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount,
    idleMs: 10 * 60_000, sleepMs: 1,
  })
  runtime.attach(null, [server()])
  await new Promise((resolve) => setTimeout(resolve, 20))

  const proxy = registry.definitions.get('mcp__alpha__search')
  assert.ok(proxy)
  const value = await proxy.execute({ q: 'hi' }, exec)

  assert.equal(mounts.length, 1)
  assert.equal(value.content[0].text, 'hit:hi', '返回值来自真实定义')
  assert.equal(runtime.snapshot().alpha.state, 'connected')
  // 同一 scope 里同名工具只能有一份：真客户端接管后代理必须已经不在了
  assert.equal(registry.definitions.get('mcp__alpha__search').description, 'Search the alpha index')
  runtime.dispose()
})

test('空闲超时：断开连接、代理重新注册回来', async () => {
  const registry = createRegistry()
  const { mount, mounts, stops } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'idle.json') })
  await cache.load()
  await cache.put('alpha', fingerprintOf(server()), [
    { name: 'mcp__alpha__search', description: 'Search', parameters: { type: 'object' } },
  ])
  let clock = 1_000
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount,
    idleMs: 60_000, sleepMs: 1, now: () => clock,
  })
  runtime.attach(null, [server()])
  await new Promise((resolve) => setTimeout(resolve, 20))
  await registry.definitions.get('mcp__alpha__search').execute({}, exec)
  assert.equal(mounts.length, 1)

  // 空闲还没到时什么都不做
  clock += 30_000
  assert.equal(runtime.sweep(), 0)
  assert.equal(stops.length, 0)

  clock += 31_000
  assert.equal(runtime.sweep(), 1)
  assert.deepEqual(stops, ['alpha'])
  assert.equal(runtime.snapshot().alpha.state, 'idle')
  // 代理回来了，模型仍然看得到工具 —— 描述是**这次连接刷新过**的那一份（缓存已更新）
  assert.equal(registry.definitions.get('mcp__alpha__search').description, 'Search the alpha index')
  runtime.dispose()
})

test('挂载失败：回到代理态并报错，不会把工具留在半空', async () => {
  const registry = createRegistry()
  const { mount } = createMount(registry, registry.tools, { fail: true })
  const cache = createToolCache({ file: join(home, 'fail.json') })
  await cache.load()
  await cache.put('alpha', fingerprintOf(server()), [
    { name: 'mcp__alpha__search', description: 'Search', parameters: { type: 'object' } },
  ])
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount,
    idleMs: 60_000, sleepMs: 1,
  })
  runtime.attach(null, [server()])
  await new Promise((resolve) => setTimeout(resolve, 20))

  await assert.rejects(
    () => registry.definitions.get('mcp__alpha__search').execute({}, exec),
    /could not be mounted/,
  )
  assert.equal(runtime.snapshot().alpha.state, 'idle')
  assert.ok(registry.definitions.has('mcp__alpha__search'), '失败后代理必须被放回去')
  runtime.dispose()
})

test('detach 会撤掉代理并断开连接', async () => {
  const registry = createRegistry()
  const { mount, stops } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'detach.json') })
  await cache.load()
  await cache.put('alpha', fingerprintOf(server()), [
    { name: 'mcp__alpha__search', description: 'Search', parameters: { type: 'object' } },
  ])
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, idleMs: 60_000, sleepMs: 1,
  })
  const agent = { ctx: { tools: registry.tools }, scope: '/work/a' }
  runtime.attach(agent, [server({ scope: '/work/a' })])
  await new Promise((resolve) => setTimeout(resolve, 20))
  await registry.definitions.get('mcp__alpha__search').execute({}, exec)
  assert.equal(stops.length, 0)

  runtime.detach(agent)
  assert.deepEqual(stops, ['alpha'])
  assert.equal(registry.definitions.size, 0, '代理与真实工具都必须撤干净')
  runtime.dispose()
})

test('patch：lazy 行由插件托管（Loader 停用），并给开关留出 config.enabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smp-lazy-profile-'))
  await writeFile(join(dir, 'cordis.patch.yml'), `- insert:
    - id: mcp-alpha
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: alpha
        transport: streamable-http
        url: https://alpha.example/mcp
`, 'utf8')
  const ctx = { get: (name) => (name === 'profileContext' ? { dir } : undefined), logger: { warn() {}, info() {}, error() {} } }

  await applyRowOp(ctx, { op: 'lazy', entryId: 'mcp-alpha', lazy: true })
  const lazyText = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  const after = parseDocument(lazyText)
  assert.equal(rowLazyOf(after, 'mcp-alpha'), true)
  assert.equal(rowOwnedByPlugin(after, 'mcp-alpha'), true, '懒行由插件挂载，Loader 必须跳过')
  assert.match(lazyText, /disabled: true/, '懒行的 Loader 条目必须是 disabled')

  // 懒模式下「停用」写 config.enabled（不是 entry.disabled，否则 Loader 语义与用户语义打架）
  await applyRowOp(ctx, { op: 'toggle', entryId: 'mcp-alpha', enabled: false })
  assert.match(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'), /enabled: false/)

  // 关掉懒加载：行交还 Loader，用户此前的「停用」意图要跟着搬过去
  await applyRowOp(ctx, { op: 'lazy', entryId: 'mcp-alpha', lazy: false })
  const eagerText = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  const eager = parseDocument(eagerText)
  assert.equal(rowLazyOf(eager, 'mcp-alpha'), false)
  assert.match(eagerText, /disabled: true/, '用户停用过 → 交还 Loader 后仍然是停用')
  assert.doesNotMatch(eagerText, /^\s*enabled:/m)
})

test('名字被旧客户端占着时跳过代理，等它腾出来那一轮再补上', async () => {
  const registry = createRegistry()
  const { mount } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'race.json') })
  await cache.load()
  await cache.put('alpha', fingerprintOf(server()), [
    { name: 'mcp__alpha__search', description: 'cached', parameters: { type: 'object' } },
  ])
  // 模拟「切到懒加载的瞬间，Loader 的旧客户端还没卸载」
  const squatter = registry.tools.register({
    name: 'mcp__alpha__search', description: 'loader-owned', parameters: { type: 'object' },
    output: { schema: {}, render: () => [] }, execute: async () => ({}),
  })
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, idleMs: 60_000, sleepMs: 1,
  })
  runtime.attach(null, [server()])
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(registry.definitions.get('mcp__alpha__search').description, 'loader-owned', '不能硬抢名字')

  squatter()
  runtime.attach(null, [server()])
  assert.equal(registry.definitions.get('mcp__alpha__search').description, 'cached', '腾出来之后补上代理')
  runtime.dispose()
})

test('状态推导：懒行没连接时报「按需启动」，不报故障', async () => {
  const { deriveStatus, SERVER_STATUS } = await import('../../src/modules/skills-mcp/host/mcp/status.ts')
  assert.equal(deriveStatus({ enabled: true, lazy: true, connected: false, observed: true }), SERVER_STATUS.lazyIdle)
  assert.equal(deriveStatus({ enabled: true, lazy: true, connected: null, observed: true }), SERVER_STATUS.lazyIdle)
  // 连上了就照常报「已连接」
  assert.equal(deriveStatus({ enabled: true, lazy: true, connected: true, observed: true }), SERVER_STATUS.connected)
  // 停用优先
  assert.equal(deriveStatus({ enabled: false, lazy: true, connected: true }), SERVER_STATUS.disabled)
  // 非懒行不受影响
  assert.equal(deriveStatus({ enabled: true, connected: false, phase: 'failed', observed: true }), SERVER_STATUS.failed)
})

test('行投影：懒行不再算 Loader 托管，项目级急切挂载也不会顺手连上它', () => {
  const lazy = serverFromRow({
    id: 'mcp-alpha',
    disabled: true,
    options: { config: { serverName: 'alpha', scope: '/work/a', lazy: true } },
  })
  assert.equal(lazy.lazy, true)
  assert.equal(lazy.loaderManaged, false)
  assert.equal(lazy.enabled, true, '没写 config.enabled 就是启用')

  const disabled = serverFromRow({
    id: 'mcp-alpha',
    disabled: true,
    options: { config: { serverName: 'alpha', lazy: true, enabled: false } },
  })
  assert.equal(disabled.enabled, false)

  const eagerGlobal = serverFromRow({
    id: 'mcp-beta',
    options: { config: { serverName: 'beta' } },
  })
  assert.equal(eagerGlobal.lazy, false)
  assert.equal(eagerGlobal.loaderManaged, true)

  const servers = [lazy, serverFromRow({
    id: 'mcp-gamma',
    disabled: true,
    options: { config: { serverName: 'gamma', scope: '/work/a' } },
  })]
  assert.deepEqual(projectServersFor(servers, '/work/a').map((entry) => entry.serverName), ['gamma'])
  assert.deepEqual(lazyProjectServersFor(servers, '/work/a').map((entry) => entry.serverName), ['alpha'])
})