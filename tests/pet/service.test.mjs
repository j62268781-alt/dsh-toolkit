import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { createPetService } from '../../src/modules/pet/host/index.js'

async function fixture(t, initial = {}) {
  const handlers = new Map(), calls = [], descriptions = []
  let descriptors = [], listed = [{ sessionId: 'session-a', blank: false, running: false, updatedAt: 1, projections: { kind: 'sequenced', asOfSeq: 0, values: { title: 'A session' } } }]
  const ctx = {
    on(event, handler) {
      const set = handlers.get(event) || new Set()
      handlers.set(event, set); set.add(handler)
      return () => set.delete(handler)
    },
    sessions: { get() {}, list: () => [] },
    sessionProjections: { onChanged() { return () => {} }, snapshot: () => ({ asOfSeq: 0, values: {} }) },
    sessionController: {
      async list() { return { items: listed } },
      async cancel(request) { calls.push({ method: 'cancel', request }); return { accepted: true } },
      async prompt(request) { calls.push({ method: 'prompt', request }); return { accepted: true } },
    },
    settings: { describe(options) { descriptions.push(options); return descriptors } },
  }
  const service = await createPetService(ctx, initial)
  t.after(() => service.dispose())
  return { service, calls, descriptions, handlers,
    setDescriptors(value) { descriptors = value }, setListed(value) { listed = value },
    async emit(event, ...args) { for (const handler of handlers.get(event) || []) await handler(...args) },
  }
}

class Response extends EventEmitter {
  chunks = []
  writeHead(status, headers) { this.status = status; this.headers = headers }
  write(chunk) { this.chunks.push(chunk); return true }
  end() { this.writableEnded = true; this.emit('close') }
}

function currentEvent(response) {
  return JSON.parse(response.chunks.at(-1).replace(/^data: /, '').trim())
}

test('public service state and event streams omit helper-only asset paths, manifests, and executable configuration', async (t) => {
  const f = await fixture(t, { electronPath: '/private/electron', activePet: 'invalid-id' })
  const publicState = f.service.snapshot()
  const privateState = f.service.snapshot(true)
  assert.equal(publicState.settings.activePet, 'qoduck-lab')
  assert.equal(publicState.runtime.status, 'stopped')
  assert.equal(publicState.pets.length, 4)
  assert.ok(privateState.pets.every((pet) => pet.assetDir.startsWith('/') && pet.manifest.displayName))
  assert.deepEqual(publicState.pets, privateState.pets.map(({ id, name }) => ({ id, name })))
  const serialized = JSON.stringify(publicState)
  for (const secret of ['assetDir', 'manifest', 'electronPath', '/private/electron', 'token', '127.0.0.1']) assert.ok(!serialized.includes(secret), secret)
  const response = new Response()
  f.service.attach({}, response)
  assert.deepEqual(currentEvent(response), JSON.parse(serialized))
  await f.service.dispose()
  assert.equal(response.writableEnded, true)
  assert.ok([...f.handlers.values()].every((handlers) => handlers.size === 0))
  await assert.rejects(f.service.action({ action: 'cancel', sessionId: 'session-a' }), /stopped/)
})

test('cancel and prompt use the real Session request shapes and reject vanished Sessions', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await f.service.action({ action: 'cancel', sessionId: 'session-a' }), { ok: true })
  assert.deepEqual(await f.service.action({ action: 'prompt', sessionId: 'session-a', text: '  continue please  ' }), { ok: true })
  assert.deepEqual(f.calls[0], { method: 'cancel', request: { sessionId: 'session-a' } })
  const prompt = f.calls[1]
  assert.equal(prompt.method, 'prompt')
  assert.match(prompt.request.requestId, /^[0-9a-f-]{36}$/)
  assert.deepEqual({ ...prompt.request, requestId: '<id>' }, { requestId: '<id>', sessionId: 'session-a', mode: 'queue', content: [{ type: 'text', text: 'continue please' }] })
  f.setListed([])
  for (const action of ['open', 'cancel', 'prompt']) await assert.rejects(f.service.action({ action, sessionId: 'session-a', text: 'reply' }), /Session no longer exists/)
  assert.equal(f.calls.length, 2)
})

test('opening a Session publishes navigation and only asks the supported Desktop URI to focus', async (t) => {
  const launches = []
  t.mock.method(childProcess, 'spawn', (...args) => {
    launches.push(args)
    const child = new EventEmitter()
    child.unref = () => {}
    return child
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const f = await fixture(t)
  const response = new Response()
  f.service.attach({}, response)
  for (let seq = 1; seq <= 2; seq += 1) {
    await f.service.action({ action: 'open', sessionId: 'session-a' })
    assert.deepEqual(currentEvent(response).navigation, { seq, sessionId: 'session-a' })
  }
  assert.equal(f.calls.length, 0)
  if (process.platform === 'darwin') assert.deepEqual(launches, [
    ['/usr/bin/open', ['dsh://open'], { stdio: 'ignore' }],
    ['/usr/bin/open', ['dsh://open'], { stdio: 'ignore' }],
  ])
  else assert.deepEqual(launches, [])
})

test('failed activity initialization closes the already-created private bridge', async (t) => {
  let server
  const createServer = http.createServer
  t.mock.method(http, 'createServer', (...args) => { server = createServer(...args); return server })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  await assert.rejects(createPetService({ on() { throw new Error('activity registration failed') } }), /activity registration failed/)
  assert.ok(server, 'initialization reached the private bridge')
  assert.equal(server.listening, false, 'a failed setup must not leave a local server running')
})

test('disposal prevents an in-flight config read from changing or restarting the service', async (t) => {
  const f = await fixture(t)
  let finish
  f.setDescriptors(new Promise((resolve) => { finish = resolve }))
  const updating = f.emit('settings/document-updated', 'dsh-toolkit-pet', 2)
  await f.service.dispose()
  finish([{ ns: 'dsh-toolkit-pet', value: { petSize: 50, petEnabled: true } }])
  await updating
  assert.equal(f.service.snapshot().settings.petSize, 100)
  assert.equal(f.service.snapshot().runtime.status, 'stopped')
})

test('live standalone and legacy config events resolve profile entry IDs and nested pet values', async (t) => {
  const f = await fixture(t)
  for (const [index, ns] of ['dsh-toolkit-pet', 'dsh-toolkit', 'shell-kit', 'dsh-shell-kit'].entries()) {
    const config = { petSize: 50 + index * 10, bubbleWidth: 300 + index * 20, activePet: 'neon-cat' }
    f.setDescriptors([{ ns, value: ns === 'dsh-toolkit-pet' ? config : { pet: config, unrelated: 'keep' } }])
    await f.emit('settings/document-updated', ns, index + 1)
    assert.equal(f.service.snapshot().settings.petSize, config.petSize, ns)
    assert.equal(f.service.snapshot().settings.bubbleWidth, config.bubbleWidth, ns)
    assert.equal(f.service.snapshot().settings.activePet, 'neon-cat')
  }
  assert.deepEqual(f.descriptions, Array.from({ length: 4 }, () => ({ redactSecrets: false })))
  await f.emit('settings/document-updated', 'dsh-toolkit-notification', 1)
  await f.emit('settings/document-updated', 'dsh-toolkit.pet', 1)
  assert.equal(f.descriptions.length, 4, 'locale namespaces and unrelated entry IDs are not Config events for this plugin')
  f.setDescriptors([])
  await f.emit('settings/document-updated', 'dsh-toolkit-pet', 5)
  assert.equal(f.service.snapshot().settings.petSize, 80, 'a missing descriptor must preserve the current values')
})
