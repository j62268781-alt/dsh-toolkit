import { createRequire } from 'node:module'

export interface RawMcpTool {
  name: string
  inputSchema: Record<string, unknown>
  [key: string]: unknown
}

export interface McpCatalog {
  tools: RawMcpTool[]
  ttlMs: number | null
  capturedAt: number
  cacheScope: 'public' | 'private' | null
  authorizationIdentity: 'anonymous' | null
}

export interface CatalogAuth {
  token(): Promise<string | undefined>
}

export interface CatalogReadOptions {
  signal?: AbortSignal
  /** Undefined means the real mount's authorization cannot be verified. */
  auth?: CatalogAuth | null
}

interface CatalogReaderDeps {
  hostUrl: string
  normalizeConfig: (config: any) => any
  loadRuntime?: () => ReturnType<typeof loadRuntime>
}

const READ_TIMEOUT_MS = 12_000
const CLOSE_TIMEOUT_MS = 5_000
const MAX_PAGES = 100
const MAX_TOOLS = 10_000

/** Identity is deliberately not derived from credential material or inherited process state. */
export function catalogAuthorizationIdentity(mountConfig: any, { auth }: Pick<CatalogReadOptions, 'auth'> = {}): 'anonymous' | null {
  if (auth !== null || mountConfig?.transport !== 'streamable-http' || mountConfig.expandTemplates) return null
  if (Object.keys(mountConfig.headers ?? {}).length !== 0 || typeof mountConfig.url !== 'string') return null
  try {
    const url = new URL(mountConfig.url)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      ? 'anonymous' : null
  } catch {
    return null
  }
}

function loadRuntime(hostUrl: string) {
  // Use the SDK's public CJS exports from the host MCP client's own dependency tree.
  // This avoids invoking the OAuth patch (which wraps only the host's ESM transport).
  const require = createRequire(hostUrl)
  return {
    sdk: require('@modelcontextprotocol/client'),
    stdio: () => ({
      StdioClientTransport: require('@modelcontextprotocol/client/stdio').StdioClientTransport,
      scrubbedParentEnv: require('@deepseek-ai/dsh-subprocess').scrubbedParentEnv,
    }),
  }
}

function within<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function budget(value: unknown, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.min(value, max) : max
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function listCatalog(client: any, signal: AbortSignal, identity: McpCatalog['authorizationIdentity']): Promise<McpCatalog> {
  const tools: RawMcpTool[] = []
  const catalog: McpCatalog = { tools, ttlMs: null, capturedAt: Date.now(), cacheScope: null, authorizationIdentity: identity }
  if (client.getServerCapabilities()?.tools === undefined) return catalog
  const cursors = new Set<string>()
  const names = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    signal.throwIfAborted()
    // Unlike listTools(), the raw request neither caches nor filters the tool definitions.
    const reply = await client.request({ method: 'tools/list', ...(cursor !== undefined ? { params: { cursor } } : {}) }, { signal })
    if (!Array.isArray(reply?.tools) || tools.length + reply.tools.length > MAX_TOOLS) throw new Error('Invalid MCP catalog size')
    for (const tool of reply.tools) {
      if (!isRecord(tool) || typeof tool.name !== 'string' || !tool.name || !isRecord(tool.inputSchema) || names.has(tool.name)) {
        throw new Error('Invalid or duplicate MCP catalog tool')
      }
      names.add(tool.name)
      tools.push(tool as RawMcpTool)
    }
    const ttl = reply.ttlMs
    const scope = reply.cacheScope
    // The SDK uses first-page cache metadata. A later page can only tighten it.
    if (page === 0) {
      catalog.capturedAt = Date.now()
      catalog.ttlMs = Number.isSafeInteger(ttl) && ttl >= 0 ? ttl : null
      catalog.cacheScope = scope === 'public' || scope === 'private' ? scope : null
    } else {
      if (ttl !== undefined && catalog.ttlMs !== null) {
        catalog.ttlMs = Number.isSafeInteger(ttl) && ttl >= 0 ? Math.min(ttl, catalog.ttlMs) : null
      }
      if (scope !== undefined && scope !== 'public') catalog.cacheScope = scope === 'private' ? 'private' : null
    }
    cursor = reply.nextCursor
    if (cursor === undefined) return catalog
    if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Invalid or repeating MCP catalog cursor')
    cursors.add(cursor)
  }
  throw new Error('MCP catalog exceeded pagination limit')
}

