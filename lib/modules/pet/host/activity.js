// Verified DSH 0.2.1-rc.5 wire keys. turnBoundary is Host-only; approval
// has no wire projection and is observed through its scoped waterfall.
const KEYS = ['title', 'sessionListMetadata', 'inbox', 'goal', 'userQuestions']
const text = (value, limit = 240) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const time = (value) => Number.isFinite(value) ? value : 0
// 灵动岛/桌宠展示的是「实时活动」：结束或暂停的会话只留最近半小时，判定为「正在跑」的
// 最多留 6 小时 —— 否则几天前就停下的会话（典型是暂停的 goal、或崩溃前残留的 running）
// 会一直占着首屏，看着像「显示了一个旧会话」。等人的审批/提问则永不按时间淘汰。
const STALE_FINISHED = 30 * 60 * 1000
const STALE_RUNNING = 6 * 60 * 60 * 1000
const TICK = 60 * 1000

/** Event-driven read-only summaries; never activates or follows a Session log. */
export function createActivityFeed(ctx, onChange = () => {}, options = {}) {
  // 用户已经点开看过的会话：记录「看到时的活动时间」。之后只要没有新动作（updatedAt 前进）
  // 或重新跑起来，就不该再以「有新结果 / 需要你处理」的形式占着灵动岛。
  const seen = options.seen instanceof Map ? options.seen : new Map()
  const rows = new Map()
  const removals = new Set()
  const disposers = []
  const abort = new AbortController()
  let disposed = false
  let loading = true
  let journal = []
  let current = []
  const warn = (message, error) => ctx.logger?.warn?.(`pet activity: ${message}: ${String(error)}`)
  const ensure = (id) => {
    let row = rows.get(id)
    if (!row) {
      const session = ctx.sessions.get(id)
      row = { sessionId: id, blank: true, running: false, updatedAt: time(session?.header.createdAt), values: {}, versions: {}, pending: new Map(), ...headerFields(session) }
      rows.set(id, row)
    }
    return row
  }
  const mergeProjection = (row, key, value, seq) => {
    if (!KEYS.includes(key) || seq < (row.versions[key] ?? -Infinity)) return
    row.values[key] = value
    row.versions[key] = seq
    if (key === 'sessionListMetadata') {
      row.blank = value?.blank ?? row.blank
      row.updatedAt = Math.max(row.updatedAt, time(value?.lastPromptAt))
    }
  }
  const mergeSummary = (summary) => {
    if (!summary?.sessionId) return
    const row = ensure(summary.sessionId)
    const { projections, ...fields } = summary
    Object.assign(row, fields)
    row.updatedAt = time(row.updatedAt)
    removals.delete(row.sessionId)
    const seq = projections?.kind === 'sequenced' ? projections.asOfSeq : -Infinity
    for (const key of KEYS) if (Object.hasOwn(projections?.values ?? {}, key)) mergeProjection(row, key, projections.values[key], seq)
  }
  const publish = () => {
    if (disposed) return
    const now = Date.now()
    const children = new Map()
    for (const row of rows.values()) {
      if (row.origin !== 'subagent' || !row.parentSessionId) continue
      const list = children.get(row.parentSessionId) ?? []
      list.push(row)
      children.set(row.parentSessionId, list)
    }
    const aggregate = (row, seen = new Set()) => {
      if (seen.has(row.sessionId)) return { running: false, updatedAt: 0 }
      seen.add(row.sessionId)
      const own = facts(row)
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
    const next = []
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
    const rank = { waiting: 0, running: 1, failed: 2, completed: 2 }
    next.sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    const bounded = next.slice(0, 20)
    if (JSON.stringify(bounded) === JSON.stringify(current)) return
    current = bounded
    try { onChange() } catch (error) { warn('subscriber failed', error) }
  }
  // 没有新事件时也要让过期会话自己消失（只依赖事件驱动的话，停止活动后就永远不会重算）。
  const tick = setInterval(publish, TICK)
  tick.unref?.()
  const mutate = (operation) => {
    if (disposed) return
    if (loading) journal.push(operation)
    operation()
    publish()
  }
  const listen = (event, callback, options = {}) => {
    const dispose = ctx.on(event, callback, { global: true, ...options })
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  listen('api-session/added', (summary) => mutate(() => mergeSummary(summary)))
  listen('api-session/status', (id, running) => mutate(() => {
    if (removals.has(id)) return
    const row = ensure(id)
    row.running = running
    if (running) { row.error = undefined; row.blank = false }
    row.updatedAt = Math.max(row.updatedAt, Date.now())
  }))
  listen('api-session/activity', (id, updatedAt) => mutate(() => {
    if (removals.has(id)) return
    const row = ensure(id)
    row.updatedAt = Math.max(row.updatedAt, time(updatedAt))
    row.error = undefined
  }))
  listen('api-session/error', (id, error) => mutate(() => {
    if (removals.has(id)) return
    const row = ensure(id)
    row.error = text(error) || 'Session failed'
    row.running = false
    row.updatedAt = Math.max(row.updatedAt, Date.now())
  }))
  listen('api-session/removed', (id) => mutate(() => { rows.delete(id); removals.add(id) }))
  disposers.push(ctx.sessionProjections.onChanged((session, key, value, seq) => {
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
  const ready = (async () => {
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
    }
  })()
  const markSeen = (sessionId, at = Date.now()) => {
    if (disposed || !sessionId) return
    seen.set(sessionId, at)
    try { options.onSeen?.(sessionId, at) } catch (error) { warn('seen persistence failed', error) }
    publish()
  }
  return {
    snapshot: () => current.map((row) => ({ ...row })), markSeen, ready,
    dispose() {
      if (disposed) return
      disposed = true
      abort.abort()
      clearInterval(tick)
      for (const dispose of disposers.reverse()) dispose?.()
      rows.clear()
      removals.clear()
      journal = []
      current = []
    },
  }
}

function headerFields(session) {
  return session ? { origin: session.header.origin, parentSessionId: session.header.parentSession } : {}
}

function facts(row) {
  const inbox = row.values.inbox
  const queued = (inbox?.['next-turn']?.length ?? 0) + (inbox?.['next-step']?.length ?? 0) > 0
  const goal = row.values.goal
  const activeGoal = goal?.goal?.phase === 'active'
  const exhausted = activeGoal && goal.roundsStarted >= goal.goal.maxGoalRounds
  const waiting = goal?.goal?.phase === 'paused' || goal?.goal?.phase === 'blocked' || exhausted && !row.running && !queued
  const pending = [...row.pending.values()].sort((a, b) => (a.kind === 'permission' ? 0 : 1) - (b.kind === 'permission' ? 0 : 1))[0]
    ?? (row.values.userQuestions?.active?.length ? { kind: 'question', detail: text(row.values.userQuestions.active[0].questions?.[0]?.question) || 'Answer requested' } : undefined)
  return { running: Boolean(row.running || queued || activeGoal && !exhausted), waiting, pending, error: row.error,
    detail: waiting ? text(goal?.goal?.blockedReason?.message) || (exhausted ? 'Goal round limit reached' : 'Goal paused') : queued ? 'Input queued' : activeGoal ? 'Goal in progress' : row.running ? 'Working' : 'Turn finished',
    updatedAt: Math.max(row.updatedAt, time(goal?.updatedAt)) }
}
