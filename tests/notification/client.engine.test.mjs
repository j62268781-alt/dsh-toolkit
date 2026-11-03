/**
 * 引擎测试：把「会话在跑/跑完」「出现待交互」两种边沿分类成通知事件。
 *
 * 引擎是纯逻辑 + 注入端口，这里用可编程的假端口覆盖：
 * 完成 / 失败（turn-error 与 lastAgentError 两条判据）/ 宿主续跑的暂停 /
 * main-wait 等待后代 / 子会话静音 / 待交互 key 变化 / 未打开会话的物化。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotificationEngine } from '../../src/modules/notification/client/engine.js'

/** 一次列表快照。 */
function list(rows) {
  return { byId: Object.fromEntries(rows.map((row) => [row.id, { id: row.id, ...row }])) }
}

/** 可编程端口。 */
function createPorts(overrides = {}) {
  const emitted = []
  const details = new Map()
  const ports = {
    detailOf: (id) => details.get(id),
    ensureDetail: undefined,
    titleOf: (id) => `会话:${id}`,
    settle: async () => {},
    isSubagent: () => false,
    hasRunningDescendants: () => false,
    hasUnfinishedWork: () => false,
    emit: (event) => emitted.push(event),
    ...overrides,
  }
  return { ports, emitted, details }
}

