/** 面板侧的纯投影：坏响应不白屏、分组跟着事件表走、时长与 matcher 的展示。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// 纯投影不碰 DOM/ctx，直接 import 源码（jsx-register 负责把 .ts 说明符解析到源码）。
import { formatDuration, groupHooks, matcherLabel, readSnapshot, runProblem } from '../../src/modules/hooks/client/model.ts'

const EVENTS = [
  { id: 'SessionStart', label: '会话开始', hint: '', matcher: 'source', supported: true },
  { id: 'PreToolUse', label: '工具调用前', hint: '', matcher: 'tool', supported: true },
]

test('readSnapshot：空响应与坏字段都退化成可用结构', () => {
  for (const payload of [undefined, null, 'text', 42, []]) {
    const view = readSnapshot(payload)
    assert.deepEqual(view.files, [])
    assert.deepEqual(view.hooks, [])
    assert.deepEqual(view.issues, [])
    assert.deepEqual(view.history, [])
    assert.equal(view.enabled, true, '读不到时按开启展示，避免误导用户以为被关掉了')
    assert.equal(view.readAt, 0)
  }
})

test('readSnapshot：缺字段的行补默认值（超时 60s、来源 user、决策 allow）', () => {
  const view = readSnapshot({
    hooks: [{ id: 'a', event: 'Stop', command: 'echo hi' }],
    files: [{ id: 'user' }],
    history: [{ id: 'r1', event: 'Stop' }],
  })
  assert.equal(view.hooks[0].timeoutMs, 60_000)
  assert.equal(view.hooks[0].source, 'user')
  assert.equal(view.hooks[0].supported, true)
  assert.equal(view.files[0].state, 'missing')
  assert.equal(view.history[0].decision, 'allow')
  assert.equal(view.history[0].timedOut, false)
})

test('readSnapshot：enabled=false 与 supported=false 不被真值判断吃掉', () => {
  const view = readSnapshot({ enabled: false, hooks: [{ id: 'a', event: 'Stop', supported: false }] })
  assert.equal(view.enabled, false)
  assert.equal(view.hooks[0].supported, false)
})

test('groupHooks：顺序跟事件表走，表外的事件名追加在后面且标成不支持', () => {
  const snapshot = readSnapshot({
    hooks: [
      { id: '1', event: 'PreToolUse', command: 'echo a' },
      { id: '2', event: 'NoSuchEvent', command: 'echo b' },
      { id: '3', event: 'PreToolUse', command: 'echo c' },
      { id: '4', event: 'SessionStart', command: 'echo d' },
    ],
  })
  const groups = groupHooks(snapshot, EVENTS)
  assert.deepEqual(groups.map((group) => group.event.id), ['SessionStart', 'PreToolUse', 'NoSuchEvent'])
  assert.deepEqual(groups[1].hooks.map((hook) => hook.command), ['echo a', 'echo c'])
  assert.equal(groups[2].event.supported, false)
})

test('groupHooks：没有钩子的事件不占位（空态由页面自己给模板）', () => {
  assert.deepEqual(groupHooks(readSnapshot({ hooks: [] }), EVENTS), [])
})

test('formatDuration：毫秒与秒两档，非法值给破折号', () => {
  assert.equal(formatDuration(0), '0 ms')
  assert.equal(formatDuration(42.6), '43 ms')
  assert.equal(formatDuration(1_500), '1.5 s')
  assert.equal(formatDuration(Number.NaN), '—')
  assert.equal(formatDuration(-1), '—')
})

test('matcherLabel：空串与 * 都显示「全部」，其余原样', () => {
  assert.equal(matcherLabel('', '全部'), '全部')
  assert.equal(matcherLabel('  ', '全部'), '全部')
  assert.equal(matcherLabel('*', '全部'), '全部')
  assert.equal(matcherLabel('bash', '全部'), 'bash')
})

const LABELS = { timedOut: '超时', exit: (code) => `退出码 ${code}` }

test('runProblem：起不来时显示 error，而不是「退出码 null」', () => {
  const problem = runProblem(
    { id: '1', at: 0, event: 'Stop', command: 'x', source: 'user', decision: 'allow', durationMs: 3, code: null, timedOut: false, reason: '', error: '启动失败：spawn ENOENT' },
    LABELS,
  )
  assert.deepEqual(problem, { text: '启动失败：spawn ENOENT', tone: 'error' })
})

test('runProblem：失败优先于理由，超时优先于退出码', () => {
  const base = { id: '1', at: 0, event: 'Stop', command: 'x', source: 'user', decision: 'allow', durationMs: 3, code: 0, timedOut: false, reason: '', error: '' }
  assert.deepEqual(runProblem({ ...base, code: 2, reason: 'blocked by guard' }, LABELS), { text: '退出码 2', tone: 'error' })
  assert.deepEqual(runProblem({ ...base, code: 2, timedOut: true }, LABELS), { text: '超时', tone: 'error' })
  assert.deepEqual(runProblem({ ...base, decision: 'deny', reason: 'blocked by guard' }, LABELS), { text: 'blocked by guard', tone: 'reason' })
  assert.deepEqual(runProblem(base, LABELS), { text: '', tone: 'none' })
  assert.deepEqual(runProblem({ ...base, reason: '   ' }, LABELS), { text: '', tone: 'none' }, '空白理由不算理由')
})