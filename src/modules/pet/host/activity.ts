// Verified DSH 0.2.2-rc.5 wire keys. 只有声明了 `wire` 的投影才会被 snapshot 折叠、
// 也只有它们会推给插件：sessionStats / contextPressure / llmRetry / turnBoundary 都是
// Host-only（没有 wire），读它们只会拿到 undefined。所以「进度」只用可见的几项拼：
// turnOutline 给回合序号，contextBreakdown 给上下文构成，tokenUsage 给累计输出，
// todos 给当前在做的待办。工具数与工具耗时没有可见投影，只能回读日志，留给后续。
// approval 没有 wire 投影，靠自己的 scoped waterfall 观察。
const KEYS = ['title', 'sessionListMetadata', 'inbox', 'goal', 'userQuestions', 'turnOutline', 'contextBreakdown', 'tokenUsage', 'todos', 'conversationContinuation']
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

/**
 * 等人处理的原因。宿主把四种完全不同的处境都压成 `waiting`，岛上只显示「需要你处理」时，
 * 用户分不清是要他批准、要他回答问题，还是目标已经停了 —— 所以把原因单独带出来。
 */
export type WaitReason = 'approval' | 'question' | 'goal-paused' | 'goal-blocked' | 'goal-limit' | 'queued'

/**
 * 正在进行的进度：只挑有 `wire` 的投影，不需要回读日志。
 * 工具数与工具耗时来自 `sessionStats`，而它没有 wire、插件读不到，所以这里没有。
 */
export interface ActivityProgress {
  /** 本回合序号（`turnOutline` 最后一条的 `turn`）。 */
  turn?: number
  /** 当前在做的待办（`todos` 里 `in_progress` 那条的文案）。 */
  todo?: string
  /** 上下文大小（`contextBreakdown` 的系统/工具/消息三部分之和）。 */
  contextTokens?: number
  /** 整个会话累计输出 token（`tokenUsage.outputTokens`）。 */
  outputTokens?: number
  /** 正在跑的子会话数（聚合时统计，不在单行 facts 里算）。 */
  subagents?: number
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
  /** 最近一回合的结束原因：宿主不广播它，只能从会话日志尾页回读。 */
  ending?: { kind: string; seq: number }
}