/** 等引擎里 `void settleRun()` 的异步分支跑完。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('seed 只建立基线：插件加载前就在跑的会话不会补发通知', async () => {
  const { ports, emitted, details } = createPorts()
  details.set('s1', { finalText: '旧回复', maxTurnErrorSeq: 0, lastAgentError: null })
  const engine = new NotificationEngine(ports)
  engine.seed(list([{ id: 's1', running: true }, { id: 's2', running: false }]))
  assert.deepEqual(emitted, [])
  // 已经在跑的会话在 seed 时 armRun，跑完那一下仍会正常通知。
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].kind, 'completed')
})

test('完成：running true→false 时发出 completed，标题是会话标题、正文是最终回复', async () => {
  const { ports, emitted, details } = createPorts()
  const engine = new NotificationEngine(ports)
  engine.seed(list([{ id: 's1', running: false }]))
  engine.observe(list([{ id: 's1', running: true }]))
  details.set('s1', { finalText: '这是最后的回复', maxTurnErrorSeq: 0, lastAgentError: null })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.deepEqual(emitted, [{
    kind: 'completed',
    sessionId: 's1',
    title: '会话:s1',
    detail: '这是最后的回复',
  }])
})

test('失败判据一：本轮新增了 turn-error 节点', async () => {
  const { ports, emitted, details } = createPorts()
  const engine = new NotificationEngine(ports)
  engine.seed(list([{ id: 's1', running: false }]))
  details.set('s1', { finalText: '上一轮回复', maxTurnErrorSeq: 3, lastAgentError: null })
  engine.observe(list([{ id: 's1', running: true }]))
  details.set('s1', { finalText: '', maxTurnErrorSeq: 4, lastAgentError: 'boom', failureMessage: '工具调用失败' })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
  assert.deepEqual(emitted[0], { kind: 'failed', sessionId: 's1', title: '会话:s1', detail: '工具调用失败' })
})

test('失败判据二：lastAgentError 相对开跑基线变化', async () => {
  const { ports, emitted, details } = createPorts()
  const engine = new NotificationEngine(ports)
  engine.seed(list([{ id: 's1', running: false }]))
  details.set('s1', { finalText: '', maxTurnErrorSeq: 0, lastAgentError: '旧错误' })
  engine.observe(list([{ id: 's1', running: true }]))
  details.set('s1', { finalText: '', maxTurnErrorSeq: 0, lastAgentError: '新错误' })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].kind, 'failed')
  assert.equal(emitted[0].detail, '新错误')
})

test('宿主会自己续跑时，空闲边沿只是暂停，不通知', async () => {
  const { ports, emitted, details } = createPorts({ hasUnfinishedWork: (id) => id === 's1' })
  const engine = new NotificationEngine(ports)
  engine.seed(list([{ id: 's1', running: false }]))
  engine.observe(list([{ id: 's1', running: true }]))
  details.set('s1', { finalText: '中间回复', maxTurnErrorSeq: 0, lastAgentError: null })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.deepEqual(emitted, [])
})

test('main-wait：有后代在跑时先 hold，后代跑完后放行一次', async () => {
  let descendantRunning = true
  const { ports, emitted, details } = createPorts({ hasRunningDescendants: (id) => id === 's1' && descendantRunning })
  const engine = new NotificationEngine(ports)
  engine.setScope('main-wait')
  engine.seed(list([{ id: 's1', running: false }]))
  engine.observe(list([{ id: 's1', running: true }]))
  details.set('s1', { finalText: '主会话回复', maxTurnErrorSeq: 0, lastAgentError: null })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.deepEqual(emitted, [], 'must hold while a descendant runs')

  descendantRunning = false
  engine.observe(list([{ id: 's1', running: false }]))
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].kind, 'completed')
  assert.equal(emitted[0].detail, '主会话回复')
})

test('切到非 main-wait 范围时放行已 hold 的完成通知', async () => {
  const { ports, emitted, details } = createPorts({ hasRunningDescendants: () => true })
  const engine = new NotificationEngine(ports)
  engine.setScope('main-wait')
  engine.seed(list([{ id: 's1', running: false }]))
  engine.observe(list([{ id: 's1', running: true }]))
  details.set('s1', { finalText: '完成', maxTurnErrorSeq: 0, lastAgentError: null })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.deepEqual(emitted, [])
  engine.setScope('main')
  assert.equal(emitted.length, 1)
})

test('子会话在 main / main-wait 范围下静音；all 范围下照常通知', async () => {
  for (const scope of ['main', 'main-wait']) {
    const { ports, emitted, details } = createPorts({ isSubagent: (id) => id === 'child' })
    const engine = new NotificationEngine(ports)
    engine.setScope(scope)
    engine.seed(list([{ id: 'child', running: false }]))
    engine.observe(list([{ id: 'child', running: true }]))
    details.set('child', { finalText: '子代理回复', maxTurnErrorSeq: 0, lastAgentError: null })
    engine.observe(list([{ id: 'child', running: false }]))
    await tick()
    assert.deepEqual(emitted, [], `scope ${scope} must silence subagents`)
  }
  const { ports, emitted, details } = createPorts({ isSubagent: (id) => id === 'child' })
  const engine = new NotificationEngine(ports)
  engine.setScope('all')
  engine.seed(list([{ id: 'child', running: false }]))
  engine.observe(list([{ id: 'child', running: true }]))
  details.set('child', { finalText: '子代理回复', maxTurnErrorSeq: 0, lastAgentError: null })
  engine.observe(list([{ id: 'child', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
})

test('待交互：出现或替换 key 时通知，同 key 不重复，消失不通知', () => {
  const { ports, emitted } = createPorts()
  const engine = new NotificationEngine(ports)
  engine.setScope('all')

  engine.observePending(new Map([['s1', { key: 'q1', kind: 'question', detail: '继续吗？' }]]))
  assert.deepEqual(emitted, [{ kind: 'question', sessionId: 's1', title: '会话:s1', detail: '继续吗？' }])

  engine.observePending(new Map([['s1', { key: 'q1', kind: 'question', detail: '继续吗？' }]]))
  assert.equal(emitted.length, 1, 'same interaction must not re-alert')

  engine.observePending(new Map([['s1', { key: 'a1', kind: 'permission', detail: 'bash' }]]))
  assert.equal(emitted.length, 2)
  assert.deepEqual(emitted[1], { kind: 'permission', sessionId: 's1', title: '会话:s1', detail: 'bash' })

  engine.observePending(new Map())
  assert.equal(emitted.length, 2, 'an answered interaction raises nothing')
})

test('未打开过的会话：ensureDetail 返回的事实参与分类', async () => {
  const { ports, emitted, details } = createPorts()
  details.set('s1', { finalText: '', maxTurnErrorSeq: 0, lastAgentError: null })
  ports.ensureDetail = async () => ({ finalText: '物化后读到的回复', maxTurnErrorSeq: 0, lastAgentError: null })
  const engine = new NotificationEngine(ports)
  engine.setScope('all')
  engine.seed(list([{ id: 's1', running: false }]))
  engine.observe(list([{ id: 's1', running: true }]))
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].detail, '物化后读到的回复')
})

test('ensureDetail 抛错时仍然按现有快照分类', async () => {
  const { ports, emitted, details } = createPorts()
  details.set('s1', { finalText: '', maxTurnErrorSeq: 0, lastAgentError: null })
  ports.ensureDetail = async () => {
    throw new Error('could not open')
  }
  const engine = new NotificationEngine(ports)
  engine.setScope('all')
  engine.seed(list([{ id: 's1', running: false }]))
  engine.observe(list([{ id: 's1', running: true }]))
  // 开跑后宿主报出 agent 错误；物化失败不影响这条判据。
  details.set('s1', { finalText: '', maxTurnErrorSeq: 0, lastAgentError: 'agent 错误' })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].kind, 'failed')
})

test('会话从列表消失时清理跟踪状态，复用时重新建立基线', async () => {
  const { ports, emitted, details } = createPorts()
  details.set('s1', { finalText: '', maxTurnErrorSeq: 0, lastAgentError: null })
  const engine = new NotificationEngine(ports)
  engine.setScope('all')
  engine.seed(list([{ id: 's1', running: true }]))
  engine.observe(list([]))
  // 复用时先跑起来的这一轮以当时快照为基线（seq 5 属于历史错误）。
  details.set('s1', { finalText: '', maxTurnErrorSeq: 5, lastAgentError: null })
  engine.observe(list([{ id: 's1', running: true }]))
  // 这一轮又新增了错误：seq 6 > 基线 5 → 失败。
  details.set('s1', { finalText: '', maxTurnErrorSeq: 6, lastAgentError: null, failureMessage: '又失败了' })
  engine.observe(list([{ id: 's1', running: false }]))
  await tick()
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].kind, 'failed')
  assert.equal(emitted[0].detail, '又失败了')
})
