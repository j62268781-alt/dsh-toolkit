import test from 'node:test'
import assert from 'node:assert/strict'
import { createActivityFeed } from '../../src/modules/pet/host/activity.js'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const row = (sessionId, fields = {}, values = {}) => ({ sessionId, blank: false, running: false, updatedAt: Date.now() - 60_000, ...fields, projections: { kind: 'sequenced', asOfSeq: 1, values } })
function fixture(items = [], options = {}) {
  const listeners = new Map(), projections = new Set(), live = new Map(), values = new Map(), warnings = []
  let calls = 0, signal
  const ctx = {
    logger: { warn: (...args) => warnings.push(args) },
    on(event, listener, config) {
      const entry = { listener, config }
      const entries = listeners.get(event) ?? []
      entries.push(entry); listeners.set(event, entries)
      return () => entries.splice(entries.indexOf(entry), 1)
    },
    sessions: { get: (id) => live.get(id), list: () => [...live.values()] },
    sessionController: { list(request, inputSignal) { calls++; signal = inputSignal; assert.deepEqual(request, {}); return options.baseline ?? Promise.resolve({ items }) } },
    sessionProjections: {
      onChanged(listener) { projections.add(listener); return () => projections.delete(listener) },
      snapshot(session, keys) { assert.deepEqual(keys, ['title', 'sessionListMetadata', 'inbox', 'goal', 'userQuestions']); if (options.projectionError) throw new Error('projection unavailable'); return values.get(session.id) ?? { asOfSeq: 0, values: {} } },
    },
  }
  for (const item of items) live.set(item.sessionId, { id: item.sessionId, header: { origin: item.origin, parentSession: item.parentSessionId } })
  let notifications = 0
  const feed = createActivityFeed(ctx, () => { notifications++ }, options.feed)
  return { feed, ctx, warnings, listeners, projections,
    get calls() { return calls }, get signal() { return signal }, get notifications() { return notifications },
    emit(event, ...args) { for (const { listener } of listeners.get(event) ?? []) listener(...args) },
    project(id, key, value, seq = 2) { const session = live.get(id) ?? { id, header: {} }; for (const listener of projections) listener(session, key, value, seq) },
    live(id, header = {}, block = { asOfSeq: 2, values: {} }) { const session = { id, header }; live.set(id, session); values.set(id, block); return session },
    unlive(id) { live.delete(id) },
    request(event, request, next) { const [{ listener, config }] = listeners.get(event); assert.equal(config.global, true); assert.equal(config.prepend, true); return listener(request, next) },
  }
}

test('baseline excludes blank/subagent rows and preserves independent fork rows', async () => {
  const f = fixture([row('root', {}, { title: 'A title' }), row('blank', { blank: true }), row('child', { origin: 'subagent', parentSessionId: 'root', running: true }), row('fork', { parentSessionId: 'root' })])
  await f.feed.ready
  assert.deepEqual(f.feed.snapshot().map(({ id, status }) => ({ id, status })), [{ id: 'root', status: 'running' }, { id: 'fork', status: 'completed' }])
  assert.equal(f.feed.snapshot()[0].title, 'A title')
  assert.equal(f.calls, 1)
  f.feed.dispose()
})

test('permission and questions take precedence over running; observer preserves outcome', async () => {
  const f = fixture([row('a', { running: true })]); await f.feed.ready
  f.project('a', 'userQuestions', { active: [{ questions: [{ question: 'Choose?' }], state: 'continued' }] })
  assert.equal(f.feed.snapshot()[0].pendingKind, 'question')
  const answer = deferred(); let delegated = 0
  const pending = f.request('approval/request', { agent: { session: { id: 'a' } }, reason: 'Allow access?' }, () => { delegated++; return answer.promise })
  assert.equal(f.feed.snapshot()[0].status, 'waiting')
  assert.equal(f.feed.snapshot()[0].pendingKind, 'permission')
  assert.equal(f.feed.snapshot()[0].running, true)
  answer.resolve('allowed-once'); assert.equal(await pending, 'allowed-once'); assert.equal(delegated, 1)
  assert.equal(f.feed.snapshot()[0].pendingKind, 'question')
  f.project('a', 'userQuestions', { active: [] }, 3)
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.feed.dispose()
})