/** `facts()` 的结论，也是子会话聚合（`aggregate`）的单位。 */
interface ActivityFacts {
  running: boolean
  waiting: boolean
  pending: PendingRequest | undefined
  error: string | undefined
  detail: string
  updatedAt: number
  waitReason: WaitReason | undefined
  queued: number
  interrupted: boolean
  progress: ActivityProgress
  /** 上一回合失败且可以空提示重跑（`conversationContinuation` 给了失败回合的 seq）。 */
  continuable: boolean
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
  waitReason?: WaitReason
  queued?: number
  progress?: ActivityProgress
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
  // 正在回读结束原因的会话（同一条会话不要并发读同一页日志）。
  const endings = new Set<string>()
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
      if (seen.has(row.sessionId)) return { running: false, waiting: false, pending: undefined, error: undefined, detail: '', updatedAt: 0, waitReason: undefined, queued: 0, interrupted: false, progress: {}, continuable: false }
      seen.add(row.sessionId)
      const own = facts(row, { liveIds, eventLive, now, freshMs: LIVE_FRESH })
      for (const child of children.get(row.sessionId) ?? []) {
        // 子行自己都陈旧了就不再参与聚合，否则几天前卡住的 subagent 会一直把父会话算成「正在跑」。
        if (now - child.updatedAt > STALE_RUNNING) continue
        const next = aggregate(child, seen)
        own.running ||= next.running
        if (next.waiting && !own.waiting) { own.waiting = true; own.detail = next.detail; own.waitReason = next.waitReason }
        own.error ||= next.error
        // 子代理并行时队列条数要累加，否则徽标只报主会话那一条。
        own.queued += next.queued
        own.interrupted ||= next.interrupted
        // 子代理正在跑时徽标要能看出「不止一个在干活」，否则并行度完全不可见。
        if (next.running) own.progress.subagents = (own.progress.subagents ?? 0) + 1
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
      // 重试中仍是「在跑」，所以只作为 running 的细分；可继续则是一个独立的结束态
      // （宿主清掉 error 事件后，只有 conversationContinuation 还记得上一回合是失败的）。
      const status = state.pending || state.waiting ? 'waiting'
        : state.running ? 'running'
        : state.error ? 'failed' : state.continuable ? 'continuable' : state.interrupted ? 'interrupted' : 'completed'
      next.push({ id: row.sessionId, title: text(row.values.title, 160) || 'Untitled session', status,
        detail: state.pending?.detail || (status === 'failed' ? text(state.error) : state.detail),
        updatedAt: state.updatedAt, running: state.running,
        ...(state.pending ? { pendingKind: state.pending.kind } : {}),
        ...(state.waitReason ? { waitReason: state.waitReason } : {}),
        ...(state.queued ? { queued: state.queued } : {}),
        ...(Object.keys(state.progress).length ? { progress: state.progress } : {}) })
    }
    const rank: Record<string, number> = { waiting: 0, running: 1, failed: 2, continuable: 2, interrupted: 2, completed: 2 }
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
  // turn/end 的 reason 只落在会话日志里（宿主不广播 turn/end），所以「用户按了停止」只能回读
  // 最后一页来区分。读不到就当作正常结束 —— 宁可漏报，也不凭空造出一个「已停止」。
  const readEnding = async (id: string): Promise<void> => {
    const controller = ctx.sessionController
    if (disposed || typeof controller?.events !== 'function' || endings.has(id)) return
    endings.add(id)
    try {
      const page = await controller.events({ address: { kind: 'session', sessionId: id }, maxMessages: 8 }, abort.signal)
      if (disposed) return
      const row = rows.get(id)
      if (!row) return
      let latest: { kind: string; seq: number } | undefined
      for (const record of page?.records ?? []) {
        const event = record?.event
        const kind = event?.type === 'turn/end' ? event.data?.reason?.kind : undefined
        if (typeof kind !== 'string' || (latest && event.seq <= latest.seq)) continue
        latest = { kind, seq: event.seq }
      }
      if (!latest || (row.ending && row.ending.seq >= latest.seq)) return
      row.ending = latest
      publish()
    } catch (error) {
      if (!disposed) warn(`turn ending unavailable for ${id}`, error)
    } finally {
      endings.delete(id)
    }
  }
  listen('api-session/added', (summary) => mutate(() => {
    if (summary?.sessionId) eventLive.add(summary.sessionId)
    mergeSummary(summary)
  }))
  listen('api-session/status', (id, running) => {
    mutate(() => {
      if (removals.has(id)) return
      // 能收到本进程的状态事件，本身就说明这个会话是活的（比摘要里的持久化 running 可信）。
      eventLive.add(id)
      const row = ensure(id)
      row.verified = true
      row.running = running
      // 新回合开始就丢掉上一回合的结束原因，否则「已停止」会一直挂在这条会话上。
      if (running) { row.error = undefined; row.blank = false; row.ending = undefined }
      row.updatedAt = Math.max(row.updatedAt, Date.now())
    })
    if (!running && !disposed) void readEnding(id)
  })
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
  // 等待的原因要一起带出去：徽标文案、图标、配色都靠它区分「要你批准」和「目标卡住了」。
  let waitReason: WaitReason | undefined
  if (pending) waitReason = pending.kind === 'permission' ? 'approval' : 'question'
  else if (goal?.goal?.phase === 'paused') waitReason = 'goal-paused'
  else if (goal?.goal?.phase === 'blocked') waitReason = 'goal-blocked'
  else if (exhausted && !row.running && !queued) waitReason = 'goal-limit'
  else if (stuckQueue) waitReason = 'queued'
  // 用户按了停止：回合正常收尾（completed/failed）与「被打断」在快照里必须能分开。
  const interrupted = !runningNow && !starting && !goalStarting && (row.ending?.kind === 'aborted' || row.ending?.kind === 'interrupted')
  // 失败回合被宿主折叠成「空提示可重跑」的 seq；error 事件不一定会留下来，所以它是独立信号。
  const continuable = !runningNow && !starting && !goalStarting && typeof row.values.conversationContinuation === 'number'
  const turns = row.values.turnOutline
  const lastTurn = Array.isArray(turns) && turns.length ? Number(turns[turns.length - 1]?.turn) : NaN
  const breakdown = row.values.contextBreakdown
  const contextTokens = breakdown ? Number(breakdown.systemTokens) + Number(breakdown.toolsTokens) + Number(breakdown.messageTokens) : NaN
  const outputTokens = Number(row.values.tokenUsage?.outputTokens)
  const todos = row.values.todos
  const activeTodo = Array.isArray(todos) ? todos.find((entry: any) => entry?.status === 'in_progress') : undefined
  const progress: ActivityProgress = {
    ...(Number.isFinite(lastTurn) ? { turn: lastTurn } : {}),
    ...(text(activeTodo?.content, 40) ? { todo: text(activeTodo?.content, 40) } : {}),
    ...(Number.isFinite(contextTokens) && contextTokens > 0 ? { contextTokens } : {}),
    ...(Number.isFinite(outputTokens) && outputTokens > 0 ? { outputTokens } : {}),
  }
  const detail = interrupted ? '' : waiting
    ? stuckQueue ? 'Input queued' : text(goal?.goal?.blockedReason?.message) || (exhausted ? 'Goal round limit reached' : 'Goal paused')
    : queued ? 'Input queued' : goalStarting ? 'Goal in progress' : runningNow ? 'Working' : 'Turn finished'
  return { running: Boolean(runningNow || starting || goalStarting), waiting, pending, error: row.error, detail,
    waitReason, queued: queueCount, interrupted, progress, continuable,
    updatedAt: Math.max(row.updatedAt, time(goal?.updatedAt)) }
}
