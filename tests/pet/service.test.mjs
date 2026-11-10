import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPetService } from '../../src/modules/pet/host/index.js'

// 服务会把「已读会话」写进 $DSH_HOME/toolkit/pet/seen.json；测试必须指向临时目录，
// 否则点开动作的用例会污染用户真实的 seen 记录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-pet-seen-'))

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

test('the host volatile references are read into live settings, including later edits', async (t) => {
  const volatile = (value) => ({ get: () => value })
  const f = await fixture(t, {
    petEnabled: volatile(false), islandEnabled: volatile(false),
    petSize: volatile(80), islandWidth: volatile(150), activePet: volatile('neon-cat'),
  })
  const initial = f.service.snapshot().settings
  assert.equal(initial.activePet, 'neon-cat')
  assert.equal(initial.petSize, 80)
  assert.equal(initial.islandWidth, 150)
  assert.equal(initial.petEnabled, false)
  assert.equal(initial.islandEnabled, false)
  assert.equal(f.service.snapshot().runtime.status, 'stopped', 'a disabled pet must not prepare the runtime')

  f.setDescriptors([{ ns: 'dsh-toolkit-pet', value: { petSize: volatile(75), activePet: volatile('retro-duck') } }])
  await f.emit('settings/document-updated', 'dsh-toolkit-pet', 2)
  assert.equal(f.service.snapshot().settings.petSize, 75)
  assert.equal(f.service.snapshot().settings.activePet, 'retro-duck')
})

test('a seen action clears an already-seen result without navigating or requiring a live Session', async (t) => {
  const f = await fixture(t)
  // 让 feed 里出现一条「刚结束、有新结果」的会话（基线里 updatedAt=1 会被陈旧过滤掉）。
  await f.emit('api-session/activity', 'session-a', Date.now())
  assert.equal(f.service.snapshot().sessions.length, 1)
  assert.equal(f.service.snapshot().sessions[0].status, 'completed')

  // 主视图切过去（通知点击 / 侧栏切换）→ 已读，岛上的提醒立刻消失。
  assert.deepEqual(await f.service.action({ action: 'seen', sessionId: 'session-a' }), { ok: true })
  assert.deepEqual(f.service.snapshot().sessions, [])
  assert.equal(f.calls.length, 0, 'seen must not navigate or touch the Session controller')

  // 已被归档/移除的会话标记已读同样无害：不能抛 Session no longer exists。
  f.setListed([])
  assert.deepEqual(await f.service.action({ action: 'seen', sessionId: 'gone' }), { ok: true })

  // 已读会落盘，重启后半小时内不会再当「新结果」弹出来。
  await new Promise((resolve) => setTimeout(resolve, 20))
  const saved = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'toolkit', 'pet', 'seen.json'), 'utf8'))
  assert.ok(Number.isFinite(saved['session-a']))
  assert.ok(Number.isFinite(saved.gone))
})