test('question waterfall rejection is preserved and removes transient pending state', async () => {
  const f = fixture([row('a')]); await f.feed.ready
  const answer = deferred(), failure = new Error('answerer failed')
  const pending = f.request('user-questions/request', { agent: { session: { id: 'a' } }, questions: [{ question: 'Question?' }] }, () => answer.promise)
  assert.equal(f.feed.snapshot()[0].pendingKind, 'question')
  answer.reject(failure); await assert.rejects(pending, (error) => error === failure)
  assert.equal(f.feed.snapshot()[0].status, 'completed')
  f.feed.dispose()
})

test('queued input and active goals prevent false completion between turns', async () => {
  const f = fixture([row('a')]); await f.feed.ready
  f.project('a', 'inbox', { 'next-turn': [{}], 'next-step': [] })
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.project('a', 'inbox', { 'next-turn': [], 'next-step': [] }, 3)
  f.project('a', 'goal', { goal: { phase: 'active', maxGoalRounds: 3 }, roundsStarted: 1, updatedAt: 100 })
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.emit('api-session/status', 'a', false)
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.project('a', 'goal', { goal: { phase: 'blocked', maxGoalRounds: 3, blockedReason: { message: 'Needs credentials' } }, roundsStarted: 1 }, 3)
  assert.equal(f.feed.snapshot()[0].status, 'waiting')
  assert.equal(f.feed.snapshot()[0].detail, 'Needs credentials')
  f.project('a', 'goal', { goal: { phase: 'active', maxGoalRounds: 3 }, roundsStarted: 3 }, 4)
  assert.equal(f.feed.snapshot()[0].status, 'waiting')
  f.emit('api-session/status', 'a', true)
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.emit('api-session/status', 'a', false)
  assert.equal(f.feed.snapshot()[0].status, 'waiting')
  f.project('a', 'goal', { goal: { phase: 'complete' }, roundsStarted: 3 }, 5)
  assert.equal(f.feed.snapshot()[0].status, 'completed')
  f.feed.dispose()
})

test('deep descendants aggregate and malformed lineage cycles terminate', async () => {
  const f = fixture([row('root'), row('child', { origin: 'subagent', parentSessionId: 'root' }), row('grandchild', { origin: 'subagent', parentSessionId: 'child', running: true }), row('cycle1', { origin: 'subagent', parentSessionId: 'cycle2' }), row('cycle2', { origin: 'subagent', parentSessionId: 'cycle1' })])
  await f.feed.ready
  assert.equal(f.feed.snapshot().length, 1)
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.emit('api-session/status', 'grandchild', false)
  assert.equal(f.feed.snapshot()[0].status, 'completed')
  f.project('grandchild', 'inbox', { 'next-step': [{}], 'next-turn': [] })
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.feed.dispose()
})

test('descendant failures and blocked goals stay visible on the main session', async () => {
  const f = fixture([row('root'), row('child', { origin: 'subagent', parentSessionId: 'root', running: true }), row('sibling', { origin: 'subagent', parentSessionId: 'root', running: true })]); await f.feed.ready
  f.emit('api-session/error', 'child', 'Child provider failed')
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.emit('api-session/status', 'sibling', false)
  assert.equal(f.feed.snapshot()[0].status, 'failed')
  assert.equal(f.feed.snapshot()[0].detail, 'Child provider failed')
  f.project('child', 'goal', { goal: { phase: 'blocked', blockedReason: { code: 'manual', message: 'Child needs input' } } })
  assert.equal(f.feed.snapshot()[0].status, 'waiting')
  assert.equal(f.feed.snapshot()[0].detail, 'Child needs input')
  f.project('child', 'userQuestions', { active: [{ questions: [{ question: 'Child question?' }] }] })
  assert.equal(f.feed.snapshot()[0].pendingKind, 'question')
  assert.equal(f.feed.snapshot()[0].detail, 'Child question?')
  f.feed.dispose()
})

