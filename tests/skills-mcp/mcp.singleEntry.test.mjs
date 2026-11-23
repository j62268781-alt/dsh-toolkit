import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createLazyRuntime, createToolCache, fingerprintOf } from '../../src/modules/skills-mcp/host/mcp/lazy.js'
import { installShadow } from '../../src/modules/skills-mcp/host/mcp/filter.js'

const start = 1_000
const ttlMs = 120_000
const parameters = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
const publicName = (server, raw) => `mcp__${server}__${raw}`
const row = (serverName, scope = 'global') => ({
  entryId: `mcp-${serverName}`, serverName, scope, transport: 'streamable-http',
  url: `https://${serverName}.example/mcp`, lazy: true, singleMcpEntry: true, enabled: true,
})
const catalogTool = (name, description = name) => ({ name, description, inputSchema: parameters })
const execution = (agent) => ({ agent, signal: new AbortController().signal })

async function fixture(t, { dispatch = true, beforeExecute, idleMs } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'smp-single-entry-'))
  const file = join(dir, 'tools.json')
  const cache = createToolCache({ file })
  await cache.load()
  const definitions = new Map()
  const reads = []
  const mounts = []
  const calls = []
  const executed = []
  const denied = new Set()
  const overrides = new Map()
  const registry = {
    register(definition, { when } = {}) {
      assert.ok(!definitions.has(definition.name), `duplicate registration: ${definition.name}`)
      definitions.set(definition.name, { definition, when })
      return () => definitions.delete(definition.name)
    },
    get(name, agent) {
      return overrides.get(agent)?.get(name) ?? definitions.get(name)?.definition
    },
    schemas() {
      return [...definitions.values()].map(({ definition }) => definition)
    },
  }
  let clock = start
  let read = () => [catalogTool('lookup', 'Find a record')]
  const runtime = createLazyRuntime({
    ctx: { tools: registry }, cache, now: () => clock, idleMs, catalogIdentity: () => 'anonymous',
    createToolDefinition: (_ctx, options) => ({ ...options, execute: options.call }),
    admitSingleTool: (_server, name) => !denied.has(name),
    readCatalog: async (server, owner) => {
      reads.push({ server: server.serverName, owner })
      return { tools: read(server), capturedAt: clock, ttlMs: server.catalogTtl ?? null, cacheScope: 'private', authorizationIdentity: 'anonymous' }
    },
    mount(server, owner, hidden) {
      mounts.push({ server: server.serverName, owner, hidden })
      const name = publicName(server.serverName, 'lookup')
      const definition = {
        name, parameters, description: 'Find a record',
        execute: async (args, exec) => {
          executed.push({ args, exec })
          return { hit: args.q }
        },
      }
      hidden?.set(name, definition)
      const stop = registry.register(definition, hidden ? { when: () => false } : undefined)
      return { fiber: { state: 2 }, stop }
    },
    singleDispatch: dispatch ? async (definition, args, exec, resolve) => {
      calls.push({ definition, args, exec })
      assert.equal(resolve(), definition)
      if (beforeExecute) await beforeExecute()
      const value = await definition.execute(args, exec)
      return { value, content: [{ type: 'text', text: `nested:${value.hit}` }] }
    } : undefined,
  })
  t.after(async () => {
    runtime.dispose()
    await cache.flush()
    await rm(dir, { recursive: true, force: true })
  })
  return {
    runtime, definitions, reads, mounts, calls, executed, denied, overrides, cache,
    agent: () => ({ ctx: { tools: {
      ...registry,
      register(definition, options) {
        assert.notEqual(definition.name, 'mcp', 'gateway belongs to the root registry')
        return registry.register(definition, options)
      },
    } } }),
    setNow: (time) => { clock = time },
    setReader: (reader) => { read = reader },
  }
}

const search = { action: 'search' }
const target = (action, server = 'alpha', raw = 'lookup') => ({ action, server, tool: publicName(server, raw) })
const lookup = { server: 'alpha', tool: publicName('alpha', 'lookup'), description: 'Find a record' }

test('单入口在首次搜索前不读清单，新鲜缓存复用且 TTL 到期才刷新', async (t) => {
  const f = await fixture(t)
  const alpha = { ...row('alpha'), catalogTtl: ttlMs }
  await f.cache.put(JSON.stringify(['', alpha.scope, alpha.entryId, alpha.serverName]), fingerprintOf(alpha), 'anonymous', {
    tools: [{ name: lookup.tool, rawName: 'lookup', description: lookup.description, parameters }],
    capturedAt: start, ttlMs, cacheScope: 'private',
  }, false)
  f.runtime.attach(null, [alpha])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual([...f.definitions.keys()], ['mcp'])
  const { definition, when } = f.definitions.get('mcp')
  const exec = execution(f.agent())
  assert.equal(await when(exec), true)
  assert.deepEqual(f.reads, [])

  f.setNow(start + ttlMs - 1)
  assert.deepEqual((await definition.execute(search, exec)).tools, [lookup])
  assert.deepEqual(f.reads, [])
  f.setNow(start + ttlMs)
  f.setReader(() => [catalogTool('new', 'New tool')])
  const updated = { server: 'alpha', tool: publicName('alpha', 'new'), description: 'New tool' }
  assert.deepEqual((await definition.execute(search, exec)).tools, [updated])
  assert.deepEqual((await definition.execute(search, exec)).tools, [updated])
  assert.equal(f.reads.length, 1)
  assert.deepEqual(f.mounts, [])
  assert.deepEqual([...f.definitions.keys()], ['mcp'])
})

