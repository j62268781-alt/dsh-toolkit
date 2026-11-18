/**
 * 按需启动（懒加载）的 MCP 服务器。
 *
 * ## 为什么需要这一层
 *
 * `dsh-mcp-client` 是**急切**的：`apply()` 里第一件事就是 `connect` + `tools/list`，连不上就按
 * reconnect 策略退避重试（见 `dsh-mcp-client/lib/types/connection.js`）。Loader 一挂上这个行，
 * 进程就起来了、会话一开始就吃内存 —— 哪怕这一轮根本不会用到那台服务器的任何工具。
 *
 * 内核没有懒加载开关（Config 里没有 lazy / onDemand 这类字段），所以「开着但不启动」只能在
 * 上层做，而能做到的前提是两件事：
 *
 *   1. **工具清单可以缓存**：`tools/list` 的结果（名字 / 描述 / 入参 schema）落盘，下次启动直接
 *      用它把**同名代理工具**注册进工具注册表 —— 模型看到的工具和真连上时一模一样，也不需要
 *      进程活着；
 *   2. **工具注册可以在运行时增删**：`ctx.tools.register()` 返回的 disposer 是 `ctx.effect` 层，
 *      随时撤掉都不影响当前这一步已经快照过的执行。
 *
 * ## 一次调用的时序
 *
 * ```
 * 模型调用 mcp__x__t
 *   → 代理 execute()：撤掉这台服务器的**全部**代理（否则真客户端注册同名工具会冲突）
 *   → mount()（host.plugin(mcp-client, …)）→ 等 fiber 激活 / 工具出现
 *   → 刷新缓存 → 直接调用真实定义的 execute(args, exec)（复用原始取消信号）
 *   → idle 超时后 unmount，回到「只有缓存、没有进程」的状态
 * ```
 *
 * ## 有缓存才懒，没缓存先连一次
 *
 * 第一次见到的服务器没有清单，代理就成了空壳：模型看不到任何工具，也就永远不会触发「首次调用」。
 * 所以没有缓存条目的服务器在 attach 时**预热一次**（连上、抓清单），之后按 idle 超时断开、转入
 * 代理模式。配置指纹（URL / headers / command / args / env）变了则视为**缓存过期**：仍然用旧清单
 * 起代理（工具名与 schema 通常没变），但标记 `stale`，第一次调用时用新配置重连并刷新。
 *
 * ## 已知取舍
 *
 *   · 工具清单是快照：服务器新增/删除了工具，面板要等到下一次真正连接才看得到；
 *   · 首次调用要多等一次握手（默认最多 30s，超时给明确错误并退回代理状态）；
 *   · 代理通过 `createMcpToolDefinition` 之外的包装转发**真实定义**的 `execute` / `output` /
 *     `projectContent`，所以图片、结构化结果这些由真实定义负责的行为不会退化。
 *
 * @module dsh-toolkit-skills-mcp/mcp/lazy
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from '../runtime/env.js'

/** 缓存文件里一台服务器的工具描述。`parameters` 是原样的 JSON Schema。 */
export interface CachedTool {
  name: string
  description: string
  parameters: any
}

/** 一台服务器的清单条目。 */
export interface CacheEntry {
  /** 抓取时那台服务器的连接配置指纹；与当前不一致即「过期」。 */
  fingerprint: string
  capturedAt: string
  tools: CachedTool[]
}

/** 缓存文件的默认位置：与 heartbeat 同级，都是本插件的诊断/状态文件。 */
export function cacheFile() {
  return join(dshHome(), 'dsh-toolkit-skills-mcp.tool-cache.json')
}

/**
 * 一台服务器的连接配置指纹。
 *
 * 只算那些**会改变工具清单**的字段：换 URL / headers / 启动命令 / 参数 / 环境变量都可能换出一套
 * 不同的工具，而 `failOnStartupError`、`reconnect`、超时这类纯策略字段不影响清单，不该让缓存作废。
 */