test('live errors survive idle and clear on a new run or user activity', async () => {
  const f = fixture([row('a', { running: true })]); await f.feed.ready
  f.emit('api-session/error', 'a', 'Provider failed')
  f.emit('api-session/status', 'a', false)
  assert.equal(f.feed.snapshot()[0].status, 'failed')
  assert.equal(f.feed.snapshot()[0].detail, 'Provider failed')
  f.emit('api-session/status', 'a', true)
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.emit('api-session/error', 'a', 'Failed again'); f.emit('api-session/status', 'a', false)
  f.emit('api-session/activity', 'a', 300)
  assert.equal(f.feed.snapshot()[0].status, 'completed')
  f.feed.dispose()
})

test('baseline race retains adds, removals, status, pending, and newest projection sequence', async () => {
  const baseline = deferred(), f = fixture([], { baseline: baseline.promise })
  f.emit('api-session/status', 'a', true)
  f.project('a', 'title', 'New title', 10)
  f.emit('api-session/removed', 'removed')
  f.emit('api-session/added', row('new', { running: true }))
  const answer = deferred()
  const pending = f.request('approval/request', { agent: { session: { id: 'a' } } }, () => answer.promise)
  baseline.resolve({ items: [row('a', {}, { title: 'Old title' }), row('removed')] }); await f.feed.ready
  assert.deepEqual(f.feed.snapshot().map((item) => item.id), ['a', 'new'])
  assert.equal(f.feed.snapshot()[0].title, 'New title')
  assert.equal(f.feed.snapshot()[0].pendingKind, 'permission')
  assert.equal(f.feed.snapshot()[0].running, true)
  f.project('a', 'title', 'Out of order', 9)
  assert.equal(f.feed.snapshot()[0].title, 'New title')
  answer.resolve('cancelled'); await pending
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.feed.dispose()
})

test('exact attached snapshots replace stale cached list hints', async () => {
  const f = fixture([row('a', {}, { title: 'Hint' })])
  f.live('a', {}, { asOfSeq: 10, values: { title: 'Current', sessionListMetadata: { blank: false, lastPromptAt: 40 }, inbox: { 'next-turn': [{}], 'next-step': [] } } })
  await f.feed.ready
  assert.equal(f.feed.snapshot()[0].title, 'Current')
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.feed.dispose()
})

test('bounds recent output to twenty while prioritizing older waiting/running rows', async () => {
  const items = Array.from({ length: 30 }, (_, index) => row(`done-${index}`, { updatedAt: Date.now() - 60_000 + index }))
  items.push(row('busy', { running: true, updatedAt: Date.now() - 120_000 }), row('question', { updatedAt: Date.now() - 180_000 }, { userQuestions: { active: [{ questions: [] }] } }))
  const f = fixture(items); await f.feed.ready
  assert.equal(f.feed.snapshot().length, 20)
  assert.deepEqual(f.feed.snapshot().slice(0, 3).map((item) => item.id), ['question', 'busy', 'done-29'])
  const copy = f.feed.snapshot(); copy[0].title = 'Mutation'
  assert.notEqual(f.feed.snapshot()[0].title, 'Mutation')
  f.feed.dispose()
})

test('drops stale sessions, even stuck running ones, but never a pending request', async () => {
  const longAgo = Date.now() - 4 * 24 * 60 * 60 * 1000
  const f = fixture([
    row('old-paused', { updatedAt: longAgo }, { goal: { goal: { phase: 'paused', blockedReason: { message: 'stale' } } } }),
    row('old-done', { updatedAt: longAgo }),
    row('stuck-running', { running: true, updatedAt: longAgo }),
    row('question', { updatedAt: longAgo }, { userQuestions: { active: [{ questions: [{ question: 'Pick' }] }] } }),
    row('fresh-running', { running: true, updatedAt: Date.now() - 5 * 60_000 }),
    row('fresh-done', { updatedAt: Date.now() - 5 * 60_000 }),
    row('later-running', { running: true, updatedAt: Date.now() - 2 * 60 * 60_000 }),
  ])
  // 2 小时的长回合只有在本进程里见过它的状态事件时才算还在跑（摘要里过期的 running 不算）。
  f.emit('api-session/status', 'later-running', true)
  await f.feed.ready
  assert.deepEqual(f.feed.snapshot().map(({ id }) => id), ['question', 'later-running', 'fresh-running', 'fresh-done'])
  f.feed.dispose()
})

