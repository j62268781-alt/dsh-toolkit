// Verified DSH 0.2.1-rc.5 wire keys. turnBoundary is Host-only; approval
// has no wire projection and is observed through its scoped waterfall.
const KEYS = ['title', 'sessionListMetadata', 'inbox', 'goal', 'userQuestions']
const text = (value, limit = 240) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
const time = (value) => Number.isFinite(value) ? value : 0

/** Event-driven read-only summaries; never activates or follows a Session log. */
export function createActivityFeed(ctx, onChange = () => {}) {
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
  return {
    snapshot: () => current.map((row) => ({ ...row })), ready,
    dispose() {
      if (disposed) return
      disposed = true
      abort.abort()
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
