import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { findExecutableOnPath, createExecutableResolver } from '../../src/host/executable.js'
import { runProcess } from '../../src/host/process.js'
import { createOperation } from '../../src/host/operation.js'
import { Ledger } from '../../lib/modules/judgment/host/provider/ledger.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('runProcess does not spawn for a pre-aborted operation', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await runProcess('command-that-must-not-spawn', [], { signal: controller.signal })
  assert.equal(result.aborted, true)
  assert.equal(result.spawnError, undefined)
  assert.equal(result.code, null)
})

test('runProcess bounds combined stdout and stderr and reports the exceeded cap', async () => {
  const result = await runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(128))"], {
    timeoutMs: 2000,
    maxOutputBytes: 16,
    killGraceMs: 20,
  })
  assert.equal(result.outputLimitExceeded, true)
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 16)
})

test('runProcess closes inherited pipes after its deadline', async () => {
  const script = "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 800)'], { stdio: 'inherit' })"
  const started = Date.now()
  const result = await runProcess(process.execPath, ['-e', script], { timeoutMs: 80, killGraceMs: 20 })
  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 600, `inherited descriptors held process open for ${Date.now() - started}ms`)
})

test('executable lookup uses Windows PATH delimiters, joins, and executable suffixes', () => {
  const checked = []
  const result = findExecutableOnPath('agent-browser', {
    pathValue: 'C:\\tools;D:\\bin',
    platform: 'win32',
    exists: (candidate) => {
      checked.push(candidate)
      return candidate === 'D:\\bin\\agent-browser.com'
    },
  })
  assert.equal(result, 'D:\\bin\\agent-browser.com')
  assert.deepEqual(checked, [
    'C:\\tools\\agent-browser.exe', 'C:\\tools\\agent-browser.com',
    'D:\\bin\\agent-browser.exe', 'D:\\bin\\agent-browser.com',
  ])
})

test('executable resolver invalidation prevents an old in-flight generation overwriting new state', async () => {
  let calls = 0
  let finishOld
  const resolver = createExecutableResolver(() => {
    calls += 1
    if (calls === 1) return new Promise((resolve) => { finishOld = resolve })
    return '/new/agent-browser'
  })
  const old = resolver.resolve()
  resolver.invalidate()
  assert.equal(resolver.resolve(), '/new/agent-browser')
  finishOld('/old/agent-browser')
  assert.equal(await old, '/old/agent-browser')
  assert.equal(resolver.resolve(), '/new/agent-browser')
  assert.equal(calls, 2)
})

test('createOperation distinguishes parent cancellation and deadline and disposes its scope', async () => {
  const controller = new AbortController()
  const operation = createOperation({ timeoutMs: 1000, signal: controller.signal })
  controller.abort()
  assert.equal(operation.aborted, true)
  assert.equal(operation.timedOut, false)
  operation.dispose()

  const deadline = createOperation({ timeoutMs: 10 })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(deadline.timedOut, true)
  deadline.dispose()
})

test('token quota waiter cancellation removes its wait and permits a later reservation', async () => {
  const ledger = new Ledger({ enabled: false })
  const owner = await ledger.reserve([], ['connection:main'], () => {})
  const controller = new AbortController()
  const waiting = ledger.reserve([], ['connection:main'], () => {}, controller.signal)
  await tick()
  controller.abort()
  await assert.rejects(waiting, { name: 'AbortError' })

  await owner.release()
  const next = await ledger.reserve([], ['connection:main'], () => {})
  await next.release()
})

test('settlement releases token quota waiters after dispatch', async () => {
  const ledger = new Ledger({ enabled: false })
  const owner = await ledger.reserve([], ['connection:main'], () => {})
  const id = ledger.newId()
  await owner.start({
    id,
    at: new Date().toISOString(),
    kind: 'ask',
    connection: 'main',
    protocol: 'system-one',
    model: 'test',
    questionIds: [],
    stateBytes: 1,
  })
  const waiting = ledger.reserve([], ['connection:main'], () => {})
  await tick()
  let admitted = false
  const next = waiting.then((reservation) => { admitted = true; return reservation })
  await ledger.settle({ id, at: new Date().toISOString(), outcome: 'ok', latencyMs: 1, inputTokens: 4 })
  const reservation = await next
  assert.equal(admitted, true)
  await reservation.release()
  assert.equal((await ledger.usage()).get('connection:main').inputTokens, 4)
})
