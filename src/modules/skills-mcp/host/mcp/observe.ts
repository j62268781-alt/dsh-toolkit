import { GLOBAL_SCOPE, projectServersFor } from './serverRows.js'
import { fiberPhaseOf } from '../runtime/rows.js'
import { PROBE_STATE, createConnectionProbe } from './probe.js'
import { authDetailText } from './auth.js'
import { createAuthProbe } from './authprobe.js'
import { createOAuthController } from './oauth/controller.js'
import { SERVER_STATUS, deriveStatus, reconnectBudgetMs, remainingSeconds } from './status.js'
import { Singleflight } from '../../../../host/singleflight.js'

/** Observe live MCP connections without blocking the runtime read path. */
export function createServerObserver(ctx: any, { agents: readAgents, servers: readServers }: any) {
  /**
   * Connection probe: asks `mcpResources` what each server's state is.
   *
   * Deliberately a *caller* of the service rather than a hijack of it. The first
   * implementation shadowed `mcpResources.register`, which looked tidy and was wrong:
   * the profile recreates that service instance on recomposition, so a shadow written
   * once sat on a dead instance and captured nothing — while still reporting itself
   * installed. Calling the public `request()` re-resolves the provider on every probe
   * and cannot rot that way.
   *
   * This is what lets the panel warn about a server that quietly died. The client gives
   * up permanently once its retry budget runs out, and until then that was invisible:
   * the tools simply disappeared and nothing said whether the server was still retrying
   * or already dead.
   */
  const probe = createConnectionProbe(ctx, { warn: (message: any) => ctx.logger.warn(message) })
  if (!probe.available()) {
    // Reported, never swallowed: "no server is down" and "we cannot tell" must not look
    // the same, or the status tag would show a confident lie. The service can also appear
    // later (the profile composes rows after this plugin), so this is not fatal — the
    // availability check is re-run on every publish.
    ctx.logger.warn('dsh-toolkit-skills-mcp: MCP connection probe unavailable — %s', probe.reason())
  }

  /**
   * Auth-challenge probe: asks the server over HTTP whether it is demanding authorization.
   *
   * A separate detector from {@link probe} on purpose. The MCP client supports no OAuth at
   * all (no `authProvider` reaches the SDK), so a protected server's 401 is retried like a
   * network fault and finally reported as "gave up" — the panel would tell the user their
   * server is broken when all they need is to authorize it. `mcpResources.request()` cannot
   * see the 401 either: the client throws "server is disconnected" before any HTTP happens.
   *
   * See `src/mcp/authprobe.js` for why the probe has to be a real `initialize` POST.
   */
  const authProbe = createAuthProbe({ warn: (message: any) => ctx.logger.warn(message) })
  /** Last auth-challenge verdict per server: `{ at, challenge }`. null challenge = none seen. */
  const authCache = new Map()
  const authFlights = new Singleflight()

  const oauth = createOAuthController(ctx)
  const oauthStatusCache = oauth.statusCache
  const refreshOAuthStatus = oauth.refreshStatus

  /**
   * The auth probe runs on a much slower cadence than the connection probe.
   *
   * It makes a real HTTP round trip that can take seconds, and an authorization requirement
   * is not something that appears and disappears between ticks — while a connection state
   * genuinely flips quickly. So the cheap probe keeps its 12s TTL and this one takes minutes.
   */
  const AUTH_PROBE_TTL_MS = 120000

  /**
   * When each server was first seen not-connected, in epoch ms.
   *
   * The client keeps its own attempt counter in a closure, so elapsed time against
   * the configured budget is the only way to tell "still retrying" from "gave up".
   */
  const downSince = new Map()
  /** Last probe result per server: `{ at, state, detail }`. */
  const probeCache = new Map()
  const probeFlights = new Singleflight()
  const PROBE_TTL_MS = 12000

  /**
   * Ask a server for its state, at most once per TTL.
   *
   * Fire-and-forget on purpose: `publish` is synchronous and must not await a remote
   * round-trip. The tag renders from the last known answer, which is at most one TTL
   * stale — a few seconds on a status label nobody needs to the millisecond.
   *
   * The `agent` matters: a project server's provider is registered in that agent's
   * scope, and the service resolves it from the caller's scope. Probing without it
   * would report a mounted project server as absent.
   */
  const refreshProbe = (serverName: any, agent: any) => {
    if (!probe.available()) return
    const cached = probeCache.get(serverName)
    const now = Date.now()
    if (cached !== undefined && now - cached.at < PROBE_TTL_MS) return
    void probeFlights.run(serverName, () => probe.probe(serverName, { agent }), {
      onValue: (result: any) => probeCache.set(serverName, { at: Date.now(), state: result.state, detail: result.detail }),
      onError: (error: any) => probeCache.set(serverName, { at: Date.now(), state: PROBE_STATE.unknown, detail: String(error?.message ?? error) }),
    }).catch(() => {})
  }

  /**
   * Connected / not, from the last probe.
   *
   * `absent` counts as "not connected" **and** "no instance": the service answered that
   * there is no provider for this server, which is a fact about the mount, not about the
   * network. Everything still comes from the service, so nothing is inferred from the
   * mere absence of a tap firing.
   */
  const probeStateOf = (serverName: any) => {
    if (!probe.available()) return { connected: null, hasInstance: false, known: false }
    const cached = probeCache.get(serverName)
    if (cached === undefined) return { connected: null, hasInstance: false, known: false }
    if (cached.state === PROBE_STATE.connected) return { connected: true, hasInstance: true, known: true }
    if (cached.state === PROBE_STATE.down) return { connected: false, hasInstance: true, known: true }
    if (cached.state === PROBE_STATE.absent) return { connected: false, hasInstance: false, known: true }
    return { connected: null, hasInstance: false, known: false }
  }

  /**
   * Ask a server whether it is demanding authorization, at most once per TTL.
   *
   * Fire-and-forget like {@link refreshProbe}: `publish` is synchronous and must never
   * await a remote round trip. The verdict lands in `authCache` for a later tick.
   *
   * @param serverName - the MCP server name.
   * @param server - `{ transport, url, headers }` read from the row/entry that owns it.
   */
  const refreshAuth = (serverName: any, server: any) => {
    const cached = authCache.get(serverName)
    const now = Date.now()
    if (cached !== undefined && now - cached.at < AUTH_PROBE_TTL_MS) return
    void authFlights.run(serverName, () => authProbe.probe({ serverName, ...server }), {
      onValue: (challenge) => authCache.set(serverName, { at: Date.now(), challenge: challenge ?? null }),
      onError: () => authCache.set(serverName, { at: Date.now(), challenge: null }),
    }).catch(() => {})
  }

  /**
   * The last auth challenge for a server, or null.
   *
   * Deliberately not consulted while connected: a challenge is a cached observation, and a
   * live connection is the present fact. Letting a stale 401 outrank a working connection
   * would relabel a healthy server as needing authorization.
   */
  const authChallengeOf = (serverName: any) => authCache.get(serverName)?.challenge ?? null

  /**
   * 丢掉一台服务器**所有**的可观测缓存。
   *
   * 这些缓存各有各的 TTL（鉴权挑战 2 分钟、连接探测 12 秒、凭据状态 15 秒），存在的理由
   * 都是「别让 publish 去等一个远程往返」。但授权完成那一刻，它们的**每一条结论都过期了**：
   *
   *   · `authCache` 里还留着授权前那次 401 —— 不丢，卡片会继续显示「需要授权」两分钟；
   *   · `oauthStatusCache` 里还写着「没有凭据」—— 不丢，`hasCredentials` 就是 false，
   *     上面那条抑制也就不会生效；
   *   · `probeCache` 里还写着「连接断开」—— 不丢，重新挂载之后的第一次 publish 会拿旧
   *     结论去贴标签。
   *
   * 真机上表现就是「授权完了，状态还是需要授权」，而等到的往往只是下一个 TTL，不是
   * 任何真实的进展。授权是**明确的状态跃迁**，这类时刻必须主动失效，而不是等缓存过期。
   */
  const invalidateServerCaches = (serverName: any) => {
    authFlights.invalidate(serverName)
    probeFlights.invalidate(serverName)
    authCache.delete(serverName)
    probeCache.delete(serverName)
    oauth.invalidateStatus(serverName)
    oauthStatusCache.delete(serverName)
    downSince.delete(serverName)
  }
  /**
   * Mount fibers, per server name — the project tier's equivalent of a Loader row's
   * `phase`.
   *
   * Project servers are mounted by this plugin rather than by the Loader, so there is
   * no entry to read a phase from; keeping the fiber is what lets the status tell
   * "still activating" from "activation failed" instead of guessing. Disposal is
   * pruned lazily (a disposed fiber has no phase) because the three unmount paths
   * have different shapes and none of them should have to remember this bookkeeping.
   */
  const mountFibers = new Map()
  const recordMount = (serverName: any, fiber: any) => {
    if (typeof serverName !== 'string' || serverName === '') return
    if (fiber === null || typeof fiber !== 'object') return
    const set = mountFibers.get(serverName) ?? new Set()
    set.add(fiber)
    mountFibers.set(serverName, set)
  }

  /** Phase for a project server: active wins, then failed, then still-loading. */
  const mountedPhaseOf = (serverName: any) => {
    const set = mountFibers.get(serverName)
    if (set === undefined) return ''
    const phases = [...set].map(fiberPhaseOf).filter((phase) => phase !== '')
    if (phases.length === 0) return ''
    if (phases.includes('active')) return 'active'
    if (phases.includes('failed')) return 'failed'
    if (phases.includes('loading') || phases.includes('pending')) return 'loading'
    return phases[0]
  }

  /**
   * One status row per configured server, both tiers.
   *
   * Called on the publish tick. It never awaits anything: probes are kicked off and
   * their answers are consumed on a later tick, so a hung MCP server can slow a
   * label by seconds but can never stall the projection.
   *
   * `connected` merges two sources of different reach. The tool registry is the
   * cheap positive signal, but it is an **unscoped** view and project servers mount
   * into agent scopes, so their tools are invisible there — using it for both tiers
   * would report every project server as down. Hence: registry for global rows,
   * probe for everything.
   */
  const computeServerStatus = ({ rows, entries, toolCounts }: any) => {
    const now = Date.now()
    // A project server is only mounted for an agent whose cwd falls in its scope, so
    // "not mounted" is the normal state when no such session is open — not a fault.
    // The agent is kept because that is the scope its provider registered in, and the
    // probe has to run in the same scope to find it.
    const expected = new Map()
    for (const [agent, entry] of readAgents()) {
      if (typeof entry.cwd !== 'string' || entry.cwd === '') continue
      for (const server of projectServersFor(readServers(), entry.cwd)) {
        if (server.enabled !== false && typeof server.serverName === 'string' && !expected.has(server.serverName)) {
          expected.set(server.serverName, agent)
        }
      }
    }
    // Both tiers are rows now, and `readServers()` returns the whole list — so `rows` and
    // `entries` are the *same* list, and a row's own `scope` is what says which tier it
    // belongs to (see src/mcp/serverRows.js).
    //
    // Assuming `rows` = global and `entries` = project therefore published every server
    // twice: once as `tier: 'global'` and once as `tier: 'project'`. The panel matches a
    // card's status on tier **and** scope, so a project row could pick up the bogus global
    // entry — a status line about a connection that does not exist. `GLOBAL_SCOPE` is
    // where the truth lives, so the split is derived from `scope`, never assumed.
    // `serverRows` normalises an absent scope to `GLOBAL_SCOPE`, so a plain comparison is
    // enough here — no need to re-derive the default.
    const byScope = (list: any) => list.filter((row: any) => String(row.scope) === GLOBAL_SCOPE)
    const byProject = (list: any) => list.filter((row: any) => String(row.scope) !== GLOBAL_SCOPE)
    const targets = [
      ...byScope(rows).map((row: any) => ({
        tier: 'global', scope: '', serverName: String(row.serverName ?? ''),
        enabled: row.enabled !== false, expected: true, source: row,
        // The Loader's own verdict, which is what makes "activation failed" a fact
        // rather than an inference. See deriveStatus.
        phase: String(row.phase ?? ''),
        // The auth probe needs the connection parameters, which only the row carries.
        probeTarget: { transport: row.transport, url: row.target, headers: row.headersText },
      })),
      ...byProject(entries).map((entry: any) => ({
        tier: 'project', scope: String(entry.scope ?? ''), serverName: String(entry.serverName ?? ''),
        enabled: entry.enabled !== false,
        expected: expected.has(entry.serverName),
        agent: expected.get(entry.serverName),
        source: entry,
        phase: mountedPhaseOf(String(entry.serverName ?? '')),
        probeTarget: { transport: entry.transport, url: entry.url, headers: entry.headers },
      })),
    ]
    const reported = []
    const seen = new Set()
    for (const target of targets) {
      if (target.serverName === '') continue
      const key = `${target.tier}\u0000${target.scope}\u0000${target.serverName}`
      if (seen.has(key)) continue
      seen.add(key)
      const probed = probeStateOf(target.serverName)
      const hasInstance = probed.hasInstance
      const toolCount = toolCounts.get(target.serverName) ?? 0
      /**
       * Tools in the registry are proof of a live connection, for **both** tiers.
       *
       * This used to trust `toolCount` only for a global row, because an *unscoped* registry
       * read cannot see a project server's tools — so for a project row the count was
       * structurally 0 and the probe was treated as the only source. `readRuntime` now reads
       * project tools **in the agent's own scope**, so the count is real, and it is a stronger
       * signal than the probe: tools present means the server is talking to us, which is
       * exactly what "connected" claims.
       *
       * Issue #3 is the other side of the same coin: a project server that works fine showed
       * 「已放弃重试」 with `toolCount: 0`, because the status path kept asking a source that is
       * *designed* not to contain project rows.
       */
      const connected = toolCount > 0 ? true : probed.connected
      // On-disk authorization state is refreshed for every http server, connected or not:
      // the card has to show 「已授权」 vs 「需要授权」 regardless of the connection state, and
      // a token silently expiring is exactly the case where the label must change first.
      //
      // Read through `probeTarget` rather than the row: a global row's `target` is the
      // command line for stdio rows, so `transport` is the only reliable discriminator.
      if (String(target.probeTarget?.transport ?? '') === 'streamable-http') {
        const oauthUrl = String(target.probeTarget?.url ?? '')
        if (oauthUrl !== '') refreshOAuthStatus(target.serverName, oauthUrl)
      }
      if (connected !== true) {
        refreshProbe(target.serverName, target.agent)
        // Only asked while not connected. An authorization requirement is a *reason a
        // connection is being refused*, so it is meaningless — and, given the cache, stale —
        // once the server is actually talking to us.
        refreshAuth(target.serverName, target.probeTarget ?? {})
      }
      if (connected === true) {
        downSince.delete(target.serverName)
      } else if (!downSince.has(target.serverName)) {
        downSince.set(target.serverName, now)
      }
      const elapsedMs = connected === true ? 0 : Math.max(0, now - (downSince.get(target.serverName) ?? now))
      const budgetMs = reconnectBudgetMs(target.source)
      const authChallenge = connected === true ? null : authChallengeOf(target.serverName)
      const status = deriveStatus({
        enabled: target.enabled,
        expected: target.expected,
        observed: probe.available(),
        phase: target.phase,
        hasInstance,
        connected,
        elapsedMs,
        budgetMs,
        authChallenge,
        /**
         * 有凭据时，401 不再是「需要授权」：那是服务器不认这份令牌（或者端点根本不看
         * 这个头），点一百次授权也不会好。让它落到「未连接/重试中/已放弃」，用户才会去
         * 查服务器侧；而重新授权的入口一直在 `…` 菜单里，并没有因此消失。
         */
        hasCredentials: oauthStatusCache.get(target.serverName)?.present === true,
      })
      const cached = probeCache.get(target.serverName)
      reported.push({
        serverName: target.serverName,
        tier: target.tier,
        scope: target.scope,
        status,
        toolCount,
        elapsedMs,
        budgetMs,
        remainingSeconds: status === SERVER_STATUS.retrying ? remainingSeconds(elapsedMs, budgetMs) : 0,
        // A connected server has nothing to explain; an auth challenge explains itself in
        // words the protocol probe cannot produce ("不是故障" is the whole point).
        detail: status === SERVER_STATUS.connected
          ? ''
          : status === SERVER_STATUS.needsAuth
            ? authDetailText(authChallenge.kind, authChallenge)
            : String(cached?.detail ?? ''),
      })
    }
    return reported
  }


  const readProbeState = () => {
    return {
      installed: probe.available(),
      reason: probe.reason(),
      results: [...probeCache.entries()].map(([serverName, cached]) => ({
        serverName,
        state: String(cached?.state ?? ''),
        detail: String(cached?.detail ?? ''),
      })),
    }
  }

  return {
    oauth,
    recordMount,
    computeServerStatus,
    invalidateServerCaches,
    readProbeState,
  }
}