test('无 TTL 的清单默认不复用，手动缓存模式才保留', async (t) => {
  const f = await fixture(t)
  f.runtime.attach(null, [row('alpha'), { ...row('manual'), manualToolCache: true }])
  const { definition } = f.definitions.get('mcp')
  const exec = execution(f.agent())
  assert.deepEqual((await definition.execute({ ...search, server: 'alpha' }, exec)).tools, [lookup])
  f.setNow(start + ttlMs + 1)
  f.setReader(() => [catalogTool('new')])
  const updated = { server: 'alpha', tool: publicName('alpha', 'new'), description: 'new' }
  assert.deepEqual((await definition.execute({ ...search, server: 'alpha' }, exec)).tools, [updated])
  const manual = (await definition.execute({ ...search, server: 'manual' }, exec)).tools
  assert.equal(manual[0].tool, publicName('manual', 'new'))
  f.setNow(start + 2 * ttlMs)
  f.setReader(() => [catalogTool('newer')])
  assert.deepEqual((await definition.execute({ ...search, server: 'manual' }, exec)).tools, manual)
  assert.deepEqual(f.reads.map(({ server }) => server), ['alpha', 'alpha', 'manual'])
  assert.deepEqual(f.mounts, [])
})

test('根单入口只发现全局和调用方自己的项目；空作用域不入选', async (t) => {
  const f = await fixture(t)
  const a = f.agent()
  const b = f.agent()
  f.runtime.attach(a, [row('local', '/work/a')])
  const { definition, when } = f.definitions.get('mcp')
  assert.equal(await when(execution(a)), true)
  assert.equal(await when(execution(b)), false)
  assert.deepEqual(f.reads, [])

  f.runtime.attach(null, [row('alpha')])
  f.runtime.attach(b, [row('other', '/work/b')])
  assert.deepEqual([...f.definitions.keys()], ['mcp'])
  assert.equal(await when(execution(b)), true)
  assert.deepEqual((await definition.execute(search, execution(a))).tools.map((tool) => tool.server).sort(), ['alpha', 'local'])
  assert.deepEqual(f.reads, [{ server: 'alpha', owner: null }, { server: 'local', owner: a }])
  await assert.rejects(() => definition.execute({ ...search, server: 'other' }, execution(a)), /not available in this scope/)
  await assert.rejects(() => definition.execute(target('call', 'other'), execution(a)), /not available in this scope/)
  assert.deepEqual(f.mounts, [])
  assert.deepEqual((await definition.execute(search, execution(b))).tools.map((tool) => tool.server).sort(), ['alpha', 'other'])
  f.runtime.detach(a)
  assert.deepEqual((await definition.execute(search, execution(a))).tools, [lookup])
})

test('查询与服务器过滤不挂载；过滤拒绝的工具不能 describe 或 call', async (t) => {
  const f = await fixture(t)
  f.denied.add('blocked')
  f.denied.add(publicName('alpha', 'blocked'))
  f.setReader(() => [catalogTool('lookup', 'Find a record'), catalogTool('other', 'Other entry'), catalogTool('blocked', 'Find a secret record')])
  f.runtime.attach(null, [row('alpha'), row('beta')])
  const { definition } = f.definitions.get('mcp')
  const exec = execution(f.agent())
  assert.deepEqual((await definition.execute({ ...search, server: 'alpha', query: 'record' }, exec)).tools, [lookup])
  assert.deepEqual(f.reads.map(({ server }) => server), ['alpha'])
  const described = await definition.execute(target('describe'), exec)
  assert.deepEqual(described.parameters, parameters)
  await assert.rejects(() => definition.execute(target('describe', 'alpha', 'blocked'), exec))
  await assert.rejects(() => definition.execute(target('call', 'alpha', 'blocked'), exec))
  assert.deepEqual(f.mounts, [])
  assert.deepEqual(f.calls, [])
})

