import { statSync } from 'node:fs'
import { join } from 'node:path'
import { serverRows } from '../mcp/serverRows.js'
import { connectionDraftOf } from '../mcp/connection.js'
import { readMcpRowsFromPatch } from '../patch/readRows.js'

/**
 * cordis fiber 状态 → 官方 phase 文案。
 *
 * 顺序就是 `FiberState` 的枚举顺序（PENDING/LOADING/ACTIVE/FAILED/DISPOSED/UNLOADING），
 * 与 `@deepseek-ai/dsh-host-plugin-inventory` 的 FIBER_PHASE 一致。`null` 表示没有对应
 * 文案（DISPOSED）。
 */
const FIBER_PHASE = ['pending', 'loading', 'active', 'failed', null, 'unloading']

/**
 * 读一行的 fiber 状态。
 *
 * 修掉一个死字段：原先读的是 `entry.fiberPhase`，但那是
 * `dsh-host-plugin-inventory` **另外算出来**的派生字段，原始 Loader entry 上只有
 * `entry.fiber`（Fiber 对象），于是 `phase` 永远是空串 —— 面板因此无法区分
 * 「连上了但没有工具」和「压根没加载起来」。两种形态都认，优先用官方已算好的。
 */
const phaseOf = (entry: any) => {
  const direct = entry?.fiberPhase
  if (typeof direct === 'string' && direct !== '') return direct
  return fiberPhaseOf(entry?.fiber)
}

/** 同一个映射，但直接吃一个 fiber 对象 —— 本插件自己挂载的那些项目级服务器用这个。 */
export const fiberPhaseOf = (fiber: any) => {
  const state = fiber?.state
  const mapped = Number.isInteger(state) ? FIBER_PHASE[state] : undefined
  return typeof mapped === 'string' ? mapped : ''
}

/** Workspaces the registry knows, reduced to what the project picker needs. */
export function configuredWorkspaces(ctx: any) {
  try {
    const registry = ctx.get?.('workspaceRegistry')
    if (registry === undefined || registry === null || typeof registry.list !== 'function') return []
    return JSON.parse(JSON.stringify(registry.list().map((workspace: any) => ({
      id: String(workspace?.id ?? ''),
      title: String(workspace?.title ?? ''),
      path: String(workspace?.path ?? ''),
    })).filter((workspace: any) => workspace.path !== '')))
  } catch (error: any) {
    // Distinguish "no workspaces" from "the registry blew up".
    if (process.env.SMP_DEBUG) console.error('[dsh-skills-mcp-manager] workspace registry unavailable', error)
    return []
  }
}

/** The Loader service, reached without depending on injection timing. */
export function loaderOf(ctx: any) {
  try {
    const direct = ctx.get?.('loader')
    if (direct !== undefined && direct !== null) return direct
  } catch {
    // fall through to the injected property
  }
  try {
    return ctx.loader ?? null
  } catch {
    // Expected: a bare access throws in cordis before the service is injected.
    return null
  }
}

/** The active profile's `cordis.patch.yml`, or '' when the profile is not injected yet. */
export function patchFileOf(ctx: any) {
  try {
    const profile = ctx.get?.('profileContext') ?? ctx.profileContext
    if (profile === null || typeof profile !== 'object') return ''
    if (typeof profile.dir !== 'string' || profile.dir === '') return ''
    return join(profile.dir, 'cordis.patch.yml')
  } catch {
    return ''
  }
}

/** Awaitable patch-row refresh (mtime cache; the promise is shared while a read is in flight). */
let patchRowsCache: any = { file: '', mtimeMs: -1, entries: null }
let patchRowsInFlight: any = null
/** 由 `apply()` 绑定：文件里出现了新行时立刻刷新运行态。 */
let onPatchRowsRefreshed = () => {}

export function setPatchRowsRefreshed(listener: any) {
  onPatchRowsRefreshed = listener
}

/** Read the patch file once and cache the entries together with its mtime. */
export async function refreshPatchRows(file: any, { force = false }: any = {}) {
  if (patchRowsInFlight !== null) {
    if (!force) return patchRowsInFlight
    // A write just happened: a read that started before it would cache the OLD mtime and
    // hand the caller a list without the new row (the client then keeps its optimistic
    // card next to the real one). Wait for that read, then read the file again.
    await patchRowsInFlight
  }
  patchRowsInFlight = readMcpRowsFromPatch(file)
    .then((result) => {
      if (result.ok === true) {
        patchRowsCache = { file, mtimeMs: result.mtimeMs, entries: result.entries }
        try { onPatchRowsRefreshed() } catch { /* 下一次 refresh 会再试 */ }
      }
      return result
    })
    .catch(() => ({ ok: false, reason: 'patch 读取失败' }))
    .finally(() => { patchRowsInFlight = null })
  return patchRowsInFlight
}

