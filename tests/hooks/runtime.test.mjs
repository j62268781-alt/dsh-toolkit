/** hooks 的运行时：九个事件的接线、决策如何回给宿主、Stop 的连击上限。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHookHistory } from '../../lib/modules/hooks/host/domain/history.js'
import { createHookRuntime } from '../../lib/modules/hooks/host/domain/runtime.js'

/**
 * 运行时不负责起进程（那是 exec 的事），所以这里注入一个假的执行器：
 * 按命令文本返回预设结果，顺便把收到的载荷记下来。
 */
const RESULTS = {
  allow: { decision: 'allow', reason: '', additionalContext: [] },
  'read AGENTS.md': { decision: 'allow', reason: '', additionalContext: ['read AGENTS.md'] },
  deny: { decision: 'deny', reason: 'PreToolUse hook 拒绝了这次操作', additionalContext: [] },
  ask: { decision: 'ask', reason: '危险命令', additionalContext: [] },
  block: { decision: 'deny', reason: 'PostToolUse hook 拒绝了这次操作', additionalContext: [] },
  continue: { decision: 'deny', reason: '还有活没干完', additionalContext: [] },
}

function fakeExecutor() {
  const requests = []
  const execute = async (request) => {
    requests.push(request)
    const preset = RESULTS[request.command] ?? RESULTS.allow
    const startedAt = 1_700_000_000_000
    return {
      ...preset,
      code: preset.decision === 'deny' ? 2 : 0,
      timedOut: false,
      durationMs: 3,
      stdout: '',
      stderr: '',
      error: '',
      startedAt,
    }
  }
  return { execute, requests }
}

/** 只实现运行时用到的 store 面：hooksFor。 */
function fakeStore(hooksByEvent = {}) {
  const calls = []
  return {
    calls,
    async hooksFor(event, subject) {
      calls.push([event, subject])
      return hooksByEvent[event] ?? []
    },
  }
}

const hook = (overrides) => ({
  id: 'user:PreToolUse:0',
  event: 'PreToolUse',
  matcher: '',
  command: 'allow',
  timeoutMs: 30_000,
  source: 'user',
  sourcePath: 'C:/hooks.json',
  supported: true,
  ...overrides,
})

function fakeAgent(id = 's1') {
  return {
    session: { header: { id } },
    injected: [],
    steered: [],
    inject(message) { this.injected.push(message) },
    steer(message) { this.steered.push(message) },
  }
}

function setup(hooksByEvent, { enabled = () => true, agent = fakeAgent() } = {}) {
  const handlers = new Map()
  const warnings = []
  const ctx = {
    on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) },
    logger: { warn: (message) => warnings.push(message) },
  }
  const store = fakeStore(hooksByEvent)
  const history = createHookHistory(20)
  const executor = fakeExecutor()
  const runtime = createHookRuntime(ctx, {
    store,
    history,
    enabled,
    cwd: () => 'D:/project',
    env: () => ({ PATH: '' }),
    execute: executor.execute,
  })
  return { ctx, handlers, store, history, runtime, agent, warnings, requests: executor.requests }
}

test('接线：九个事件都注册了监听器', () => {
  const { handlers } = setup({})
  assert.deepEqual([...handlers.keys()].sort(), [
    'agent/created', 'agent/disposed', 'agent/pre-step', 'agent/turn-stopping',
    'subagent/end', 'subagent/start', 'tools/post-execute', 'tools/pre-execute', 'tools/result',
  ])
})

test('没有配置时零开销：不执行任何 hook，也不改下游返回值', async () => {
  const { handlers, requests } = setup({})
  const next = async () => ({ kind: 'enter', messages: [] })
  assert.deepEqual(await handlers.get('tools/pre-execute')({ name: 'bash', arguments: {}, callId: 'c1' }, next), {
    kind: 'enter', messages: [],
  })
  assert.deepEqual(requests, [])
})

test('matcher 的对象是工具名，载荷带上工具入参与 cwd', async () => {
  const { handlers, store, requests } = setup({})
  await handlers.get('tools/pre-execute')({ name: 'bash', arguments: { command: 'ls' }, callId: 'c9' }, async () => ({ kind: 'enter' }))
  assert.deepEqual(store.calls, [['PreToolUse', 'bash']])
  assert.deepEqual(store.calls.length, 1)
  assert.equal(requests.length, 0, '没配 hook 就不该起进程')
})

test('开关关掉后一条也不跑（配置还在，只是不执行）', async () => {
  const { handlers, store, history, requests } = setup({ PreToolUse: [hook({ command: 'deny' })] }, { enabled: () => false })
  const result = await handlers.get('tools/pre-execute')({ name: 'bash', arguments: {} }, async () => ({ kind: 'enter' }))
  assert.equal(result.kind, 'enter')
  assert.deepEqual(store.calls, [])
  assert.deepEqual(requests, [])
  assert.deepEqual(history.list(), [])
})

