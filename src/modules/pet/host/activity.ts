// Verified DSH 0.2.1-rc.5 wire keys. turnBoundary is Host-only; approval
// has no wire projection and is observed through its scoped waterfall.
const KEYS = ['title', 'sessionListMetadata', 'inbox', 'goal', 'userQuestions']
const text = (value: any, limit = 240): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const time = (value: any): number => Number.isFinite(value) ? value : 0
// 灵动岛/桌宠展示的是「实时活动」：结束或暂停的会话只留最近半小时，判定为「正在跑」的
// 最多留 6 小时 —— 否则几天前就停下的会话（典型是暂停的 goal、或崩溃前残留的 running）
// 会一直占着首屏，看着像「显示了一个旧会话」。等人的审批/提问则永不按时间淘汰。
const STALE_FINISHED = 30 * 60 * 1000
const STALE_RUNNING = 6 * 60 * 60 * 1000
const TICK = 60 * 1000

/** 一条待处理请求（审批 / 提问）。 */
interface PendingRequest {
  kind: string
  detail: string
}

/** 活动的内部行：把「会话摘要 + projection + 宿主状态」揉在一起。 */
interface ActivityRow {
  sessionId: string
  blank: boolean
  running: boolean
  updatedAt: number
  values: Record<string, any>
  versions: Record<string, number | undefined>
  pending: Map<symbol, PendingRequest>
  verified?: boolean
  error?: string
  origin?: string
  parentSessionId?: string
}

/** `facts()` 的结论，也是子会话聚合（`aggregate`）的单位。 */
interface ActivityFacts {
  running: boolean
  waiting: boolean
  pending: PendingRequest | undefined
  error: string | undefined
  detail: string
  updatedAt: number
}

/** 对外快照的一行（`snapshot()` 返回、灵动岛直接渲染）。 */
export interface ActivitySnapshotItem {
  id: string
  title: string
  status: string
  detail: string
  updatedAt: number
  running: boolean
  pendingKind?: string
}

export interface ActivityOptions {
  /** 用户已看过的会话：`sessionId → 看到时的活动时间`。 */
  seen?: Map<string, number>
  onSeen?: (sessionId: string, at: number) => void
}

export interface ActivityFeed {
  snapshot(): ActivitySnapshotItem[]
  markSeen(sessionId: string, at?: number): void
  ready: Promise<void>
  inspect(sessionId: string): any
  dispose(): void
}