export function fingerprintOf(server: any) {
  const material = JSON.stringify({
    transport: String(server?.transport ?? ''),
    url: String(server?.url ?? ''),
    command: String(server?.command ?? ''),
    args: Array.isArray(server?.args) ? server.args.map(String) : [],
    env: server?.env ?? {},
    headers: server?.headers ?? {},
    runtime: String(server?.runtime ?? 'system'),
    allowInsecureTokenEndpoint: server?.allowInsecureTokenEndpoint === true,
  })
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

/** 工具清单缓存：内存读写 + 落盘（写盘失败只记日志，绝不让一次连接失败）。 */
export function createToolCache(options: any = {}) {
  const file = typeof options.file === 'string' && options.file !== '' ? options.file : cacheFile()
  const warn = typeof options.warn === 'function' ? options.warn : () => {}
  let entries: Record<string, CacheEntry> = {}
  let loaded = false
  let writing: Promise<void> = Promise.resolve()

  const persist = () => {
    writing = writing.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
      } catch (error: any) {
        warn(`tool cache write failed: ${String(error?.message ?? error)}`)
      }
    })
    return writing
  }

  return {
    file,
    /** 读一次磁盘。坏文件按「没有缓存」处理，并把它留着给人看。 */
    async load() {
      if (loaded) return
      loaded = true
      try {
        const text = await readFile(file, 'utf8')
        const parsed = JSON.parse(text)
        entries = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch (error: any) {
        if (error?.code !== 'ENOENT') warn(`tool cache unreadable: ${String(error?.message ?? error)}`)
        entries = {}
      }
    },
    /** 一台服务器的缓存；`null` = 从来没有抓到过。 */
    get(serverName: any, fingerprint: string) {
      const entry = entries[String(serverName ?? '')]
      if (entry === undefined || entry === null) return null
      const tools = Array.isArray(entry.tools) ? entry.tools.filter((tool: any) => typeof tool?.name === 'string' && tool.name !== '') : []
      return { tools, capturedAt: String(entry.capturedAt ?? ''), stale: entry.fingerprint !== fingerprint }
    },
    /** 写入一次抓取结果。 */
    put(serverName: any, fingerprint: string, tools: CachedTool[]) {
      entries[String(serverName ?? '')] = {
        fingerprint,
        capturedAt: new Date().toISOString(),
        tools: (Array.isArray(tools) ? tools : []).map((tool) => ({
          name: String(tool.name),
          description: String(tool.description ?? ''),
          parameters: tool.parameters ?? { type: 'object' },
        })),
      }
      return persist()
    },
    drop(serverName: any) {
      delete entries[String(serverName ?? '')]
      return persist()
    },
    /** 面板要展示的全部缓存摘要。 */
    summary() {
      const out: any = {}
      for (const [name, entry] of Object.entries(entries)) {
        out[name] = { tools: Array.isArray(entry?.tools) ? entry.tools.length : 0, capturedAt: String(entry?.capturedAt ?? '') }
      }
      return out
    },
    /** 等待队列里的写盘完成（测试用）。 */
    async flush() {
      await writing
    },
  }
}

/** 一个 scope（全局或某个 agent）里的一台懒服务器的运行时状态。 */
interface LazyState {
  server: any
  agent: any
  fingerprint: string
  status: 'idle' | 'starting' | 'connected'
  /** 代理工具的 disposer，按公开工具名索引。 */
  stops: Map<string, () => void>
  /** 真客户端挂载后的停止函数。 */
  stop: (() => void) | null
  fiber: any
  pending: Promise<void> | null
  lastUsedAt: number
  error: string
}

/** 全局 scope 的键（agent 对象本身作为其它 scope 的键）。 */
const ROOT = Symbol('root')

const toolPrefix = (serverName: any) => `mcp__${String(serverName ?? '')}__`

/**
 * 建一个懒加载运行时。
 *
 * 依赖全部注入：`mount(server, agent)` 负责真的挂 `mcp-client`，`schemas(agent)` 读工具注册表，
 * `now` / `idleMs` 决定回收时机 —— 于是整台状态机可以脱离宿主单测。
 */