/**
 * Every configured `mcp-client` entry: the file is the config fact, the Loader adds runtime.
 *
 * **文件优先，Loader 补运行态。** The file already contains the row we just wrote, while the
 * Loader may need seconds to reload it; reading the Loader first is what made a saved edit
 * appear only after "a while". `phase` still comes from the Loader, because only it knows
 * the fiber state. When it has not caught up, `phase` is empty and the card says 「连接中」,
 * which is the truth.
 */
export function configuredEntries(ctx: any) {
  const loader = loaderOf(ctx)
  const liveEntries = loader !== null && typeof loader.entries === 'function' ? [...(loader.entries() ?? [])] : null
  let entries = liveEntries
  const file = patchFileOf(ctx)
  if (file !== '') {
    let mtimeMs = -1
    try { mtimeMs = statSync(file).mtimeMs } catch { mtimeMs = -1 }
    if (mtimeMs >= 0) {
      if (patchRowsCache.file !== file || patchRowsCache.mtimeMs !== mtimeMs) {
        // 文件变了（或第一次看）：先发起读取，这一轮仍用 Loader 的视图。
        refreshPatchRows(file)
      } else if (patchRowsCache.entries !== null) {
        const live = new Map((liveEntries ?? []).map((entry) => [String(entry?.id ?? ''), entry]))
        entries = patchRowsCache.entries.map((entry: any) => {
          const running = live.get(String(entry.id))
          // 只借运行态字段，行的配置一律以文件为准。
          return running === undefined ? entry : { ...entry, fiber: running.fiber, disabled: entry.disabled ?? running.disabled }
        })
      }
    }
  }
  return { loaderFound: entries !== null, entries }
}

/** The mount path's view (real server fields) — same source as the panel list. */
export function configuredServers(ctx: any) {
  const { entries } = configuredEntries(ctx)
  if (entries === null) return []
  return serverRows(entries)
}

/**
 * The panel's view of every configured server, in the form its forms need.
 *
 * Built on {@link serverRows} so there is exactly one projection from rows to servers —
 * the panel used to receive a differently-shaped object than the mount path did, from a
 * different source (rows for global, `config.servers` for project), which is how the two
 * tiers drifted apart in the first place.
 *
 * `args`/`env`/`headersText` are the *form* shapes (one string, one `KEY=VALUE` per line);
 * `scope` travels with the row so the panel can split one list into its two tabs instead of
 * merging two arrays.
 */
export function configuredMcpRows(ctx: any) {
  const { loaderFound, entries } = configuredEntries(ctx)
  if (entries === null) return { loaderFound: false, rows: [] }
  try {
    const rows = serverRows(entries).map((server) => ({
      entryId: server.entryId,
      serverName: server.serverName,
      scope: server.scope,
      transport: server.transport,
      target: server.target,
      command: server.command,
      args: server.args.join(' '),
      env: Object.entries(server.env).map(([key, value]) => `${key}=${String(value)}`).join('\n'),
      headersText: Object.entries(server.headers).map(([key, value]) => `${key}=${String(value)}`).join('\n'),
      // Connection policy travels with the row so 编辑 can show what is set.
      ...connectionDraftOf(server),
      // 面板要能读回当前值，否则「编辑」永远显示默认，用户改过的看不出效果。
      runtime: server.runtime,
      enabled: server.enabled,
      phase: server.phase,
    }))
    return { loaderFound, rows }
  } catch (error: any) {
    return { loaderFound, rows: [] as any[], error: String(error?.message ?? error) }
  }
}

/**
 * Every MCP server name this panel can speak for.
 *
 * A filter may only judge names whose server the panel can actually see configured;
 * anything else is left alone, because the panel has no standing to drop a tool
 * belonging to a server it does not manage. The union covers both tiers: the
 * profile's own rows (Loader entries) and the panel's in-memory entries (global and
 * per-project).
 */
export function configuredServerNames(ctx: any, memoryServers: any = []) {
  const names = new Set()
  const { rows } = configuredMcpRows(ctx)
  for (const row of rows) {
    if (typeof row.serverName === 'string' && row.serverName !== '') names.add(row.serverName)
  }
  for (const server of Array.isArray(memoryServers) ? memoryServers : []) {
    if (typeof server?.serverName === 'string' && server.serverName !== '') names.add(server.serverName)
  }
  return [...names]
}