/** `ctx` 是宿主插件上下文（形状由宿主决定），故显式 any。 */
export function createActivityFeed(ctx: any, onChange: () => void = () => {}, options: ActivityOptions = {}): ActivityFeed {
  // 用户已经点开看过的会话：记录「看到时的活动时间」。之后只要没有新动作（updatedAt 前进）
  // 或重新跑起来，就不该再以「有新结果 / 需要你处理」的形式占着灵动岛。
  const seen = options.seen instanceof Map ? options.seen : new Map<string, number>()
  const rows = new Map<string, ActivityRow>()
  const removals = new Set<string>()
  const disposers: (() => void)[] = []
  const abort = new AbortController()
  const boots: ReturnType<typeof setTimeout>[] = []
  // 会话摘要里的 running 是**持久化**的：DSH 被强杀/重启后，被杀掉那一回合的会话仍然带着
  // running:true，光看摘要就会永远显示「正在工作」。真正的运行回合一定对应本进程里活着的
  // Session，所以只信任「活会话 + 摘要」的交集，其余交给 api-session/status 事件。
  const liveIds = new Set<string>()
  // 本进程确实发过事件（added/status/activity/error）的会话才算「这几分钟内真跑过」：插件启动时
  // ctx.sessions.list() 可能还是空的，不能因为那一刻没列出来就把正在跑的会话当成结束态；
  // 反过来，摘要里持久化的 running 单独出现（重启后残留）也不足以说明它现在还在跑。
  const eventLive = new Set<string>()
  const LIVE_FRESH = 10 * 60 * 1000
  let refreshing = false
  let disposed = false
  let loading = true
  let journal: (() => void)[] = []
  let current: ActivitySnapshotItem[] = []
  const warn = (message: string, error: any): void => ctx.logger?.warn?.(`pet activity: ${message}: ${String(error)}`)
  const refreshLive = (): void => {
    liveIds.clear()
    try {
      for (const session of ctx.sessions.list()) liveIds.add(session.id)
    } catch (error) {
      warn('live session list unavailable', error)
    }
  }
  const ensure = (id: string): ActivityRow => {
    let row = rows.get(id)
    if (!row) {
      const session = ctx.sessions.get(id)
      row = { sessionId: id, blank: true, running: false, updatedAt: time(session?.header.createdAt), values: {}, versions: {}, pending: new Map(), ...headerFields(session) }
      rows.set(id, row)
    }
    return row
  }
  const mergeProjection = (row: ActivityRow, key: string, value: any, seq: number): void => {
    if (!KEYS.includes(key) || seq < (row.versions[key] ?? -Infinity)) return
    row.values[key] = value
    row.versions[key] = seq
    if (key === 'sessionListMetadata') {
      row.blank = value?.blank ?? row.blank
      row.updatedAt = Math.max(row.updatedAt, time(value?.lastPromptAt))
    }
  }
  const mergeSummary = (summary: any): void => {
    if (!summary?.sessionId) return
    const row = ensure(summary.sessionId)
    const { projections, ...fields } = summary
    Object.assign(row, fields)
    row.updatedAt = time(row.updatedAt)
    removals.delete(row.sessionId)
    const seq = projections?.kind === 'sequenced' ? projections.asOfSeq : -Infinity
    for (const key of KEYS) if (Object.hasOwn(projections?.values ?? {}, key)) mergeProjection(row, key, projections.values[key], seq)
  }
  // 摘要里的 running 是持久化状态，重启后可能残留。真正的权威来源是宿主会话状态
  // （sessionController.state 的 `running`），它对每个可见会话都是现算的。
  const refreshStates = async (): Promise<void> => {
    if (refreshing || disposed) return
    refreshing = true
    try {
      for (const row of rows.values()) {
        if (disposed) return
        try {
          const state = await ctx.sessionController.state({ sessionId: row.sessionId }, abort.signal)
          if (disposed) return
          row.verified = true
          row.running = Boolean(state?.running)
          if (row.running) row.error = undefined
        } catch {}
      }
    } finally {
      refreshing = false
    }
    publish()
  }
  const publish = (): void => {
    if (disposed) return
    refreshLive()
    const now = Date.now()
    const children = new Map<string, ActivityRow[]>()
    for (const row of rows.values()) {
      if (row.origin !== 'subagent' || !row.parentSessionId) continue
      const list = children.get(row.parentSessionId) ?? []
      list.push(row)
      children.set(row.parentSessionId, list)
    }
    const aggregate = (row: ActivityRow, seen = new Set<string>()): ActivityFacts => {
      // 成环保护：这个结果只参与下面的 `||=` 合并（waiting/detail/pending/error 都是「无」），不会进快照。
      if (seen.has(row.sessionId)) return { running: false, waiting: false, pending: undefined, error: undefined, detail: '', updatedAt: 0 }
      seen.add(row.sessionId)
      const own = facts(row, { liveIds, eventLive, now, freshMs: LIVE_FRESH })
      for (const child of children.get(row.sessionId) ?? []) {
        // 子行自己都陈旧了就不再参与聚合，否则几天前卡住的 subagent 会一直把父会话算成「正在跑」。
        if (now - child.updatedAt > STALE_RUNNING) continue
        const next = aggregate(child, seen)
        own.running ||= next.running
        if (next.waiting && !own.waiting) { own.waiting = true; own.detail = next.detail }
        own.error ||= next.error
        own.updatedAt = Math.max(own.updatedAt, next.updatedAt)
        if (next.pending && (!own.pending || next.pending.kind === 'permission')) own.pending = next.pending
      }
      return own
    }
    const next: ActivitySnapshotItem[] = []
    for (const row of rows.values()) {
      if (row.origin === 'subagent' || row.blank) continue
      const state = aggregate(row)
      // 等人处理的（审批 / 提问）无论多久都保留；其余按「正在跑 / 已结束」两个时间窗淘汰。
      if (!state.pending && now - state.updatedAt > (state.running ? STALE_RUNNING : STALE_FINISHED)) continue
      // 看过的结果不再提醒；出现新动作、重新跑起来、或等人处理时都会自己回到列表。
      if (!state.running && !state.pending && (seen.get(row.sessionId) ?? 0) >= state.updatedAt) continue
      const status = state.pending || state.waiting ? 'waiting' : state.running ? 'running' : state.error ? 'failed' : 'completed'
      next.push({ id: row.sessionId, title: text(row.values.title, 160) || 'Untitled session', status,
        detail: state.pending?.detail || (status === 'failed' ? text(state.error) : state.detail),
        updatedAt: state.updatedAt, running: state.running, ...(state.pending ? { pendingKind: state.pending.kind } : {}) })
    }
    const rank: Record<string, number> = { waiting: 0, running: 1, failed: 2, completed: 2 }
    next.sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    const bounded = next.slice(0, 20)
    if (JSON.stringify(bounded) === JSON.stringify(current)) return
    current = bounded
    try { onChange() } catch (error) { warn('subscriber failed', error) }
  }
  // 没有新事件时也要让过期会话自己消失（只依赖事件驱动的话，停止活动后就永远不会重算）。
  const tick = setInterval(() => { publish(); void refreshStates() }, TICK)
  tick.unref?.()
  const mutate = (operation: () => void): void => {
    if (disposed) return
    if (loading) journal.push(operation)
    operation()
    publish()
  }
  const listen = (event: string, callback: (...args: any[]) => any, options: any = {}): void => {
    const dispose = ctx.on(event, callback, { global: true, ...options })
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  listen('api-session/added', (summary) => mutate(() => {
    if (summary?.sessionId) eventLive.add(summary.sessionId)
    mergeSummary(summary)
  }))
  listen('api-session/status', (id, running) => mutate(() => {
    if (removals.has(id)) return
    // 能收到本进程的状态事件，本身就说明这个会话是活的（比摘要里的持久化 running 可信）。
    eventLive.add(id)
    const row = ensure(id)
    row.verified = true
    row.running = running
    if (running) { row.error = undefined; row.blank = false }
    row.updatedAt = Math.max(row.updatedAt, Date.now())
  }))
  listen('api-session/activity', (id, updatedAt) => mutate(() => {
    if (removals.has(id)) return
    eventLive.add(id)
    const row = ensure(id)
    row.updatedAt = Math.max(row.updatedAt, time(updatedAt))
    row.error = undefined
  }))
  listen('api-session/error', (id, error) => mutate(() => {
    if (removals.has(id)) return
    eventLive.add(id)
    const row = ensure(id)
    row.error = text(error) || 'Session failed'
    row.running = false
    row.updatedAt = Math.max(row.updatedAt, Date.now())
  }))
  listen('api-session/removed', (id) => mutate(() => { rows.delete(id); removals.add(id) }))
  disposers.push(ctx.sessionProjections.onChanged((session: any, key: string, value: any, seq: number) => {
    if (!KEYS.includes(key)) return
    mutate(() => {
      if (removals.has(session.id)) return
      const row = ensure(session.id)
      Object.assign(row, headerFields(session))
      mergeProjection(row, key, value, seq)
    })
  }))
  // Observe before an answerer consumes the waterfall. Delegate exactly once,
  // preserving its result or rejection; never grants or answers a request.
  for (const [event, kind] of [['approval/request', 'permission'], ['user-questions/request', 'question']]) {
    listen(event, async (request, next) => {
      const id = request.agent?.session?.id
      if (!id || disposed) return next()
      const token = Symbol(kind)
      mutate(() => ensure(id).pending.set(token, { kind, detail: kind === 'permission' ? text(request.reason) || 'Permission requested' : text(request.questions?.[0]?.question) || 'Answer requested' }))
      try { return await next() } finally { mutate(() => rows.get(id)?.pending.delete(token)) }
    }, { prepend: true })
  }
  const ready = (async (): Promise<void> => {
    try {
      const baseline = await ctx.sessionController.list({}, abort.signal)
      if (disposed) return
      rows.clear()
      removals.clear()
      for (const summary of baseline.items) mergeSummary(summary)
      // Cold list reads can yield. Replay notifications since subscription so
      // removals, status, and per-key projection versions win over old rows.
      for (const operation of journal) operation()
      for (const session of ctx.sessions.list()) {
        if (removals.has(session.id)) continue
        const row = ensure(session.id)
        Object.assign(row, headerFields(session))
        try {
          const block = ctx.sessionProjections.snapshot(session, KEYS)
          for (const key of KEYS) if (Object.hasOwn(block.values, key)) mergeProjection(row, key, block.values[key], block.asOfSeq)
        } catch (error) { warn(`projection baseline unavailable for ${session.id}`, error) }
      }
    } catch (error) {
      if (!disposed) warn('list baseline unavailable; continuing with live events', error)
    } finally {
      loading = false
      journal = []
      publish()
      // 插件往往比「当前会话恢复成活会话」更早启动：几次短延迟重算，别让真正在跑的会话
      // 因为那一刻还不在 live 集合里而被当成结束态。
      void refreshStates()
      for (const delay of [1500, 5000, 15000]) {
        const timer = setTimeout(publish, delay)
        timer.unref?.()
        boots.push(timer)
      }
    }
  })()
  const markSeen = (sessionId: string, at: number = Date.now()): void => {
    if (disposed || !sessionId) return
    seen.set(sessionId, at)
    try { options.onSeen?.(sessionId, at) } catch (error) { warn('seen persistence failed', error) }
    publish()
  }
  const inspect = (sessionId: string): any => {
    const row = rows.get(sessionId)
    if (!row) return undefined
    const inbox = row.values.inbox
    const counts = (value: any): number => (Array.isArray(value) ? value.length : value == null ? 0 : 1)
    return {
      running: row.running, verified: row.verified, updatedAt: row.updatedAt,
      inbox: inbox ? { 'next-turn': counts(inbox['next-turn']), 'next-step': counts(inbox['next-step']) } : null,
      goal: row.values.goal?.goal ? { phase: row.values.goal.goal.phase, roundsStarted: row.values.goal.roundsStarted, updatedAt: row.values.goal.updatedAt } : null,
      pending: row.pending.size,
    }
  }
  return {
    snapshot: () => current.map((row) => ({ ...row })), markSeen, ready, inspect,
    dispose() {
      if (disposed) return
      disposed = true
      abort.abort()
      clearInterval(tick)
      for (const timer of boots) clearTimeout(timer)
      boots.length = 0
      for (const dispose of disposers.reverse()) dispose?.()
      rows.clear()
      removals.clear()
      journal = []
      current = []
    },
  }
}

// 队列 / goal 顶替权威 running 的抗竞态窗口：跨回合只会差这么一瞬。
const QUEUE_GRACE = 20 * 1000

function headerFields(session: any): { origin?: string; parentSessionId?: string } {
  return session ? { origin: session.header.origin, parentSessionId: session.header.parentSession } : {}
}

interface FactsOptions {
  liveIds?: Set<string>
  eventLive?: Set<string>
  now?: number
  freshMs?: number
}

function facts(row: ActivityRow, { liveIds = new Set<string>(), eventLive = new Set<string>(), now = Date.now(), freshMs = 10 * 60 * 1000 }: FactsOptions = {}): ActivityFacts {
  const inbox = row.values.inbox
  const goal = row.values.goal
  // 队列里的输入不能单独证明「回合在跑」：真机上见过被中断的会话留着一条 next-step，
  // 宿主明明 running=false / queue=1，压了 4 分钟岛上还显示「正在工作」。
  // 所以队列与 goal 只允许在极短窗口内顶替权威 running（跨回合的那一瞬），
  // 超过窗口还没跑起来，说明它只是压在那里等人处理。
  const queueCount = (inbox?.['next-turn']?.length ?? 0) + (inbox?.['next-step']?.length ?? 0)
  const queued = queueCount > 0
  const quiet = now - row.updatedAt
  const starting = queued && quiet <= QUEUE_GRACE
  const activeGoal = goal?.goal?.phase === 'active'
  const exhausted = activeGoal && goal.roundsStarted >= goal.goal.maxGoalRounds
  // 「现在还在跑」= 本进程见过它的事件，或它确实是活会话且摘要刚刚更新过。
  const live = row.verified === true || eventLive.has(row.sessionId) || liveIds.has(row.sessionId) && quiet <= freshMs
  const runningNow = Boolean(row.running && live)
  const goalStarting = activeGoal && !exhausted && now - Math.max(row.updatedAt, time(goal?.updatedAt)) <= QUEUE_GRACE
  const stuckQueue = queued && !runningNow && !starting
  const pending: PendingRequest | undefined = [...row.pending.values()].sort((a, b) => (a.kind === 'permission' ? 0 : 1) - (b.kind === 'permission' ? 0 : 1))[0]
    ?? (row.values.userQuestions?.active?.length ? { kind: 'question', detail: text(row.values.userQuestions.active[0].questions?.[0]?.question) || 'Answer requested' } : undefined)
  const waiting = goal?.goal?.phase === 'paused' || goal?.goal?.phase === 'blocked' || exhausted && !row.running && !queued || stuckQueue
  return { running: Boolean(runningNow || starting || goalStarting), waiting, pending, error: row.error,
    detail: waiting ? stuckQueue ? 'Input queued' : text(goal?.goal?.blockedReason?.message) || (exhausted ? 'Goal round limit reached' : 'Goal paused') : queued ? 'Input queued' : goalStarting ? 'Goal in progress' : runningNow ? 'Working' : 'Turn finished',
    updatedAt: Math.max(row.updatedAt, time(goal?.updatedAt)) }
}
