/**
 * 懒加载（按需启动）的 MCP：缓存、代理注册、第一次调用时真连、空闲断开。
 *
 * 这里是这套机制的核心契约所在：**启动时不连接**依然要让模型看到工具，靠的是「上次连上时
 * 抓到的仍然新鲜的 tools/list 快照 + 同名代理」；真连上之后代理必须整批撤掉（否则真客户端注册同名工具
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
  const conditions = new Map()
  return {
    definitions,
    conditions,
    tools: {
      register(definition, { when } = {}) {
        if (definitions.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
        definitions.set(definition.name, definition)
        if (when) conditions.set(definition.name, when)
        return () => {
          if (definitions.get(definition.name) !== definition) return
          definitions.delete(definition.name)
          conditions.delete(definition.name)
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
const capturedAt = 1_000
const ttlMs = 120_000
const anonymous = 'anonymous'
const catalogIdentity = () => anonymous
const search = 'mcp__alpha__search'
const cacheKey = (target, namespace = '') => JSON.stringify([namespace, target.scope, target.entryId, target.serverName])
const snapshot = (description = 'Search') => ({
  tools: [{ name: search, rawName: 'search', description, parameters: { type: 'object' } }],
  capturedAt, ttlMs, cacheScope: 'private',
})
const seed = (cache, target = server(), data = snapshot(), namespace) =>
  cache.put(cacheKey(target, namespace), fingerprintOf(target), anonymous, data, false)
const settle = () => new Promise((resolve) => setImmediate(resolve))
const rawCatalog = (name, at = capturedAt) => ({
  tools: [{ name, description: name, inputSchema: { type: 'object' } }],
  capturedAt: at, ttlMs, cacheScope: 'private', authorizationIdentity: anonymous,
})

test('指纹只受会改变工具清单的字段影响', () => {
  const base = server()
  assert.equal(fingerprintOf(base), fingerprintOf(server()))
  assert.notEqual(fingerprintOf(base), fingerprintOf(server({ url: 'https://other.example/mcp' })))
  assert.notEqual(fingerprintOf(base), fingerprintOf(server({ headers: { Authorization: 'x' } })))
  // 纯策略字段不该让缓存作废
  assert.equal(fingerprintOf(base), fingerprintOf(server({ failOnStartupError: true, toolCallTimeoutMs: 1234 })))
})

test('v2 缓存只重放匹配的匿名清单，TTL 到期时仅手动模式可复用', async () => {
  const file = join(home, 'cache-roundtrip.json')
  const cache = createToolCache({ file })
  const target = server()
  const key = cacheKey(target)
  const fingerprint = fingerprintOf(target)
  await cache.load()
  assert.equal(cache.get(key, fingerprint, anonymous, false, capturedAt), null)
  await seed(cache, target)

  const onDisk = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(onDisk, {
    version: 2, entries: { [key]: { ...snapshot(), fingerprint, authorizationIdentity: anonymous } },
  })
  const again = createToolCache({ file })
  await again.load()
  const expires = capturedAt + ttlMs
  assert.deepEqual(again.get(key, fingerprint, anonymous, false, expires - 1)?.tools, snapshot().tools)
  assert.equal(again.get(key, 'other-fp', anonymous, true, expires - 1), null)
  assert.equal(again.get(key, fingerprint, null, true, expires - 1), null)
  assert.equal(again.get(key, fingerprint, anonymous, true, capturedAt - 1), null)
  assert.equal(again.get(key, fingerprint, anonymous, false, expires), null)
  assert.equal(again.get(key, fingerprint, anonymous, true, expires)?.capturedAt, capturedAt)
  assert.equal(cacheFile().endsWith('dsh-toolkit-skills-mcp.tool-cache.json'), true)
})

test('没有有效 TTL 的清单只能手动保存，身份未知时连手动模式也不落盘', async () => {
  const file = join(home, 'manual.json')
  const target = server()
  const key = cacheKey(target)
  const fingerprint = fingerprintOf(target)
  const data = { ...snapshot(), ttlMs: null }
  const cache = createToolCache({ file })
  await cache.load()
  await cache.put(key, fingerprint, anonymous, data, false)
  assert.equal(cache.get(key, fingerprint, anonymous, true, capturedAt), null)
  await cache.put(key, fingerprint, anonymous, data, true)
  const again = createToolCache({ file })
  await again.load()
  assert.equal(again.get(key, fingerprint, anonymous, false, capturedAt), null)
  assert.equal(again.get(key, fingerprint, anonymous, true, capturedAt + ttlMs)?.ttlMs, null)
  await again.put(key, fingerprint, null, data, true)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).entries, {})
})

test('旧版磁盘格式即使指纹匹配也不重放', async () => {
  const target = server()
  const key = cacheKey(target)
  const fingerprint = fingerprintOf(target)
  const entry = { ...snapshot(), fingerprint, authorizationIdentity: anonymous }
  const legacyFormats = [{ [key]: entry }, { version: 1, entries: { [key]: entry } }]
  for (const [index, data] of legacyFormats.entries()) {
    const file = join(home, `legacy-${index}.json`)
    await writeFile(file, JSON.stringify(data))
    const cache = createToolCache({ file })
    await cache.load()
    assert.equal(cache.get(key, fingerprint, anonymous, true, capturedAt), null)
  }
})

test('无法短连接读取清单时，attach 只预热一次并报告实时清单', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'warm.json') })
  await cache.load()
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity,
    readCatalog: async () => { throw new Error('catalog credentials not verified') },
    now: () => capturedAt, sleepMs: 1,
  })
  runtime.attach(null, [server()])
  await settle()
  runtime.attach(null, [server()])
  await settle()

  assert.equal(mounts.length, 1, '无法读取短连接清单 → 只预热一次')
  assert.equal(runtime.snapshot().alpha.state, 'connected')
  assert.equal(runtime.snapshot().alpha.cachedTools, 1)
  assert.equal(runtime.snapshot().alpha.capturedAt, new Date(capturedAt).toISOString())
  runtime.dispose()
  await cache.flush()
})

test('有缓存的服务器只注册同名代理，一次连接都不发生', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'proxy.json') })
  await cache.load()
  await seed(cache)
  let reads = 0
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity,
    readCatalog: async () => { reads++; return rawCatalog('unexpected') },
    now: () => capturedAt,
  })
  runtime.attach(null, [server()])
  await settle()

  assert.equal(reads, 0, '新鲜缓存 → 不读短连接清单')
  assert.equal(mounts.length, 0, '新鲜缓存 → 启动时绝不连接')
  assert.ok(registry.definitions.has('mcp__alpha__search'), '工具仍然对模型可见')
  const info = runtime.snapshot().alpha
  assert.equal(info.state, 'idle')
  assert.equal(info.cachedTools, 1)
  runtime.dispose()
})

test('同名服务器不跨项目、配置档、行 ID 或授权身份复用磁盘清单', async (t) => {
  const target = server({ scope: '/work/a' })
  for (const [label, row, namespace, identity, hit] of [
    ['原项目', target, '/profiles/a', anonymous, true],
    ['其他项目', { ...target, scope: '/work/b' }, '/profiles/a', anonymous, false],
    ['全局', { ...target, scope: 'global' }, '/profiles/a', anonymous, false],
    ['其他配置档', target, '/profiles/b', anonymous, false],
    ['其他行', { ...target, entryId: 'mcp-other' }, '/profiles/a', anonymous, false],
    ['身份未知', target, '/profiles/a', null, false],
  ]) {
    await t.test(label, async () => {
      const registry = createRegistry()
      const { mount, mounts } = createMount(registry, registry.tools)
      const agent = row.scope === 'global' ? null : { ctx: registry }
      const file = join(home, `scope-${label}.json`)
      const cache = createToolCache({ file })
      await cache.load()
      await seed(cache, target, snapshot(), '/profiles/a')
      const reloaded = createToolCache({ file })
      await reloaded.load()
      const reads = []
      const runtime = createLazyRuntime({
        ctx: registry, cache: reloaded, createToolDefinition, mount, namespace,
        catalogIdentity: () => identity, now: () => capturedAt,
        readCatalog: async (server, owner) => {
          reads.push({ server, owner })
          return { ...rawCatalog('scoped'), authorizationIdentity: null }
        },
      })
      runtime.attach(agent, [row])
      await settle()
      await reloaded.flush()
      await settle()

      assert.deepEqual([...registry.definitions.keys()], [hit ? search : 'mcp__alpha__scoped'])
      assert.deepEqual(reads, hit ? [] : [{ server: row, owner: agent }])
      assert.equal(mounts.length, 0)
      runtime.dispose()
    })
  }
})

test('进程重启后，已过期的磁盘清单不注册代理；先读取新清单', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const file = join(home, 'expired.json')
  const cache = createToolCache({ file })
  await cache.load()
  await seed(cache)
  const reloaded = createToolCache({ file })
  await reloaded.load()
  const expiredAt = capturedAt + ttlMs
  let resolveRead
  const runtime = createLazyRuntime({
    ctx: registry, cache: reloaded, createToolDefinition, mount, catalogIdentity, now: () => expiredAt,
    readCatalog: () => new Promise((resolve) => { resolveRead = resolve }),
  })
  runtime.attach(null, [server()])
  await settle()
  assert.equal(typeof resolveRead, 'function')
  assert.equal(registry.definitions.size, 0)
  assert.equal(runtime.snapshot().alpha.state, 'starting')
  resolveRead(rawCatalog('fresh', expiredAt))
  await settle()
  await reloaded.flush()
  await settle()

  assert.deepEqual([...registry.definitions.keys()], ['mcp__alpha__fresh'])
  assert.equal(runtime.snapshot().alpha.stale, false)
  assert.equal(mounts.length, 0)
  runtime.dispose()
})

test('清单到期不会因 attach 或 sweep 重读；工具入选时刷新并拒绝旧定义', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'admission.json') })
  await cache.load()
  await seed(cache, server(), snapshot('search'))
  let clock = capturedAt
  let reads = 0
  const runtime = createLazyRuntime({
    ctx: registry, cache, createToolDefinition, mount, catalogIdentity, now: () => clock,
    readCatalog: async () => rawCatalog(++reads === 1 ? 'search' : 'updated', clock),
  })
  runtime.attach(null, [server()])
  await settle()
  const oldWhen = registry.conditions.get(search)
  assert.equal(await oldWhen({ signal: exec.signal }), true)
  assert.equal(reads, 0)

  clock += ttlMs
  runtime.attach(null, [server()])
  runtime.sweep()
  await settle()
  assert.equal(reads, 0)
  assert.equal(runtime.snapshot().alpha.stale, true)
  const step = { signal: exec.signal }
  assert.deepEqual(await Promise.all([oldWhen(step), oldWhen(step)]), [true, true])
  assert.equal(reads, 1, '并发入选检查只刷新一次')
  assert.equal(registry.conditions.get(search), oldWhen, '清单不变时保留旧代理')
  assert.equal(runtime.snapshot().alpha.stale, false)

  clock += ttlMs
  assert.equal(await oldWhen({ signal: exec.signal }), false)
  assert.equal(reads, 2)
  assert.deepEqual([...registry.definitions.keys()], ['mcp__alpha__updated'])
  assert.equal(await registry.conditions.get('mcp__alpha__updated')({ signal: exec.signal }), true)
  assert.equal(mounts.length, 0)
  runtime.dispose()
})

test('显式刷新撤下旧代理；被新刷新取代的迟到清单不会注册或落盘', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const file = join(home, 'refresh.json')
  const cache = createToolCache({ file })
  const target = server()
  await cache.load()
  await seed(cache, target)
  const reads = []
  const runtime = createLazyRuntime({
    ctx: registry, cache, createToolDefinition, mount, catalogIdentity, now: () => capturedAt,
    readCatalog: (_server, _agent, _auth, signal) => new Promise((resolve) => reads.push({ resolve, signal })),
  })
  runtime.attach(null, [target])
  await settle()
  assert.ok(registry.definitions.has(search))

  const first = runtime.refresh('alpha')
  await settle()
  assert.equal(reads.length, 1)
  assert.equal(registry.definitions.size, 0)
  assert.equal(reads[0].signal.aborted, false)

  const second = runtime.refresh('alpha')
  await settle()
  assert.equal(reads.length, 2)
  assert.equal(reads[0].signal.aborted, true)
  reads[1].resolve(rawCatalog('new'))
  assert.equal(await second, 1)
  reads[0].resolve(rawCatalog('late'))
  await first
  await cache.flush()

  const reloaded = createToolCache({ file })
  await reloaded.load()
  assert.deepEqual([...registry.definitions.keys()], ['mcp__alpha__new'])
  assert.deepEqual(reloaded.get(cacheKey(target), fingerprintOf(target), anonymous, false, capturedAt)?.tools.map((tool) => tool.name), ['mcp__alpha__new'])
  assert.equal(mounts.length, 0)
  runtime.dispose()
})

test('第一次调用代理：撤代理 → 真连 → 把调用转给真实定义', async () => {
  const registry = createRegistry()
  const { mount, mounts } = createMount(registry, registry.tools)
  const cache = createToolCache({ file: join(home, 'call.json') })
  await cache.load()
  await seed(cache)
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity, now: () => capturedAt,
  })
  runtime.attach(null, [server()])
  await settle()

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
  await seed(cache)
  let clock = capturedAt
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity,
    idleMs: 60_000, sleepMs: 1, now: () => clock,
  })
  runtime.attach(null, [server()])
  await settle()
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
  await seed(cache)
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity, now: () => capturedAt,
  })
  runtime.attach(null, [server()])
  await settle()

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
  const target = server({ scope: '/work/a' })
  await seed(cache, target)
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity, now: () => capturedAt,
  })
  const agent = { ctx: { tools: registry.tools }, scope: '/work/a' }
  runtime.attach(agent, [target])
  await settle()
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
  await seed(cache, server(), snapshot('cached'))
  // 模拟「切到懒加载的瞬间，Loader 的旧客户端还没卸载」
  const squatter = registry.tools.register({
    name: 'mcp__alpha__search', description: 'loader-owned', parameters: { type: 'object' },
    output: { schema: {}, render: () => [] }, execute: async () => ({}),
  })
  const runtime = createLazyRuntime({
    ctx: { tools: registry.tools }, cache, createToolDefinition, mount, catalogIdentity, now: () => capturedAt,
  })
  runtime.attach(null, [server()])
  await settle()
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