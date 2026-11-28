import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPetService } from '../../src/modules/pet/host/index.ts'

// 服务会把「已读会话」写进 $DSH_HOME/toolkit/pet/seen.json；测试必须指向临时目录，
// 否则点开动作的用例会污染用户真实的 seen 记录。
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-pet-seen-'))

async function fixture(t, initial = {}) {
  const handlers = new Map(), calls = [], descriptions = [], listSignals = []
  let readList = async () => ({ items: listed })
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
      list(request, signal) { listSignals.push(signal); return readList(signal) },
      async cancel(request) { calls.push({ method: 'cancel', request }); return { accepted: true } },
      async prompt(request) { calls.push({ method: 'prompt', request }); return { accepted: true } },
    },
    settings: { describe(options) { descriptions.push(options); return descriptors } },
  }
  const service = await createPetService(ctx, initial)
  t.after(() => service.dispose())
  return { service, calls, descriptions, handlers, listSignals,
    setDescriptors(value) { descriptors = value }, setListed(value) { listed = value },
    setReadList(read) { readList = read },
    async emit(event, ...args) { for (const handler of handlers.get(event) || []) await handler(...args) },
  }
}

class Response extends EventEmitter {
  chunks = []
  headers = {}
  get statusCode() { return this.status }
  set statusCode(value) { this.status = value }
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = value }
  writeHead(status, headers) { this.status = status; this.headers = { ...this.headers, ...headers } }
  write(chunk) { this.chunks.push(chunk); return true }
  end(chunk) { if (chunk !== undefined) this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)); this.writableEnded = true; this.emit('close') }
}

function currentEvent(response) {
  return JSON.parse(response.chunks.at(-1).replace(/^data: /, '').trim())
}

test('the preview route answers JSON 404 for ids it will not resolve, without touching the network', async (t) => {
  const f = await fixture(t)
  const asset = new Response()
  const previous = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('the preview route must not fetch for an empty id') }
  try { await f.service.asset({ url: '/api/plugins/toolkit/pet/asset?slug=' }, asset) } finally { globalThis.fetch = previous }
  assert.equal(asset.status, 404)
  assert.match(asset.chunks.join(''), /Pet preview unavailable/)
  assert.equal(asset.headers['content-type'], 'application/json; charset=utf-8')
})

test('an installed copy of the bundled pet is not listed next to the built-in one', async (t) => {
  // 内置 aoi-shark-maid 之后，用户机器上很可能还留着同名、带 petdex: 前缀的已安装副本。
  const root = join(process.env.DSH_HOME, 'toolkit', 'pet', 'pets')
  for (const [slug, name] of [['aoi-shark-maid', 'DeepSeek酱'], ['boba', 'Boba']]) {
    mkdirSync(join(root, slug), { recursive: true })
    writeFileSync(join(root, slug, 'pet.json'), JSON.stringify({ id: slug, displayName: name, description: slug, spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }))
    writeFileSync(join(root, slug, 'spritesheet.webp'), 'RIFF')
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const f = await fixture(t)
  assert.deepEqual(f.service.snapshot().pets.map((pet) => pet.id), ['aoi-shark-maid', 'petdex:boba'])
  // 内置形象走 Petdex 的 webp 精灵表，文件名取自清单而不是写死 spritesheet.png。
  assert.equal(f.service.snapshot(true).pets[0].sheetFile, 'spritesheet.webp')
})

test('public service state and event streams omit helper-only asset paths, manifests, and executable configuration', async (t) => {
  const f = await fixture(t, { electronPath: '/private/electron', activePet: 'invalid-id' })
  const publicState = f.service.snapshot()
  const privateState = f.service.snapshot(true)
  assert.equal(publicState.settings.activePet, 'aoi-shark-maid')
  assert.equal(publicState.runtime.status, 'stopped')
  assert.equal(publicState.pets.length, 1)
  assert.ok(privateState.pets.every((pet) => pet.assetDir.startsWith('/') && pet.manifest.displayName))
  assert.deepEqual(publicState.pets, privateState.pets.map(({ id, name, source }) => ({ id, name, source })))
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
  await assert.rejects(createPetService({ on(event) {
    if (event === 'settings/document-updated') return () => {}
    throw new Error('activity registration failed')
  } }, { petEnabled: true }), /activity registration failed/)
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
    const config = { petSize: 50 + index * 10, bubbleWidth: 300 + index * 20, activePet: 'aoi-shark-maid' }
    f.setDescriptors([{ ns, value: ns === 'dsh-toolkit-pet' ? config : { pet: config, unrelated: 'keep' } }])
    await f.emit('settings/document-updated', ns, index + 1)
    assert.equal(f.service.snapshot().settings.petSize, config.petSize, ns)
    assert.equal(f.service.snapshot().settings.bubbleWidth, config.bubbleWidth, ns)
    assert.equal(f.service.snapshot().settings.activePet, 'aoi-shark-maid')
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
    petSize: volatile(80), islandWidth: volatile(150), activePet: volatile('aoi-shark-maid'),
  })
  const initial = f.service.snapshot().settings
  assert.equal(initial.activePet, 'aoi-shark-maid')
  assert.equal(initial.petSize, 80)
  assert.equal(initial.islandWidth, 150)
  assert.equal(initial.petEnabled, false)
  assert.equal(initial.islandEnabled, false)
  assert.equal(f.service.snapshot().runtime.status, 'stopped', 'a disabled pet must not prepare the runtime')

  f.setDescriptors([{ ns: 'dsh-toolkit-pet', value: { petSize: volatile(75), activePet: volatile('aoi-shark-maid') } }])
  await f.emit('settings/document-updated', 'dsh-toolkit-pet', 2)
  assert.equal(f.service.snapshot().settings.petSize, 75)
  assert.equal(f.service.snapshot().settings.activePet, 'aoi-shark-maid')
})

