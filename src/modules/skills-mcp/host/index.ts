/**
 * Host half of the Skills & MCP panel.
 *
 * Two file-first sources of truth, one in-memory read model:
 *
 *   · skills → `<root>/<name>/SKILL.md`, written by the `POST /skills` route. There is no
 *     `config.skills[]` and no reconcile loop; the disk scan is the list.
 *   · MCP    → the profile patch's `mcp-client` rows. The `POST /rows` route writes them
 *     directly (lock + atomic write + backup), and `/runtime` reads the same file back.
 *
 * Commands (row CRUD, skill writes/read, reconnect, import) are HTTP request/response;
 * nothing transient is persisted. The only settings field left is `toolFilters`, a real
 * user preference. The read model (`/runtime`) is recomputed per request: rows from the
 * file, `phase` from the Loader, tools from the live registry, status from probe caches,
 * skills from the periodic scan.
 *
 * @module dsh-toolkit-skills-mcp
 */
import { join } from 'node:path'
import { RowOp, ReconnectRequest, ImportRequest } from './config.js'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { setHomeResolver } from './runtime/env.js'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { applyRowOp, migratePanelConfig, setPatchIO } from './patch/apply.js'
import { scanImportSource } from './import/scan.js'
import { registerImportRoute } from './import/route.js'
import { beat } from './diagnostics/heartbeat.js'
import { agentsHome } from './skills/reconcile.js'
import { createSkillsController } from './skills/controller.js'
import { serverMountConfig, setMountClient, workingDirectoryOf } from './project/mount.js'
import { GLOBAL_SCOPE, projectServersFor, serverRows, serverSetKey } from './mcp/serverRows.js'
import { toolsByServer } from './mcp/tools.js'
import { registerRuntimeRoute } from './mcp/runtime.js'
import { registerRowRoute } from './mcp/rows.js'
import { registerReconnectRoute } from './mcp/reconnect.js'
import { createServerObserver } from './mcp/observe.js'
import { installShadow, isMcpName, judge, liveToolNames } from './mcp/filter.js'

setMountClient(mcpClient)

setPatchIO({ withFileLock, writeFileAtomic })
setHomeResolver(resolveDshHome)

import { configuredWorkspaces, loaderOf, configuredServers, configuredMcpRows, configuredServerNames, refreshPatchRows, patchFileOf, setPatchRowsRefreshed } from './runtime/rows.js'
import { sleep } from '../../../host/time.js'
import { NAME as name } from './identity.js'
export { name }

/** The Loader is core, so requiring it costs nothing and never blocks startup. */
export const inject = ['loader']

export { Config } from './config.js'

/** The shipped mcp-client plugin, re-mounted per server inside this scope. */
const mcpPlugin = {
  name: mcpClient.name,
  apply: mcpClient.apply,
  inject: mcpClient.inject,
  Config: mcpClient.Config,
}

/**
 * Reconcile continuously.
 *
 * The settings page writes `.volatile()` fields straight into the running
 * config; that update never re-runs `apply`. So this half reads the live values
 * on a slow tick and re-applies only what actually changed — a save in the panel
 * takes effect within a couple of seconds, and the work stays idempotent.
 *
 * Global servers mount in the root scope (where a configured row lives, so every
 * agent sees their tools). Project servers mount in a matching agent's own scope
 * at `agent/created`, which is how the shipped client scopes tools per agent.
 */
