import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptConfigWrite } from '../../src/client/config-write.ts'
import { createLatestTask } from '../../src/client/latest-task.ts'
import { startPolling } from '../../src/client/poll.ts'
import { fetchJson } from '../../src/client/http.ts'
import { anchorStyle, listenMenuDismiss, measureMenuAnchor } from '../../src/client/ui/components/menu/index.ts'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('configuration acceptance distinguishes rejection from legacy undefined success', async () => {
  for (const result of [true, undefined]) assert.equal(await acceptConfigWrite(() => result, 'connections'), result)
  await assert.rejects(acceptConfigWrite(async () => false, 'connections'), /宿主拒绝.*connections/)
  await assert.rejects(acceptConfigWrite(() => { throw new Error('not writable') }, 'x'), /not writable/)
})

test('replacing or invalidating a read aborts its transport and rejects a late commit', async () => {
  const owner = createLatestTask()
  const first = owner.begin()
  const second = owner.begin()
  assert.equal(first.signal.aborted, true)
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  owner.invalidate()
  assert.equal(second.isCurrent(), false)
  assert.equal(second.signal.aborted, true)
  assert.equal(owner.begin().isCurrent(), true)
})

test('polling coalesces concurrent refreshes and aborts on stop without rearming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = deferred()
  const signals = []
  const poll = startPolling(signal => { signals.push(signal); return gate.promise }, { intervalMs: 10 })
  await Promise.resolve()
  const one = poll.refresh(), two = poll.refresh()
  assert.equal(one, two)
  t.mock.timers.tick(100)
  assert.equal(signals.length, 1)
  poll.stop()
  assert.equal(signals[0].aborted, true)
  gate.resolve()
  await one
  t.mock.timers.tick(100)
  assert.equal(signals.length, 1)
})

test('polling recovers from an error and waits one interval after settlement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = [], signals = []
  const poll = startPolling(signal => {
    signals.push(signal)
    if (signals.length === 1) throw new Error('temporary')
  }, { intervalMs: 10, onError: error => errors.push(error.message) })
  await poll.refresh()
  assert.deepEqual(errors, ['temporary'])
  t.mock.timers.tick(9)
  assert.equal(signals.length, 1)
  t.mock.timers.tick(1)
  await poll.refresh()
  assert.equal(signals.length, 2)
  poll.stop()
})

test('JSON transport preserves admission handling and consumes a body once', async t => {
  const calls = [], controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return { ok: false, status: 401, text: async () => { throw new Error('must not read rejected body') } }
  })
  const response = await fetchJson('/api', { method: 'POST', json: { value: 1 }, signal: controller.signal })
  assert.equal(response.status, 401)
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.signal, controller.signal)
  assert.deepEqual(calls[0].options.headers, { 'content-type': 'application/json' })
  assert.equal(calls[0].options.body, '{"value":1}')
  let reads = 0
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => { reads++; return '{"ok":true}' } })
  const good = await fetchJson('/api')
  assert.deepEqual(await good.json(), { ok: true })
  await good.json()
  assert.equal(reads, 1)
})

test('JSON diagnostics carry status and a bounded body preview without retries', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: false, status: 502, text: async () => '<html>'.repeat(100) } })
  const response = await fetchJson('/api')
  await assert.rejects(response.json(), error => error.status === 502 && error.bodyPreview.length === 200)
  assert.equal(calls, 1)
})

test('menu flips above a bottom-edge trigger and clears captured dismiss listeners', () => {
  const anchor = measureMenuAnchor({ rect: { top: 180, bottom: 200, right: 290 }, itemCount: 3, viewportWidth: 300, viewportHeight: 210 })
  assert.equal(anchor.placement, 'up')
  assert.equal(anchorStyle(anchor).top, 'auto')
  assert.equal(anchorStyle(anchor).bottom, '34px')
  const previousPage = globalThis.document, previousView = globalThis.window
  const page = new EventTarget(), view = new EventTarget()
  globalThis.document = page; globalThis.window = view
  try {
    let dismissed = 0
    const cleanup = listenMenuDismiss(() => { dismissed++ })
    const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' })
    page.dispatchEvent(escape); page.dispatchEvent(new Event('scroll')); view.dispatchEvent(new Event('resize'))
    assert.equal(dismissed, 3)
    cleanup()
    page.dispatchEvent(escape); view.dispatchEvent(new Event('resize'))
    assert.equal(dismissed, 3)
  } finally {
    if (previousPage === undefined) delete globalThis.document; else globalThis.document = previousPage
    if (previousView === undefined) delete globalThis.window; else globalThis.window = previousView
  }
})