test('the activity feed wakes a sleeping island and marking the result seen lets it exit', async (t) => {
  const children = []
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true }
    children.push(child)
    return child
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const config = { electronPath: process.execPath, islandEnabled: true, islandIdle: false }
  const f = await fixture(t, config)
  f.setDescriptors([{ ns: 'dsh-toolkit-pet', value: config }])
  await f.emit('settings/document-updated', 'dsh-toolkit-pet', 1)
  assert.equal(f.service.snapshot().runtime.available, true)
  assert.equal(children.length, 0)

  await f.emit('api-session/activity', 'session-a', Date.now())
  for (let i = 0; i < 100 && !children.length; i += 1) await new Promise(resolve => setImmediate(resolve))
  assert.equal(children.length, 1)
  children[0].stdout.emit('data', '{"type":"ready"}\n')
  assert.equal(f.service.snapshot().runtime.status, 'running')
  await f.service.action({ action: 'seen', sessionId: 'session-a' })
  assert.deepEqual(f.service.snapshot().sessions, [])
  t.mock.timers.tick(30_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.service.snapshot().runtime.status, 'stopped')
  assert.equal(children.length, 1)
})

test('activity starts for either window and aborts a pending baseline when both close', async (t) => {
  const f = await fixture(t)
  const configure = async (value) => {
    f.setDescriptors([{ ns: 'dsh-toolkit-pet', value: { electronPath: '/nonexistent-test-electron', ...value } }])
    await f.emit('settings/document-updated', 'dsh-toolkit-pet')
  }
  assert.deepEqual(f.listSignals, [])
  assert.equal(f.handlers.get('api-session/activity'), undefined)

  let finish
  f.setReadList(() => new Promise((resolve) => { finish = resolve }))
  const opening = configure({ petEnabled: true })
  await Promise.resolve()
  const [signal] = f.listSignals
  assert.equal(signal?.aborted, false)
  await configure({})
  assert.equal(signal.aborted, true)
  assert.equal(f.handlers.get('api-session/activity').size, 0)
  assert.deepEqual(f.service.snapshot().sessions, [])

  const updatedAt = Date.now()
  await f.service.action({ action: 'seen', sessionId: 'session-a' })
  f.setReadList(async () => ({ items: [{ sessionId: 'session-a', blank: false, running: false, updatedAt }] }))
  await configure({ islandEnabled: true })
  assert.equal(f.listSignals.length, 2)
  assert.equal(f.handlers.get('api-session/activity').size, 1)
  assert.deepEqual(f.service.snapshot().sessions, [], 'seen while closed survives re-enabling')
  finish({ items: [{ sessionId: 'stale-baseline', blank: false, updatedAt }] })
  await opening
  assert.deepEqual(f.service.snapshot().sessions, [], 'a disposed feed cannot publish a late baseline')
  await f.emit('api-session/activity', 'session-a', Date.now() + 1)
  assert.equal(f.service.snapshot().sessions[0].id, 'session-a')
  await configure({ petEnabled: true })
  assert.equal(f.listSignals.length, 2, 'switching between enabled windows keeps the feed')
  await configure({})
  assert.equal(f.listSignals[1].aborted, true)
  assert.deepEqual(f.service.snapshot().sessions, [])
})

test('a seen action clears an already-seen result without navigating or requiring a live Session', async (t) => {
  const f = await fixture(t, { petEnabled: true, electronPath: '/nonexistent-test-electron' })
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

  // 已读会落盘，重启后半小时内不会再当「新结果」弹出来。落盘是异步链（临时文件 + rename），
  // 所以这里等两条记录都出现，而不是赌一个固定延迟。
  const file = join(process.env.DSH_HOME, 'toolkit', 'pet', 'seen.json')
  let saved
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (Number.isFinite(parsed.gone)) { saved = parsed; break }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(Number.isFinite(saved['session-a']))
  assert.ok(Number.isFinite(saved.gone))
})