test('a stuck subagent cannot keep its ancient parent session alive', async () => {
  const longAgo = Date.now() - 4 * 24 * 60 * 60 * 1000
  const f = fixture([
    row('parent', { updatedAt: longAgo }),
    row('child', { origin: 'subagent', parentSessionId: 'parent', running: true, updatedAt: longAgo }),
  ]); await f.feed.ready
  assert.deepEqual(f.feed.snapshot(), [])
  f.feed.dispose()
})

test('a persisted running flag on a Session that is no longer live is not work', async () => {
  // DSH 被强杀后：被杀那一回合的摘要仍带 running:true，但本进程里没有对应活会话。
  const f = fixture([row('zombie', { running: true, updatedAt: Date.now() - 2 * 60_000 })])
  f.unlive('zombie'); await f.feed.ready
  assert.deepEqual(f.feed.snapshot().map(({ id, status, running, detail }) => ({ id, status, running, detail })),
    [{ id: 'zombie', status: 'completed', running: false, detail: 'Turn finished' }])
  // 真正开始跑：本进程收到状态事件就恢复成「正在工作」。
  f.emit('api-session/status', 'zombie', true)
  assert.deepEqual(f.feed.snapshot().map(({ id, status, detail }) => ({ id, status, detail })), [{ id: 'zombie', status: 'running', detail: 'Working' }])
  f.feed.dispose()
})

test('disposal aborts baseline, unregisters all listeners, and ignores late work', async () => {
  const baseline = deferred(), f = fixture([], { baseline: baseline.promise })
  f.emit('api-session/added', row('a'))
  const count = f.notifications
  f.feed.dispose(); f.feed.dispose()
  assert.equal(f.signal.aborted, true)
  assert.equal(f.projections.size, 0)
  assert.equal([...f.listeners.values()].flat().length, 0)
  baseline.resolve({ items: [row('late')] }); await f.feed.ready
  assert.deepEqual(f.feed.snapshot(), [])
  assert.equal(f.notifications, count)
})

test('baseline failures leave live events usable; projection failures are contained', async () => {
  const f = fixture([], { baseline: Promise.reject(new Error('list unavailable')) }); await f.feed.ready
  assert.equal(f.warnings.length, 1)
  f.emit('api-session/added', row('a', { running: true }))
  assert.equal(f.feed.snapshot()[0].status, 'running')
  f.feed.dispose()
  const g = fixture([row('b')], { projectionError: true }); g.live('b'); await g.feed.ready
  assert.equal(g.feed.snapshot()[0].id, 'b'); assert.equal(g.warnings.length, 1)
  g.feed.dispose()
})

test('a result the user already opened stops nagging until the session moves again', async () => {
  const persisted = []
  const f = fixture([row('done', {}, { title: 'Finished' }), row('busy', { running: true })], { feed: { onSeen: (id, at) => persisted.push([id, at]) } })
  await f.feed.ready
  assert.deepEqual(f.feed.snapshot().map(({ id }) => id).sort(), ['busy', 'done'])
  const opened = Date.now()
  f.feed.markSeen('done', opened)
  // 点开过的结果立刻从「实时活动」里消失，跑着的会话不受影响。
  assert.deepEqual(f.feed.snapshot().map(({ id }) => id), ['busy'])
  assert.deepEqual(persisted, [['done', opened]])
  // 该会话再出新动作（updatedAt 前进）时重新回到列表。
  f.emit('api-session/activity', 'done', opened + 1000)
  assert.deepEqual(f.feed.snapshot().map(({ id }) => id).sort(), ['busy', 'done'])
  f.feed.dispose()

  // 正在跑的会话即使被标记看过也继续显示；回到启动时的持久化状态同样有效。
  const g = fixture([row('busy', { running: true })])
  await g.feed.ready
  g.feed.markSeen('busy')
  assert.deepEqual(g.feed.snapshot().map(({ id }) => id), ['busy'])
  g.feed.dispose()
})