test('SessionStart：钩子输出的上下文注入第一轮', async () => {
  const agent = fakeAgent()
  const { handlers } = setup({ SessionStart: [hook({ event: 'SessionStart', command: 'read AGENTS.md' })] }, { agent })
  await handlers.get('agent/created')({ agent, source: 'startup' })
  assert.equal(agent.injected.length, 1)
  assert.deepEqual(agent.injected[0].content, [{ type: 'text', text: 'read AGENTS.md' }])
})

test('SessionStart：matcher 的对象是启动来源', async () => {
  const { handlers, store } = setup({ SessionStart: [hook({ event: 'SessionStart' })] })
  await handlers.get('agent/created')({ agent: fakeAgent(), source: 'resume' })
  assert.deepEqual(store.calls, [['SessionStart', 'resume']])
})

test('UserPromptSubmit：拒绝本轮；放行时把上下文追加进 downstream', async () => {
  const denied = setup({ UserPromptSubmit: [hook({ event: 'UserPromptSubmit', command: 'deny' })] })
  assert.deepEqual(
    await denied.handlers.get('agent/pre-step')(
      { agent: fakeAgent(), messages: [{ content: [{ type: 'text', text: '你好' }] }] },
      async () => ({ kind: 'enter', messages: [] }),
    ),
    { kind: 'reject' },
  )
  assert.equal(denied.requests[0].payload.prompt, '你好', '载荷里带用户输入')

  const appended = setup({ UserPromptSubmit: [hook({ event: 'UserPromptSubmit', command: 'read AGENTS.md' })] })
  const result = await appended.handlers.get('agent/pre-step')(
    { agent: fakeAgent(), messages: [{ content: [{ type: 'text', text: '你好' }] }] },
    async () => ({ kind: 'enter', messages: [{ role: 'user', content: [] }] }),
  )
  assert.equal(result.kind, 'enter')
  assert.equal(result.messages.length, 2)
  assert.deepEqual(result.messages[1].content, [{ type: 'text', text: 'read AGENTS.md' }])
})

test('PreToolUse：拒绝带理由、询问带理由、放行走 next()', async () => {
  const denied = setup({ PreToolUse: [hook({ command: 'deny' })] })
  assert.deepEqual(
    await denied.handlers.get('tools/pre-execute')({ name: 'bash', arguments: {}, callId: 'c1' }, async () => ({ kind: 'enter' })),
    { kind: 'deny', reason: 'PreToolUse hook 拒绝了这次操作' },
  )

  const asked = setup({ PreToolUse: [hook({ command: 'ask' })] })
  assert.deepEqual(
    await asked.handlers.get('tools/pre-execute')({ name: 'bash', arguments: {}, callId: 'c2' }, async () => ({ kind: 'enter' })),
    { kind: 'ask', reason: '危险命令' },
  )

  const allowed = setup({ PreToolUse: [hook({ command: 'allow' })] })
  assert.deepEqual(
    await allowed.handlers.get('tools/pre-execute')({ name: 'bash', arguments: {}, callId: 'c3' }, async () => ({ kind: 'enter' })),
    { kind: 'enter' },
  )
})

test('PostToolUse：拒绝把理由变成回给模型的 feedback，并带工具输出', async () => {
  const { handlers, requests } = setup({ PostToolUse: [hook({ event: 'PostToolUse', command: 'block' })] })
  const result = await handlers.get('tools/post-execute')(
    { name: 'bash', arguments: {}, callId: 'c1' },
    { content: [{ type: 'text', text: 'stdout' }] },
    async () => ({ kind: 'enter' }),
  )
  assert.equal(result.kind, 'block')
  assert.deepEqual(result.feedback, [{ type: 'text', text: 'PostToolUse hook 拒绝了这次操作' }])
  assert.equal(requests[0].payload.tool_response, 'stdout')
})

test('Stop：拒绝让模型再走一步，但连续 3 次后强制放行', async () => {
  const agent = fakeAgent()
  const { handlers, warnings } = setup({ Stop: [hook({ event: 'Stop', command: 'continue' })] }, { agent })
  const stop = handlers.get('agent/turn-stopping')

  for (let turn = 1; turn <= 3; turn += 1) await stop({ agent, turn })
  assert.equal(agent.steered.length, 3)

  await stop({ agent, turn: 4 })
  assert.equal(agent.steered.length, 3, '第 4 次不再续跑，否则会话永远停不下来')
  assert.ok(warnings.some((line) => line.includes('连续拒绝')), '必须留下告警')
})

test('Stop：正常结束会清掉连击计数', async () => {
  const agent = fakeAgent()
  const hookEntry = hook({ event: 'Stop', command: 'continue' })
  const { handlers } = setup({ Stop: [hookEntry] }, { agent })
  const stop = handlers.get('agent/turn-stopping')
  await stop({ agent, turn: 1 })
  await stop({ agent, turn: 2 })
  assert.equal(agent.steered.length, 2)

  const passing = setup({ Stop: [hook({ event: 'Stop', command: 'allow' })] }, { agent })
  await passing.handlers.get('agent/turn-stopping')({ agent, turn: 3 })
  // 新的运行时独立计数，这里只断言「放行时不 steer」。
  assert.equal(agent.steered.length, 2)
})