/** Uses a disposable transport and requests metadata only. Never mounts a plugin or invokes a tool. */
export function createCatalogReader(deps: CatalogReaderDeps) {
  return {
    async read(_ctx: any, mountConfig: any, options: CatalogReadOptions = {}): Promise<McpCatalog> {
      if (options.signal?.aborted) throw new Error('MCP catalog read aborted')
      let config
      try {
        config = deps.normalizeConfig(mountConfig)
      } catch {
        throw new Error('Invalid MCP catalog mount configuration')
      }
      // The host does not export its credential binding. Do not connect with different credentials.
      if (!config || config.expandTemplates || (config.transport === 'streamable-http' && options.auth === undefined)) {
        throw new Error('MCP catalog transport credentials cannot be verified')
      }
      const timeoutMs = budget(config.startupTimeoutMs, READ_TIMEOUT_MS)
      const deadline = AbortSignal.timeout(timeoutMs)
      const lifetime = new AbortController()
      const signal = AbortSignal.any([deadline, lifetime.signal, ...(options.signal ? [options.signal] : [])])
      let transport: any
      let client: any
      let started = false
      let closeObserved = false
      let changed = false
      let closed!: () => void
      const closure = new Promise<void>((resolve) => { closed = resolve })
      const work = Promise.resolve().then(async () => {
        signal.throwIfAborted()
        const { sdk, stdio } = deps.loadRuntime ? deps.loadRuntime() : loadRuntime(deps.hostUrl)
        client = new sdk.Client({ name: 'dsh-mcp-client', version: '0.0.1' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } })
        client.setNotificationHandler('notifications/tools/list_changed', () => { changed = true })
        let identity: McpCatalog['authorizationIdentity'] = null
        if (config.transport === 'stdio') {
          const { StdioClientTransport, scrubbedParentEnv } = stdio()
          transport = new StdioClientTransport({
            command: config.command, args: config.args, cwd: config.cwd,
            env: { ...scrubbedParentEnv(), ...config.env },
          })
        } else if (config.transport === 'streamable-http') {
          const url = new URL(config.url)
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported MCP catalog URL')
          const token = await options.auth?.token()
          signal.throwIfAborted()
          if (token !== undefined && typeof token !== 'string') throw new Error('Invalid MCP catalog authorization')
          identity = token ? null : catalogAuthorizationIdentity(config, { auth: null })
          transport = new sdk.StreamableHTTPClientTransport(url, {
            requestInit: { headers: config.headers },
            // A read may use current credentials but never refresh them or start interactive authorization.
            ...(token ? { authProvider: { token: async () => token } } : {}),
          })
        } else {
          throw new Error('Unsupported MCP catalog transport')
        }
        const start = transport.start.bind(transport)
        transport.start = () => {
          signal.throwIfAborted()
          started = true
          return start()
        }
        transport.onclose = () => { closeObserved = true; closed() }
        await client.connect(transport, { signal, timeout: timeoutMs })
        signal.throwIfAborted()
        return listCatalog(client, signal, identity)
      })
      let result: McpCatalog
      try {
        result = await within(work, signal)
      } catch {
        // Config, protocol and SDK errors can contain tokens, headers and command arguments.
        throw new Error(signal.aborted ? 'MCP catalog read aborted or timed out' : 'MCP catalog read failed')
      } finally {
        lifetime.abort()
        if (transport) {
          const cleanup = async () => {
            await (client.transport === transport ? client.close() : transport.close())
            await work.catch(() => {})
            if (started && !closeObserved) await closure
          }
          try {
            await within(cleanup(), AbortSignal.timeout(budget(config.closeTimeoutMs, CLOSE_TIMEOUT_MS)))
          } catch {
            throw new Error('MCP catalog transport closure was not confirmed')
          }
        }
      }
      if (changed) throw new Error('MCP catalog changed while reading')
      if (options.signal?.aborted || deadline.aborted) throw new Error('MCP catalog read aborted or timed out')
      return result
    },
  }
}