export function apply(ctx: any, config: any) {
  /**
   * Every configured MCP server, from the profile patch's `mcp-client` rows.
   *
   * Both tiers come from here now. This used to read `config.servers`, a field this plugin
   * owned, while the global tier lived in rows — the same feature stored two ways, with the
   * panel merging two arrays to render one list and a scope-less registry read unable to
   * see project tools at all. Rows are the single source of truth; `scope` is the only
   * difference between the tiers (see `src/mcp/serverRows.js`).
   */
  // `entries()` is a **generator**, not an array: passing it straight to `serverRows`
  // (which requires an array) silently produced an empty list — every server looked
  // unconfigured, while the projection right next to it, which spreads first, saw all of
  // them. Spread here too, and never assume `Array.isArray` on a loader return value.
  const readServers = () => serverRows([...(loaderOf(ctx)?.entries?.() ?? [])])
  const readFilters = () => config?.toolFilters?.get?.() ?? config?.toolFilters ?? {}

  /**
   * The tool filter, installed before anything else in this plugin runs.
   *
   * Ordering is the whole ballgame: `dsh-mcp-client` registers a server's first
   * tool generation while it starts, and a plugin cannot unregister another
   * plugin's tools. This panel is a **bundle-layer** plugin while the MCP rows live
   * in the profile's own patch, and the profile composes bundle patches first — so
   * installing here, synchronously during `apply`, is what makes the shadow land
   * ahead of every MCP client.
   *
   * The rules are read through a getter on every registration rather than captured
   * once, so a panel edit takes effect without a restart (the settings document
   * writes these volatile fields straight into the live config).
   */
  const filterState: any = { installed: false, reason: '', dropped: [], preExisting: [] }
  const droppedNames: any = []
  /**
   * Server names the filter may speak for, cached.
   *
   * The judge runs once per tool registration, and reading the Loader's entries on
   * every one of them would walk the whole entry list for each tool of every
   * server. The set changes only when a row is added or removed, so it is refreshed
   * on the same slow tick that publishes the projection instead.
   */
  /**
   * The one-time server migration's outcome, published on the heartbeat.
   *
   * It has silently done nothing twice now — once because the field it reads looked empty,
   * once because the timer never ran — and both times the only symptom was "nothing
   * changed", which is indistinguishable from "nothing to do". So the outcome is a visible
   * field, the same technique that made the route installation and the entry rename
   * diagnosable.
   */
  const serverMigrationState = { status: 'pending', reason: '', migrated: 0, source: 0 }

  let filterServerNames: any = []
  const refreshFilterServers = (memoryServers: any) => {
    filterServerNames = configuredServerNames(ctx, memoryServers)
  }
  refreshFilterServers(readServers())
  const shadow = installShadow(
    ctx,
    (name: any) => {
      const verdict = judge(name, readFilters(), filterServerNames)
      if (!verdict.admit && typeof name === 'string' && droppedNames.length < 512 && !droppedNames.includes(name)) {
        droppedNames.push(name)
        filterState.dropped = [...droppedNames]
      }
      return verdict
    },
    { warn: (message: any) => ctx.logger.warn(message) },
  )
  filterState.installed = shadow.installed
  filterState.reason = shadow.reason
  if (shadow.installed) {
    filterState.preExisting = liveToolNames(ctx).filter(isMcpName)
    ctx.logger.info('dsh-toolkit-skills-mcp: MCP tool filter installed (%d pre-existing MCP tool(s))', filterState.preExisting.length)
  } else {
    // Reported, never swallowed: "filtering is off" and "filtering could not be
    // installed" look identical in the UI otherwise, and only one of them is the
    // user's configuration.
    ctx.logger.warn('dsh-toolkit-skills-mcp: MCP tool filter not installed — %s', shadow.reason)
  }
  ctx.effect(() => () => shadow.restore(), 'dsh-toolkit-skills-mcp.tool-filter')

  const observation = createServerObserver(ctx, {
    agents: () => agents, servers: () => committedServers,
  })
  const { oauth, recordMount, computeServerStatus, invalidateServerCaches } = observation
  const oauthStatusCache = oauth.statusCache

  let committedServers: any = []
  let committedServersKey: any = null
  /** Live agents, with the project servers mounted into each one's scope. */
  const agents = new Map()

  /** Mount one server into `host`, appending its disposer to `sink`. */
  const mountInto = (host: any, server: any, sink: any, where: any) => {
    const mountConfig = serverMountConfig(server)
    if (mountConfig === null) {
      ctx.logger.warn('dsh-toolkit-skills-mcp: server %s has no name/%s, skipped', server.id, server.transport === 'stdio' ? 'command' : 'url')
      return false
    }
    try {
      const fiber = host.plugin(mcpPlugin, mountConfig)
      recordMount(server.serverName, fiber)
      sink.push(typeof fiber === 'function' ? fiber : () => fiber?.dispose?.())
      ctx.logger.info('dsh-toolkit-skills-mcp: mounted mcp server %s (%s) in %s', server.serverName, mountConfig.transport, where)
      return true
    } catch (error: any) {
      ctx.logger.error('dsh-toolkit-skills-mcp: cannot mount mcp server %s in %s', server.serverName, where)
      ctx.logger.error(error)
      return false
    }
  }

  const unmount = (sink: any) => {
    for (const stop of sink.reverse()) {
      try {
        stop()
      } catch (error: any) {
        ctx.logger.warn('dsh-toolkit-skills-mcp: unmount failed')
        ctx.logger.warn(error)
      }
    }
    sink.length = 0
  }

  /**
   * Project tier: one agent's scope, re-derived whenever that agent or the config changes.
   *
   * There is no `mountGlobal` any more. Global rows are ordinary `mcp-client` rows, so the
   * Loader connects them itself; mounting them here as well would connect every server
   * twice — two clients, two tool generations, one namespace. What remains is the part only
   * this plugin can do: deciding which *project* rows belong to which agent, which no row
   * can express (a row is loaded once, and `!!js` sees no working directory).
   *
   * Mounts are tracked **per server**, not as one all-or-nothing list: editing context7's
   * URL used to unmount and reconnect every other project server in the same workspace,
   * because the only state was one key for the whole set. Keeping the unchanged server's
   * disposer means an edit touches exactly the edited server.
   */
  const mountForAgent = (agent: any, entry: any) => {
    const desired = projectServersFor(committedServers, entry.cwd)
    const desiredKeys = new Set()
    for (const server of desired) {
      const key = serverSetKey([server])
      desiredKeys.add(key)
      if (entry.mounted.has(key)) continue
      // Same server, new config: drop its previous instance first so it reconnects with
      // the new URL/headers instead of running both.
      for (const [oldKey, old] of [...entry.mounted]) {
        if (old.serverName === server.serverName) {
          unmount(old.stops)
          entry.mounted.delete(oldKey)
        }
      }
      const stops: any = []
      mountInto(agent.ctx, server, stops, `agent scope ${entry.cwd}`)
      entry.mounted.set(key, { serverName: server.serverName, stops })
    }
    for (const [key, mounted] of [...entry.mounted]) {
      if (desiredKeys.has(key)) continue
      unmount(mounted.stops)
      entry.mounted.delete(key)
    }
  }

  /** Every disposer one agent currently owns (heartbeat + cleanup). */
  const stopsOf = (entry: any) => [...entry.mounted.values()].flatMap((mounted) => mounted.stops)

  const attachAgent = (agent: any) => {
    if (agent === undefined || agent === null || agents.has(agent)) return
    const entry = { cwd: workingDirectoryOf(agent), mounted: new Map() }
    agents.set(agent, entry)
    mountForAgent(agent, entry)
  }

  const detachAgent = (agent: any) => {
    const entry = agents.get(agent)
    if (entry === undefined) return
    for (const mounted of entry.mounted.values()) unmount(mounted.stops)
    agents.delete(agent)
  }

  ctx.on('agent/created', ({ agent }: any) => attachAgent(agent))
  ctx.on('agent/disposed', ({ agent }: any) => detachAgent(agent))

  /**
   * Pick up agents that were already live before this plugin loaded.
   *
   * Subscribing to `agent/created` alone is not enough, and the gap is invisible: an event
   * only reaches a listener that was already registered, so a session that existed when this
   * plugin (re)loaded never fires one *here*. Its `agents` entry then never appears, which
   * means `mountForAgent` is never called for it — and a project server the user *did*
   * configure correctly is simply never mounted. The panel reports `unmounted`, which is
   * literally true and reads as "your config is wrong" while the config is fine.
   *
   * `ctx.agents.list()` is the registry itself, so this closes the gap regardless of how the
   * plugin's context relates to the one that created the agent. Called on every tick, it is
   * idempotent: `attachAgent` returns early for an agent it already tracks.
   */
  const adoptLiveAgents = () => {
    let registry = null
    try {
      registry = ctx.get?.('agents') ?? null
    } catch {
      // A bare service access throws in cordis before the service is injected.
      registry = null
    }
    if (registry === null || typeof registry.list !== 'function') return
    let live = []
    try {
      live = registry.list() ?? []
    } catch (error: any) {
      ctx.logger.warn('dsh-toolkit-skills-mcp: cannot list live agents: %s', String(error?.message ?? error))
      return
    }
    for (const agent of live) attachAgent(agent)
  }

  /** Written on every transition; the heartbeat file surfaces it for debugging. */
  let lastBeat: any = { at: '', observed: { servers: [] }, changed: {}, mounted: 0, agents: [] }
  const skills = createSkillsController(ctx, {
    agents, lastBeat: () => lastBeat, refresh: () => tick(),
  })

  /**
   * The agent a project server is mounted into, per server name.
   *
   * A project row's tools are registered in the *agent's* scope, so reading them needs that
   * exact agent[object] as the scope key — the same object `createScope` was minted with.
   * The first matching live agent wins, mirroring `computeServerStatus`'s `expected` map so
   * the tool list and the status label always describe the same agent.
   */
  const agentForServer = () => {
    const found = new Map()
    for (const [agent, entry] of agents) {
      if (typeof entry.cwd !== 'string' || entry.cwd === '') continue
      for (const server of projectServersFor(committedServers, entry.cwd)) {
        if (server.enabled !== false && typeof server.serverName === 'string' && !found.has(server.serverName)) {
          found.set(server.serverName, agent)
        }
      }
    }
    return found
  }

  /**
   * The panel's complete read model. Recomputed per request — nothing here is persisted.
   *
   * Three kinds of data, from three different sources, deliberately in one answer because
   * the browser has no other channel to reach the Host:
   *   · config rows  → the profile patch file (direct read, mtime cache; Loader adds `phase`)
   *   · tools/status → the live tool registry + probe caches (observational, TTL'd)
   *   · skills       → the periodic disk scan
   */
  const readRuntime = () => {
    const { rows } = configuredMcpRows(ctx)
    const plain = JSON.parse(JSON.stringify(rows))
    const names = plain.map((row: any) => row.serverName)
    // Global rows are instantiated by the Loader at the root, so the unscoped view is
    // exactly where their tools are. Everything else lives in an agent's scope and is
    // invisible to an unscoped read — which is why every project server used to report zero
    // tools while the card still said it was configured.
    const globalNames = plain.filter((row: any) => String(row.scope) === GLOBAL_SCOPE).map((row: any) => row.serverName)
    const projectNames = plain.filter((row: any) => String(row.scope) !== GLOBAL_SCOPE).map((row: any) => row.serverName)

    const byName = new Map()
    const globalInventory = toolsByServer(ctx, globalNames)
    if (globalInventory.ok) for (const entry of (globalInventory as any).servers) byName.set(entry.serverName, entry)

    const scopes = agentForServer()
    for (const name of projectNames) {
      const agent = scopes.get(name)
      // No live agent for this scope means the server is genuinely not mounted right now
      // (`computeServerStatus` reports the same situation as `unmounted`). Leaving it out of
      // `byName` is the honest answer: an empty list, not a fabricated one.
      if (agent === undefined) continue
      const scoped = toolsByServer(ctx, [name], agent)
      if (!scoped.ok) continue
      for (const entry of (scoped as any).servers) byName.set(entry.serverName, entry)
    }

    // A failed registry read is reported as a whole, exactly as before: "the registry is
    // unreadable" is a different fact from "this server exposes nothing".
    const inventory = globalInventory.ok
      ? { ok: true, servers: names.map((serverName: any) => byName.get(serverName) ?? { serverName, tools: [] }) }
      : globalInventory
    const serverTools = inventory.ok ? inventory.servers : []
    const serverToolsError = inventory.ok
      ? { reason: '', detail: '' }
      : { reason: String((inventory as any).reason ?? ''), detail: String((inventory as any).detail ?? '') }
    const toolCounts = new Map(serverTools.map((entry: any) => [entry.serverName, entry.tools.length]))
    const serverStatus = computeServerStatus({ rows: plain, entries: configuredServers(ctx), toolCounts })

    // The filter may only judge servers the panel can see; refresh the cached name set here
    // so a freshly added row is covered on the next registration.
    refreshFilterServers(readServers())
    const filter = {
      installed: filterState.installed,
      reason: filterState.reason,
      dropped: [...filterState.dropped],
      preExisting: [...filterState.preExisting],
    }
    // The probe's own health travels with the answer: "no server is down" and "we cannot
    // tell" must never render the same.
    const probeState = observation.readProbeState()

    const spaces = configuredWorkspaces(ctx).map((workspace: any) => ({
      ...workspace,
      agentsSkillsDir: workspace.path === '' ? '' : join(workspace.path, '.agents', 'skills'),
    }))
    const cwds = [...agents.values()].map((entry) => entry.cwd).filter((cwd) => typeof cwd === 'string' && cwd !== '')
    const skillDirs = {
      userDsh: join(resolveDshHome(), 'skills'),
      userAgents: join(agentsHome(), 'skills'),
    }

    // Per-server authorization state. Deliberately carries **no token material**: the panel
    // only needs "is there one, does it expire, do I need to click".
    const oauthServers: any = {}
    for (const server of plain) {
      if (String(server.transport ?? '') !== 'streamable-http') continue
      const serverName = String(server.serverName ?? '')
      if (serverName === '') continue
      const cached = oauthStatusCache.get(serverName)
      oauthServers[serverName] = cached === undefined
        ? { present: false, refreshable: false, waiting: false, authorizeUrl: '', expiresAt: '', expired: false, at: '' }
        : {
            present: cached.present === true,
            refreshable: cached.refreshable === true,
            waiting: cached.waiting === true,
            authorizeUrl: String(cached.authorizeUrl ?? ''),
            expiresAt: String(cached.expiresAt ?? ''),
            expired: cached.expired === true,
            at: String(cached.updatedAt ?? ''),
          }
    }

    return {
      serverTools,
      serverToolsError,
      serverStatus,
      servers: plain,
      skills: skills.discovered,
      skillDirs,
      workspaces: spaces,
      currentWorkspace: cwds[0] ?? '',
      filter,
      probe: probeState,
      oauth: {
        ready: oauth.ready.ready === true,
        reason: String(oauth.ready.reason ?? ''),
        detail: String(oauth.ready.detail ?? ''),
        sdkVersion: String(oauth.ready.sdkVersion ?? ''),
        redirectUri: oauth.redirectUri(),
        callbackReady: oauth.callbackReady,
        callbackPath: oauth.callbackPath,
        servers: oauthServers,
      },
      discovery: skills.discoveryInfo,
    }
  }
  // Optional injection keeps non-web profiles usable; never fall back to writing tools.
  ctx.inject(['webServer', 'connection'], (inner: any) => registerRuntimeRoute(inner, readRuntime))

  // ── One-time migration ──────────────────────────────────────────────────────────────
  //
  // Everything this panel used to keep in `config` (skills, legacy servers, projections)
  // becomes files: skills → `SKILL.md`, servers → profile rows. The write is one raw-patch
  // pass (lock → backup → atomic write, see `migratePanelConfig`), after which those keys no
  // longer exist in the profile patch. It must run before the first panel read; a failed
  // attempt retries on a slow tick, because a profile lock can be held at startup.
  ctx.effect(() => {
    let stopped = false
    let done = false
    const attempt = () => {
      if (done || stopped) return
      serverMigrationState.status = 'running'
      Promise.resolve(migratePanelConfig(ctx))
        .then((changed) => {
          done = true
          serverMigrationState.status = changed > 0 ? 'migrated' : 'nothing-to-do'
          serverMigrationState.migrated = changed
          try { tick() } catch { /* tick is declared below; the 2 s timer runs it anyway */ }
        })
        .catch((error) => {
          serverMigrationState.status = 'failed'
          serverMigrationState.reason = String(error?.message ?? error)
          ctx.logger.warn('dsh-toolkit-skills-mcp: migration failed: %s', serverMigrationState.reason)
        })
    }
    const timer = setTimeout(attempt, 800)
    const repeat = setInterval(attempt, 5000)
    return () => { stopped = true; clearTimeout(timer); clearInterval(repeat) }
  }, 'dsh-toolkit-skills-mcp.migration')

  skills.installScan()

  /**
   * patch 文件读完 —— 刷新运行态，让 /runtime 下一次就带上新行。
   *
   * 这里没有 settings 写入，也没有投影：行列表由 `/runtime` 现算；`phase` 由 Loader 合并。
   */
  setPatchRowsRefreshed(() => {
    try { tick() } catch { /* 下一次 tick 会再试 */ }
  })

  /** One command chain for every write route: no interleaved read-modify-write on the patch. */
  let commandChain = Promise.resolve()
  const serialized = (run: any) => {
    const next = commandChain.then(run, run)
    commandChain = next.catch(() => {})
    return next
  }

  // ── Row commands over HTTP ──────────────────────────────────────────────────────────
  //
  // The panel owns the profile patch's mcp-client rows. There is no queue any more: a
  // command either applies and answers with the resulting row list, or fails with a reason.
  ctx.inject(['webServer', 'connection'], (routeCtx: any) => registerRowRoute(routeCtx, {
    schema: (payload: any) => RowOp(payload),
    apply: async (op: any) => serialized(async () => {
      // Capture the server name(s) this command may affect **before** the write: a rename
      // has two, a delete only the old one. Their probe/auth caches must be invalidated or
      // the card keeps showing the old connection for up to the 12 s probe TTL.
      const bareId = (value: any) => String(value ?? '').replace(/^include:/, '')
      const targetId = bareId(op?.entryId)
      const findRow = (rows: any) => rows.find((row: any) => bareId(row.entryId) === targetId)
      const before = findRow(configuredMcpRows(routeCtx).rows)
      await applyRowOp(routeCtx, op)
      // Read the file back before answering: the client applies this list directly, so it
      // must not be the Loader view from before the write.
      const file = patchFileOf(routeCtx)
      if (file !== '') await refreshPatchRows(file, { force: true })
      const { rows } = configuredMcpRows(routeCtx)
      const after = findRow(rows)
      const affected = new Set([before?.serverName, after?.serverName].filter((name) => typeof name === 'string' && name !== ''))
      for (const serverName of affected) invalidateServerCaches(serverName)
      try {
        // The file is the stable source after our own write, so commit immediately instead
        // of waiting for two 2 s Loader observations. mountForAgent keeps unchanged project
        // servers mounted, so only the edited one reconnects.
        tick({ force: true })
      } catch (error: any) {
        routeCtx.logger.warn('dsh-toolkit-skills-mcp: post-command refresh failed: %s', String(error?.message ?? error))
      }
      return { ok: true, reason: '', servers: JSON.parse(JSON.stringify(configuredMcpRows(routeCtx).rows)) }
    }),
  }))

  // ── Reconnect ───────────────────────────────────────────────────────────────────────
  //
  // Why the instance has to be recreated instead of "nudged": the retry state lives inside
  // the client's closure (`failedAttempts`, `reconnectTimer`) and there is no API to reset
  // it. Worse, `dispose()` clears the pending reconnect timer, so once a server has given up
  // only a **new plugin instance** gets a fresh budget. Global rows are rebuilt by the
  // Loader (disable → wait for it to unload → enable); project rows are remounted by us.
  //
  // This is a command, not state: it is an HTTP request that answers when it is done. It is
  // never written into the profile patch, so a restart cannot replay it.
  const RECONNECT_STEP_TIMEOUT_MS = 25000

  const remountProject = (serverName: any) => {
    let touched = 0
    for (const [agent, entry] of agents) {
      const desired = projectServersFor(committedServers, entry.cwd)
      const wanted = desired.some((server) => server.serverName === serverName)
      let had = false
      // Only this server's instance is dropped; the rest of the agent's project servers
      // keep their connections (see mountForAgent's per-server bookkeeping).
      for (const [key, mounted] of [...entry.mounted]) {
        if (mounted.serverName !== serverName) continue
        unmount(mounted.stops)
        entry.mounted.delete(key)
        had = true
      }
      if (!wanted && !had) continue
      mountForAgent(agent, entry)
      touched += 1
    }
    return touched
  }

  /** The Loader's own view (for "did the disable actually take effect?"). */
  const loaderRows = () => serverRows([...(loaderOf(ctx)?.entries?.() ?? [])])

  // Deliberately **not** part of the row-command chain: a global reconnect legitimately
  // waits seconds for the Loader to unload the row, and blocking unrelated row edits for
  // that long would be worse than letting the two writes interleave (applyRowOp takes the
  // same file lock either way).
  const reconnectServer = async (request: any) => {
    const serverName = String(request?.serverName ?? '')
    const tier = String(request?.tier ?? '')
    if (serverName === '') return { ok: false, reason: '请求里没有服务器名' }
    try {
      if (tier === 'project') {
        const touched = remountProject(serverName)
        // 「连接断开」这条探测结论在重新挂载后也过期了。
        invalidateServerCaches(serverName)
        try { tick() } catch { /* 下一次 tick 会再试 */ }
        return touched === 0
          ? { ok: false, reason: `没有会话正在使用项目级服务器 ${serverName}，无需重连` }
          : { ok: true, reason: '' }
      }
      const row = configuredMcpRows(ctx).rows.find((item) => item.serverName === serverName)
      if (row === undefined || row.entryId === '') {
        return { ok: false, reason: `profile 里找不到服务器 ${serverName} 对应的行` }
      }
      if (row.enabled === false) {
        return { ok: false, reason: `服务器 ${serverName} 处于停用状态，先在面板里启用它` }
      }
      const entryId = row.entryId
      await applyRowOp(ctx, { op: 'toggle', entryId, enabled: false })
      const deadline = Date.now() + RECONNECT_STEP_TIMEOUT_MS
      let stopped = false
      while (Date.now() < deadline) {
        const live = loaderRows().find((item) => item.entryId === entryId)
        if (live === undefined || live.enabled === false) { stopped = true; break }
        await sleep(200)
      }
      // Re-enable even on timeout: leaving the row disabled would turn a failed reconnect
      // into a worse regression than the one the user was fixing.
      await applyRowOp(ctx, { op: 'toggle', entryId, enabled: true })
      try { tick() } catch { /* 下一次 tick 会再试 */ }
      return stopped
        ? { ok: true, reason: '' }
        : { ok: false, reason: '停用后未等到 Loader 卸载该行，已重新启用，请再试一次' }
    } catch (error: any) {
      ctx.logger.warn('dsh-toolkit-skills-mcp: reconnect failed: %s', String(error?.message ?? error))
      return { ok: false, reason: String(error?.message ?? error) }
    }
  }

  ctx.inject(['webServer', 'connection'], (reconnectCtx: any) => registerReconnectRoute(reconnectCtx, {
    schema: (payload: any) => ReconnectRequest(payload),
    run: reconnectServer,
  }))

  oauth.installSweep()

  skills.registerRoutes()

  oauth.registerRoutes({ invalidateServerCaches, reconnectServer })

  // ── MCP import: scan on request, answer with the preview ───────────────────────────
  //
  // A scan is a read of other tools' config files. It used to travel through settings
  // (request field → 600 ms poll → answer field); now it is one request/response.
  ctx.inject(['webServer', 'connection'], (importCtx: any) => registerImportRoute(importCtx, {
    schema: (payload: any) => ImportRequest(payload),
    scan: (request: any) => {
      const source = String(request?.source ?? '')
      const scope = request?.scope === 'global' ? 'global' : 'project'
      const project = String(request?.project ?? '')
      try {
        return { ok: true, source, scope, project, at: new Date().toISOString(), ...scanImportSource(scope, project, source) }
      } catch (error: any) {
        return { ok: false, source, scope, project, at: new Date().toISOString(), files: [], servers: [], error: String(error?.message ?? error) }
      }
    },
  }))

  let pendingServersKey: any = null
  let firstTick = true

  /**
   * Reconcile project mounts with the configured rows.
   *
   * Reads the **file-first** view, not the Loader's: after a panel write the file is already
   * current while the Loader may lag seconds behind, and waiting for it was why a saved edit
   * sat on the old connection.
   *
   * `force` is set by the row command that just wrote the patch: the config is stable and
   * known, so skip the "observe twice" debounce that exists only to survive transient
   * Loader recompositions. Unchanged servers are kept mounted by {@link mountForAgent}.
   */
  const tick = ({ force = false }: any = {}) => {
    // Before anything is decided: make sure every live agent is tracked. An agent that
    // predates this plugin's subscription never fires `agent/created` here, and an untracked
    // agent is an unmounted project server (see `adoptLiveAgents`).
    adoptLiveAgents()
    const servers = configuredServers(ctx)

    // Act only on a state observed twice in a row. A Loader recomposition can
    // mount this row with a transient empty config; acting on that would
    // unmount live servers that are still configured.
    //
    // The key deliberately ignores `phase`: the Loader updates it on its own schedule, and
    // a phase change is not a reason to tear down a working connection and rebuild it.
    const observedServersKey = serverSetKey(servers)
    let serversChanged = false
    if (force) {
      committedServers = servers
      committedServersKey = observedServersKey
      pendingServersKey = null
      serversChanged = true
      for (const [agent, entry] of agents) mountForAgent(agent, entry)
    } else if (observedServersKey === committedServersKey) {
      pendingServersKey = null
    } else if (observedServersKey === pendingServersKey) {
      committedServers = servers
      committedServersKey = observedServersKey
      pendingServersKey = null
      serversChanged = true
      for (const [agent, entry] of agents) mountForAgent(agent, entry)
    } else {
      pendingServersKey = observedServersKey
    }

    if (firstTick || serversChanged) {
      firstTick = false
      const mountedCount = [...agents.values()].reduce((total, entry) => total + stopsOf(entry).length, 0)
      lastBeat = {
        at: new Date().toISOString(),
        observed: { servers: servers.map((s) => s.serverName) },
        changed: { servers: serversChanged },
        // Only the project tier is mounted by this plugin now: global rows are connected by
        // the Loader, so counting them here would double-count what the Loader already owns.
        mounted: mountedCount,
        rootScope: Boolean(ctx.root && ctx.root !== ctx),
        agents: [...agents.values()].map((entry) => ({ cwd: entry.cwd, mounted: stopsOf(entry).length })),
        migration: { ...serverMigrationState },
        discovery: skills.discoveryInfo,
        lastOp: skills.lastOp,
      }
      // The heartbeat file is a diagnostic side channel: it is not the profile patch and is
      // safe to write from the Host.
      beat(lastBeat)
    }
  }

  ctx.effect(() => {
    tick()
    const timer = setInterval(tick, 2000)
    return () => {
      clearInterval(timer)
      for (const entry of agents.values()) {
        for (const mounted of entry.mounted.values()) unmount(mounted.stops)
      }
      agents.clear()
    }
  })
}