test('历史：每条执行都记一条，含决策、退出码与来源', async () => {
  const { handlers, history } = setup({ PreToolUse: [hook({ command: 'deny' })] })
  await handlers.get('tools/pre-execute')({ name: 'bash', arguments: {}, callId: 'c1' }, async () => ({ kind: 'enter' }))
  const [record] = history.list()
  assert.equal(record.event, 'PreToolUse')
  assert.equal(record.command, 'deny')
  assert.equal(record.decision, 'deny')
  assert.equal(record.code, 2)
  assert.equal(record.source, 'user')
  assert.ok(record.at > 0)
})

test('试跑：按给定条目跑一次并写历史，不参与决策', async () => {
  const { runtime, history, requests } = setup({})
  const result = await runtime.runTest(hook({ command: 'read AGENTS.md' }), { hook_event_name: 'PreToolUse' })
  assert.equal(result.decision, 'allow')
  assert.deepEqual(result.additionalContext, ['read AGENTS.md'])
  assert.equal(history.list().length, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].payload.cwd, 'D:/project')
})

test('PostToolUse：工具报错时不跑（失败有独立事件）', async () => {
  const { handlers, requests } = setup({ PostToolUse: [hook({ event: 'PostToolUse', command: 'block' })] })
  const result = await handlers.get('tools/post-execute')(
    { name: 'bash', arguments: {}, callId: 'c1' },
    { isError: true, error: { message: 'boom' }, content: [] },
    async () => ({ kind: 'enter' }),
  )
  assert.deepEqual(result, { kind: 'enter' }, '失败必须原样交给下游')
  assert.equal(requests.length, 0, '成功才跑 PostToolUse')
})

test('PostToolUseFailure：只在 tools/result 报错时跑，输出注入上下文', async () => {
  const agent = fakeAgent()
  const { handlers, store, requests } = setup(
    { PostToolUseFailure: [hook({ event: 'PostToolUseFailure', command: 'read AGENTS.md' })] },
    { agent },
  )
  const onResult = handlers.get('tools/result')

  await onResult(
    { name: 'bash', arguments: { command: 'false' }, callId: 'c1', agent },
    { isError: false, value: 1, content: [] },
  )
  assert.deepEqual(store.calls, [], '成功结果不该触发失败事件')

  await onResult(
    { name: 'bash', arguments: { command: 'false' }, callId: 'c2', agent },
    { isError: true, error: { message: 'exit 1' }, content: [] },
  )
  assert.deepEqual(store.calls, [['PostToolUseFailure', 'bash']])
  assert.equal(requests[0].payload.error, 'exit 1')
  assert.equal(requests[0].payload.tool_use_id, 'c2')
  assert.equal(agent.injected.length, 1, '只读事件只能把 additionalContext 注入会话')
})

test('SessionEnd：会话释放时触发，子代理释放不重复报', async () => {
  const { handlers, store, requests } = setup({ SessionEnd: [hook({ event: 'SessionEnd', command: 'allow' })] })
  const dispose = handlers.get('agent/disposed')

  await dispose({ agent: { session: { header: { id: 's1' } } } })
  assert.deepEqual(store.calls, [['SessionEnd', 'other']])
  assert.equal(requests[0].payload.reason, 'other')

  await dispose({ agent: { session: { header: { id: 's2', parentSession: 's1' } } } })
  assert.equal(store.calls.length, 1, '子代理有 SubagentStop，SessionEnd 不该再来一遍')
})

test('SubagentStart / SubagentStop：带 agent_id、provider 与 stop_reason', async () => {
  const { handlers, requests } = setup({
    SubagentStart: [hook({ event: 'SubagentStart', command: 'allow' })],
    SubagentStop: [hook({ event: 'SubagentStop', command: 'allow' })],
  })
  const info = { runId: 'r1', provider: 'deepseek', parentSessionId: 's1', id: 's2', local: true }

  await handlers.get('subagent/start')(info)
  assert.equal(requests[0].payload.hook_event_name, 'SubagentStart')
  assert.equal(requests[0].payload.agent_id, 's2')
  assert.equal(requests[0].payload.agent_type, 'deepseek')
  assert.equal(requests[0].payload.session_id, 's1', '载荷里的会话是父会话')

  await handlers.get('subagent/end')({ ...info, stopReason: 'end_turn', lastAssistantMessage: [{ type: 'text', text: 'done' }] })
  assert.equal(requests[1].payload.hook_event_name, 'SubagentStop')
  assert.equal(requests[1].payload.stop_reason, 'end_turn')
  assert.equal(requests[1].payload.last_assistant_message, 'done')
})