export function createLazyRuntime(deps: any) {
  const ctx = deps.ctx
  const warn = typeof deps.warn === 'function' ? deps.warn : () => {}
  const info = typeof deps.info === 'function' ? deps.info : () => {}
  const cache = deps.cache
  const mount = deps.mount
  /**
   * 造工具定义的工厂：**注入**而不是 import。
   *
   * `createMcpToolDefinition` 来自 `@deepseek-ai/dsh-mcp-client`，而集成测试用 esbuild 插件把那个
   * 包换成了 fixture —— 直接 import 会让每个只测懒加载的用例都被整个客户端包绑住。注入后这一层
   * 只依赖「一个能把缓存条目变成合法 ToolDefinition 的函数」，测试里给个假的就是了。
   */
  const createToolDefinition = typeof deps.createToolDefinition === 'function' ? deps.createToolDefinition : null
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const idleMs = Number.isFinite(deps.idleMs) && deps.idleMs > 0 ? deps.idleMs : 10 * 60_000
  const startupTimeoutMs = Number.isFinite(deps.startupTimeoutMs) && deps.startupTimeoutMs > 0 ? deps.startupTimeoutMs : 30_000
  const sleepMs = Number.isFinite(deps.sleepMs) && deps.sleepMs > 0 ? deps.sleepMs : 40

  /** scope → serverName → state。 */
  const scopes = new Map<any, Map<string, LazyState>>()
  let disposed = false

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const toolsOf = (agent: any) => {
    const host: any = agent?.ctx ?? ctx
    try {
      return host?.tools ?? null
    } catch {
      return null
    }
  }

  const schemasOf = (agent: any) => {
    const registry = toolsOf(agent)
    if (registry === null || typeof registry.schemas !== 'function') return []
    try {
      const list = registry.schemas(agent ?? undefined)
      return Array.isArray(list) ? list : []
    } catch (error: any) {
      warn(`cannot read the tool registry: ${String(error?.message ?? error)}`)
      return []
    }
  }

  const liveDefinition = (state: LazyState, name: string) => {
    const registry = toolsOf(state.agent)
    if (registry === null || typeof registry.get !== 'function') return undefined
    try {
      return registry.get(name, state.agent ?? undefined) ?? undefined
    } catch {
      return undefined
    }
  }

  const disposeProxies = (state: LazyState) => {
    for (const stop of state.stops.values()) {
      try {
        stop()
      } catch (error: any) {
        warn(`cannot withdraw a lazy proxy: ${String(error?.message ?? error)}`)
      }
    }
    state.stops.clear()
  }

  const teardown = (state: LazyState) => {
    const stop = state.stop
    state.stop = null
    state.fiber = null
    state.status = 'idle'
    state.pending = null
    if (stop !== null) {
      try {
        stop()
      } catch (error: any) {
        warn(`cannot unmount the lazy MCP server ${state.server?.serverName}: ${String(error?.message ?? error)}`)
      }
    }
  }

  /** 用缓存把同名代理注册回来。没有缓存就什么都不做（等预热）。 */
  const registerProxies = (state: LazyState) => {
    if (disposed) return 0
    const cached = cache.get(state.server?.serverName, state.fingerprint)
    if (cached === null || cached.tools.length === 0) return 0
    if (createToolDefinition === null) {
      // 宿主没提供工厂（旧版本 / 测试替身）：没有代理就没有工具，但绝不能因此中断 apply。
      warn('lazy MCP proxies need a createToolDefinition factory; the cached tools stay unregistered')
      return 0
    }
    const registry = toolsOf(state.agent)
    if (registry === null || typeof registry.register !== 'function') return 0
    const host: any = state.agent?.ctx ?? ctx
    let count = 0
    for (const tool of cached.tools) {
      if (state.stops.has(tool.name)) continue
      /**
       * 名字被**别人**占着就跳过，下一轮 attach 再试。
       *
       * 这不是防御性编程，而是「把一台正在连接的服务器切成懒加载」时的真实竞态：行刚被写成
       * `disabled: true`，Loader 卸载真客户端是异步的，而它的工具此刻还挂在注册表里。硬注册
       * 只会抛错、留下半套代理，之后每轮都撞同一个名字。让它在名字空出来的那一轮补上即可。
       */
      if (typeof registry.get === 'function' && registry.get(tool.name, state.agent ?? undefined) !== undefined) continue
      // 真实定义的 output / projectContent 只有连上之后才有；先给一个合法的兜底，
      // 渲染时（execute 之后）getter 会换成真实定义的那一份。
      const fallback = createToolDefinition(host, {
        name: tool.name,
        rawName: tool.name.startsWith(toolPrefix(state.server?.serverName))
          ? tool.name.slice(toolPrefix(state.server?.serverName).length)
          : tool.name,
        description: tool.description ?? '',
        inputSchema: tool.parameters ?? { type: 'object' },
        call: async () => ({ content: [{ type: 'text', text: 'lazy proxy placeholder' }] }),
      })
      let live: any = null
      const proxy: any = {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.parameters ?? { type: 'object' },
        get output() {
          return live?.output ?? fallback.output
        },
        execute: async (args: any, exec: any) => {
          const target = await ensure(state, tool.name, exec, (definition: any) => {
            live = definition
          })
          return target.execute(args, exec)
        },
        projectContent: (exec: any, result: any) => live?.projectContent?.(exec, result),
      }
      try {
        state.stops.set(tool.name, registry.register(proxy))
        count += 1
      } catch (error: any) {
        warn(`cannot register the lazy proxy ${tool.name}: ${String(error?.message ?? error)}`)
      }
    }
    return count
  }

  /** 等一次连接（single-flight）：期间所有调用共用同一个 promise。 */
  const ensure = async (state: LazyState, toolName: string, exec: any, onLive?: (definition: any) => void) => {
    if (state.status === 'connected') {
      const live = liveDefinition(state, toolName)
      if (live !== undefined) {
        state.lastUsedAt = now()
        onLive?.(live)
        return live
      }
    }
    if (state.pending === null) {
      const run = connect(state)
      state.pending = run
      // 两个分支都要有处理器：`finally()` 会把拒绝再派生一次，而那次没人接 —— 调用方
      // 拿到的是 `pending` 上的拒绝，派生出来的那个会变成 unhandledRejection。
      const settle = () => {
        if (state.pending === run) state.pending = null
      }
      void run.then(settle, settle)
    }
    await withAbort(state.pending, exec?.signal)
    const live = liveDefinition(state, toolName)
    if (live === undefined) {
      throw new Error(`mcp-server "${state.server?.serverName}" started but did not register tool "${toolName}"`)
    }
    state.lastUsedAt = now()
    onLive?.(live)
    return live
  }

  /** 真的连一次：撤代理 → 挂载 → 等激活 → 刷缓存。 */
  const connect = async (state: LazyState) => {
    if (disposed) throw new Error('lazy MCP runtime is disposed')
    if (state.status === 'connected') return
    if (state.status === 'starting') return
    const serverName = String(state.server?.serverName ?? '')
    state.status = 'starting'
    state.error = ''
    disposeProxies(state)
    try {
      const handle = mount(state.server, state.agent)
      state.stop = handle?.stop ?? (typeof handle === 'function' ? handle : null)
      state.fiber = handle?.fiber ?? null
    } catch (error: any) {
      state.status = 'idle'
      state.error = String(error?.message ?? error)
      registerProxies(state)
      throw new Error(`mcp-server "${serverName}" could not be mounted: ${state.error}`)
    }
    info(`mcp server ${serverName}: connecting on demand`)
    const prefix = toolPrefix(serverName)
    const deadline = now() + startupTimeoutMs
    while (now() < deadline) {
      const phase = fiberPhase(state.fiber)
      const mine = schemasOf(state.agent)
        .filter((schema: any) => typeof schema?.name === 'string' && schema.name.startsWith(prefix))
        .map((schema: any) => ({ name: schema.name, description: String(schema.description ?? ''), parameters: schema.parameters ?? { type: 'object' } }))
      if (mine.length > 0) {
        await cache.put(serverName, state.fingerprint, mine)
        state.status = 'connected'
        state.lastUsedAt = now()
        info(`mcp server ${serverName}: connected on demand (${mine.length} tool(s))`)
        return
      }
      if (phase === 2) {
        // 激活但一个工具都没有：连接是成功的，缓存记一条空清单，别再无限等。
        await cache.put(serverName, state.fingerprint, [])
        state.status = 'connected'
        state.lastUsedAt = now()
        info(`mcp server ${serverName}: connected on demand (no tools)`)
        return
      }
      if (phase === 3) {
        const failure = `mcp-server "${serverName}" failed to activate`
        teardown(state)
        registerProxies(state)
        state.error = failure
        throw new Error(failure)
      }
      await sleep(sleepMs)
    }
    const timeout = `mcp-server "${serverName}" did not finish connecting within ${startupTimeoutMs}ms`
    teardown(state)
    registerProxies(state)
    state.error = timeout
    throw new Error(timeout)
  }

  /** 预热：没有缓存的服务器先连一次把清单建起来（策略：有缓存才懒）。 */
  const warm = (state: LazyState) => {
    if (state.status !== 'idle' || state.pending !== null) return
    const run = connect(state).catch((error: any) => {
      warn(`mcp server ${state.server?.serverName}: warm-up failed: ${String(error?.message ?? error)}`)
    })
    state.pending = run
    const settle = () => {
      if (state.pending === run) state.pending = null
    }
    void run.then(settle, settle)
  }

  const stateFor = (scopeKey: any, server: any) => {
    let map = scopes.get(scopeKey)
    if (map === undefined) {
      map = new Map()
      scopes.set(scopeKey, map)
    }
    const serverName = String(server?.serverName ?? '')
    let state = map.get(serverName)
    if (state === undefined) {
      state = {
        server, agent: scopeKey === ROOT ? null : scopeKey, fingerprint: '', status: 'idle',
        stops: new Map(), stop: null, fiber: null, pending: null, lastUsedAt: 0, error: '',
      }
      map.set(serverName, state)
    }
    return state
  }

  return {
    /**
     * 对账一个 scope 的懒服务器集合。
     *
     * @param agent - `null` 表示全局 scope（工具注册在插件自己的上下文里）。
     * @param servers - 这个 scope 下**该由本插件挂载**的懒服务器（已过滤 enabled）。
     */
    attach(agent: any, servers: any) {
      if (disposed) return
      const scopeKey = agent === null || agent === undefined ? ROOT : agent
      let map = scopes.get(scopeKey)
      if (map === undefined) {
        map = new Map()
        scopes.set(scopeKey, map)
      }
      const wanted = new Set<string>()
      for (const server of Array.isArray(servers) ? servers : []) {
        const serverName = String(server?.serverName ?? '')
        if (serverName === '') continue
        wanted.add(serverName)
        const state = stateFor(scopeKey, server)
        const fingerprint = fingerprintOf(server)
        const changed = state.fingerprint !== '' && state.fingerprint !== fingerprint
        state.server = server
        state.fingerprint = fingerprint
        if (changed) {
          // 配置变了：连接中的旧实例按旧配置在跑，直接断掉，回到代理（清单可能过期，标 stale）。
          if (state.status === 'connected' || state.status === 'starting') teardown(state)
          disposeProxies(state)
        }
        if (state.status === 'idle') {
          const cached = cache.get(serverName, fingerprint)
          if (cached === null) warm(state)
          // 每轮都试一次：上轮可能因为「名字还被 Loader 的旧客户端占着」而跳过。
          else registerProxies(state)
        }
      }
      for (const [serverName, state] of [...map.entries()]) {
        if (wanted.has(serverName)) continue
        teardown(state)
        disposeProxies(state)
        map.delete(serverName)
      }
      if (map.size === 0) scopes.delete(scopeKey)
    },

    /** 丢掉一个 agent 的全部懒状态（会话结束）。 */
    detach(agent: any) {
      const map = scopes.get(agent)
      if (map === undefined) return
      for (const state of map.values()) {
        teardown(state)
        disposeProxies(state)
      }
      scopes.delete(agent)
    },

    /** 回收空闲连接。由宿主的慢 tick 调用。 */
    sweep() {
      if (disposed) return 0
      const at = now()
      let closed = 0
      for (const map of scopes.values()) {
        for (const state of map.values()) {
          if (state.status !== 'connected') continue
          if (at - state.lastUsedAt < idleMs) continue
          teardown(state)
          disposeProxies(state)
          registerProxies(state)
          closed += 1
          info(`mcp server ${state.server?.serverName}: idle for ${Math.round((at - state.lastUsedAt) / 1000)}s, disconnected`)
        }
      }
      return closed
    },

    /** 面板要的每台服务器状态（跨 scope 合并，连接中的优先）。 */
    snapshot() {
      const out: any = {}
      const rank: any = { idle: 0, starting: 1, connected: 2 }
      for (const map of scopes.values()) {
        for (const state of map.values()) {
          const serverName = String(state.server?.serverName ?? '')
          if (serverName === '') continue
          const current = out[serverName]
          const entry = {
            state: state.status,
            serverName,
            scope: state.agent === null ? 'global' : String(state.server?.scope ?? ''),
            cachedTools: 0,
            capturedAt: '',
            stale: false,
            lastUsedAt: state.lastUsedAt === 0 ? '' : new Date(state.lastUsedAt).toISOString(),
            error: state.error,
          }
          const cached = cache.get(serverName, state.fingerprint)
          if (cached !== null) {
            entry.cachedTools = cached.tools.length
            entry.capturedAt = cached.capturedAt
            entry.stale = cached.stale
          }
          if (current === undefined || (rank[entry.state] ?? 0) > (rank[current.state] ?? 0)) out[serverName] = entry
        }
      }
      return out
    },

    dispose() {
      disposed = true
      for (const map of scopes.values()) {
        for (const state of map.values()) {
          teardown(state)
          disposeProxies(state)
        }
      }
      scopes.clear()
    },
  }
}

/** cordis Fiber 的 phase：2 = active，3 = failed，其余（含未知）当作未就绪。 */
function fiberPhase(fiber: any) {
  if (fiber === null || fiber === undefined || typeof fiber === 'function') return undefined
  return fiber.state
}

/** 让一个 promise 跟随调用方的取消信号（后台连接不会被取消）。 */
function withAbort(promise: Promise<any>, signal: any) {
  if (signal === undefined || signal === null) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('the tool call was canceled'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('the tool call was canceled'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}