test('call 按公开名挂载并经调度器转发；同名替换不能借入口执行', async (t) => {
  const f = await fixture(t)
  f.runtime.attach(null, [row('alpha')])
  const { definition } = f.definitions.get('mcp')
  const caller = f.agent()
  const exec = execution(caller)
  const args = { q: 'hello' }
  const call = { ...target('call'), args }
  const value = await definition.execute(call, exec)
  assert.deepEqual(value, { hit: 'hello' })
  assert.deepEqual(definition.projectContent(exec, { isError: false, value }), [{ type: 'text', text: 'nested:hello' }])
  assert.equal(f.mounts.length, 1)
  const [{ hidden }] = f.mounts
  const live = hidden.get(call.tool)
  assert.ok(live)
  assert.equal(await f.definitions.get(call.tool).when(exec), false)
  assert.deepEqual(f.calls, [{ definition: live, args, exec }])
  assert.deepEqual(f.executed, [{ args, exec }])

  f.overrides.set(caller, new Map([[call.tool, { ...live }]]))
  await assert.rejects(() => definition.execute(call, exec))
  assert.equal(f.calls.length, 1)
  assert.equal(f.executed.length, 1)
  assert.equal(f.mounts.length, 1)
})

test('dispatch 未完成时不会空闲卸载，完成后重新计算空闲时间', async (t) => {
  let release
  let enter
  const gate = new Promise((resolve) => { release = resolve })
  const entered = new Promise((resolve) => { enter = resolve })
  const idleMs = 60_000
  const f = await fixture(t, { idleMs, beforeExecute: () => {
    enter()
    return gate
  } })
  f.runtime.attach(null, [row('alpha')])
  const { definition } = f.definitions.get('mcp')
  const call = { ...target('call'), args: { q: 'slow' } }
  const pending = definition.execute(call, execution(f.agent()))
  await Promise.race([entered, pending])
  try {
    f.setNow(start + idleMs)
    assert.equal(f.runtime.sweep(), 0)
    assert.ok(f.definitions.has(lookup.tool))
  } finally {
    release()
    assert.deepEqual(await pending, { hit: 'slow' })
  }
  assert.equal(f.runtime.sweep(), 0)
  f.setNow(start + 2 * idleMs)
  assert.equal(f.runtime.sweep(), 1)
  assert.deepEqual([...f.definitions.keys()], ['mcp'])
})

test('切换单入口时撤掉旧代理或隐藏定义，不会同时暴露两种入口', async (t) => {
  const f = await fixture(t)
  const single = row('alpha')
  const ordinary = { ...single, singleMcpEntry: false }
  f.runtime.attach(null, [ordinary])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual([...f.definitions.keys()], [lookup.tool])

  f.runtime.attach(null, [single])
  assert.deepEqual([...f.definitions.keys()], ['mcp'])
  const { definition } = f.definitions.get('mcp')
  await definition.execute({ ...target('call'), args: { q: 'switch' } }, execution(f.agent()))
  assert.deepEqual([...f.definitions.keys()], ['mcp', lookup.tool])
  assert.equal(await f.definitions.get(lookup.tool).when(execution(f.agent())), false)

  f.runtime.attach(null, [ordinary])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual([...f.definitions.keys()], [lookup.tool])
  assert.equal(await f.definitions.get(lookup.tool).when(execution(f.agent())), true)
  assert.notEqual(f.definitions.get(lookup.tool).definition, f.calls[0].definition)
})

test('只隐藏指定客户端 fiber 的注册；同服务器名前缀的其他注册仍按原规则处理', (t) => {
  const registrations = new Map()
  const registry = {
    register(definition, options) {
      registrations.set(definition.name, options)
      return () => registrations.delete(definition.name)
    },
  }
  const owner = {}
  const hidden = new Map()
  const live = { name: lookup.tool }
  const peer = { name: publicName('alpha', 'peer') }
  const blocked = { name: publicName('alpha', 'blocked') }
  const shadow = installShadow({ get: () => registry }, (name) => ({ admit: name === peer.name }), {}, new WeakMap([[owner, hidden]]))
  assert.equal(shadow.installed, true)
  t.after(shadow.restore)

  const when = () => true
  const registerFrom = (fiber, tool) => registry.register.call({ ctx: { fiber } }, tool, { when })
  const stop = registerFrom(owner, live)
  const peerFiber = {}
  registerFrom(peerFiber, peer)
  registerFrom(peerFiber, blocked)
  assert.deepEqual([...hidden.values()], [live])
  assert.equal(registrations.get(live.name).when(), false)
  assert.equal(registrations.get(peer.name).when, when)
  assert.equal(registrations.has(blocked.name), false)

  stop()
  assert.equal(hidden.size, 0)
  assert.deepEqual([...registrations.keys()], [peer.name])
})

test('缺少宿主调度器时回退普通懒加载工具', async (t) => {
  const f = await fixture(t, { dispatch: false })
  f.runtime.attach(null, [row('alpha')])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual([...f.definitions.keys()], [lookup.tool])
  assert.equal(await f.definitions.get(lookup.tool).when(execution(f.agent())), true)
  assert.deepEqual(f.mounts, [])
  assert.deepEqual(f.calls, [])
})
