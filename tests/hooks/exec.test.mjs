/** hooks 的执行层：平台 shell、输出解码、真实子进程的退出码语义。 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  decodeHookRun,
  mergeHookOutcomes,
  runHookCommand,
  shellInvocation,
} from '../../lib/modules/hooks/host/domain/exec.js'

const CWD = process.cwd()

/* ─────────────────────────── shell ─────────────────────────── */

test('shellInvocation：Windows 走 cmd.exe /d /s /c，其余走 sh -c', () => {
  assert.deepEqual(shellInvocation('echo hi', 'win32', { ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe' }), {
    command: 'C:\\WINDOWS\\system32\\cmd.exe',
    args: ['/d', '/s', '/c', 'echo hi'],
  })
  assert.deepEqual(shellInvocation('echo hi', 'win32', {}), { command: 'cmd.exe', args: ['/d', '/s', '/c', 'echo hi'] })
  assert.deepEqual(shellInvocation('echo hi', 'linux', {}), { command: '/bin/sh', args: ['-c', 'echo hi'] })
})

/* ─────────────────────────── 解码 ─────────────────────────── */

const run = (overrides = {}) => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...overrides })

test('解码：退出码 2 = 拒绝，理由取 stderr 第一行', () => {
  const denied = decodeHookRun('PreToolUse', run({ code: 2, stderr: '命令含有 rm -rf\n第二行' }))
  assert.equal(denied.decision, 'deny')
  assert.equal(denied.reason, '命令含有 rm -rf')
  assert.equal(denied.error, '')

  const noReason = decodeHookRun('PreToolUse', run({ code: 2 }))
  assert.equal(noReason.decision, 'deny')
  assert.ok(noReason.reason.includes('PreToolUse'), '没有 stderr 时给一句可读的默认理由')
})

test('解码：退出码 0 + JSON 的 decision 与 hookSpecificOutput 都认', () => {
  assert.deepEqual(
    decodeHookRun('PreToolUse', run({ stdout: '{"decision":"deny","reason":"policy"}' })),
    { decision: 'deny', reason: 'policy', additionalContext: [], error: '' },
  )
  assert.equal(
    decodeHookRun('Stop', run({ stdout: '{"decision":"block"}' })).decision,
    'deny',
    'block 是拒绝的别名',
  )
  const specific = decodeHookRun('PreToolUse', run({
    stdout: '{"hookSpecificOutput":{"permissionDecision":"ask","permissionDecisionReason":"先问我"}}',
  }))
  assert.equal(specific.decision, 'ask')
  assert.equal(specific.reason, '先问我')
})

test('解码：JSON 前后有日志时也能抠出对象；纯文本则当成追加的上下文', () => {
  assert.equal(
    decodeHookRun('PostToolUse', run({ stdout: 'log line\n{"additionalContext":"注意规范"}\n' })).additionalContext[0],
    '注意规范',
  )
  assert.deepEqual(
    decodeHookRun('SessionStart', run({ stdout: '你好，先读 AGENTS.md' })).additionalContext,
    ['你好，先读 AGENTS.md'],
  )
  assert.deepEqual(decodeHookRun('SessionStart', run({ stdout: '   ' })).additionalContext, [])
})

test('解码：其它退出码、超时、起不来都按不阻塞处理，但留下错误原因', () => {
  const failed = decodeHookRun('PreToolUse', run({ code: 1, stderr: 'boom' }))
  assert.equal(failed.decision, 'allow')
  assert.equal(failed.error, '退出码 1：boom')

  const timedOut = decodeHookRun('PreToolUse', run({ timedOut: true, code: null }))
  assert.equal(timedOut.decision, 'allow')
  assert.ok(timedOut.error.includes('超时'))

  const spawn = decodeHookRun('PreToolUse', run({ code: null, spawnError: new Error('ENOENT') }))
  assert.equal(spawn.decision, 'allow')
  assert.ok(spawn.error.includes('ENOENT'))
})

test('合并：拒绝 > 询问 > 放行，上下文按顺序拼接', () => {
  const base = { reason: '', additionalContext: [], code: 0, timedOut: false, durationMs: 0, stdout: '', stderr: '', error: '' }
  const merged = mergeHookOutcomes([
    { ...base, decision: 'allow', additionalContext: ['a'] },
    { ...base, decision: 'ask', reason: '确认一下', additionalContext: ['b'] },
  ])
  assert.equal(merged.decision, 'ask')
  assert.equal(merged.reason, '确认一下')
  assert.deepEqual(merged.additionalContext, ['a', 'b'])
  assert.equal(mergeHookOutcomes([{ ...base, decision: 'deny', reason: 'no' }, { ...base, decision: 'allow' }]).decision, 'deny')
  assert.deepEqual(mergeHookOutcomes([]), { decision: 'allow', reason: '', additionalContext: [] })
})

/* ─────────────────────────── 真跑 ─────────────────────────── */

test('真跑：stdin 载荷送到子进程（用 sort/cat 把输入原样回显）', async () => {
  // 不用 `echo {...}`：Windows 上 cmd 会把命令里的引号转义成 `\"`，
  // 回显出来的 JSON 带反斜杠。`sort` / `cat` 读的是 stdin，不受命令行转义影响。
  const result = await runHookCommand({
    event: 'PreToolUse',
    command: process.platform === 'win32' ? 'sort' : 'cat',
    timeoutMs: 30_000,
    payload: { hook_event_name: 'PreToolUse', tool_name: 'bash', cwd: CWD },
    cwd: CWD,
  })
  assert.ok(result.stdout.includes('"hook_event_name":"PreToolUse"'), result.stdout)
  assert.ok(result.stdout.includes('"tool_name":"bash"'), result.stdout)
})

test('真跑：stdout 的 JSON 变成决策（用夹具文件，避开命令行引号）', async () => {
  const fixture = join('tests', 'fixtures', 'hooks', 'deny.json')
  const result = await runHookCommand({
    event: 'PreToolUse',
    command: process.platform === 'win32' ? `type ${fixture}` : `cat ${fixture}`,
    timeoutMs: 30_000,
    payload: {},
    cwd: CWD,
  })
  assert.equal(result.decision, 'deny')
  assert.equal(result.reason, 'blocked by fixture')
  assert.equal(result.code, 0)
})

test('真跑：退出码 2 变成拒绝，时长与退出码都记下来', async () => {
  const result = await runHookCommand({
    event: 'PreToolUse',
    command: 'exit 2',
    timeoutMs: 30_000,
    payload: {},
    cwd: CWD,
  })
  assert.equal(result.decision, 'deny')
  assert.equal(result.code, 2)
  assert.ok(result.durationMs >= 0)
})

test('真跑：超时会被终止，结果按放行处理并标 timedOut', async () => {
  const sleeper = process.platform === 'win32' ? 'ping -n 6 127.0.0.1 > nul' : 'sleep 5'
  const result = await runHookCommand({
    event: 'Stop',
    command: sleeper,
    timeoutMs: 300,
    payload: {},
    cwd: CWD,
  })
  assert.equal(result.timedOut, true)
  assert.equal(result.decision, 'allow')
  assert.ok(result.error.includes('超时'))
})