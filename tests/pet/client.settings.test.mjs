import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createPetConnection } from '../../src/modules/pet/client/connection.js'
import { DEFAULT_SETTINGS } from '../../src/modules/pet/client/model.js'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
async function clientModule() {
  const result = await build({ entryPoints: ['src/modules/pet/client/index.jsx'], bundle: true, platform: 'node', format: 'esm', target: 'node20', jsxFactory: '__dshReact.createElement', jsxFragment: '__dshReact.Fragment', loader: { '.css': 'text' }, write: false, logLevel: 'silent' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
function network() {
  const requests = []
  const streams = []
  const old = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/events')) {
      let stream
      const body = new ReadableStream({ start(controller) { stream = { controller, cancelled: false }; streams.push(stream) }, cancel() { stream.cancelled = true } })
      return { ok: true, body }
    }
    return new Response(JSON.stringify({ ok: true, settings: DEFAULT_SETTINGS, pets: [{ id: 'qoduck-lab', name: 'Qoduck' }, { id: 'shiba-lab', name: 'Shiba' }], runtime: { status: 'stopped', available: false }, navigation: { seq: 0 } }), { headers: { 'Content-Type': 'application/json' } })
  }
  return { requests, streams, send(value, index = 0) { streams[index].controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)) }, restore() { globalThis.fetch = old } }
}
function context() {
  let snapshot = { value: { pet: { ...DEFAULT_SETTINGS }, notification: { enabled: true } } }
  let reject = false
  const subscribers = new Set()
  const effects = []
  const cleanups = []
  const sections = []
  const writes = []
  const opened = []
  const sessionSubscribers = new Set()
  let sessionList = { byId: {} }
  const sessions = { list: { getSnapshot: () => sessionList, subscribe(listener) { sessionSubscribers.add(listener); return () => sessionSubscribers.delete(listener) } } }
  const form = { getSnapshot: () => snapshot, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener) }, async mutate(operations) {
    writes.push(operations)
    if (reject) return false
    const pet = { ...snapshot.value.pet }
    for (const operation of operations) pet[operation.path[1]] = operation.value
    snapshot = { value: { ...snapshot.value, pet } }
    for (const listener of subscribers) listener()
  } }
  const ctx = { configForms: { get: (id) => id === 'dsh-toolkit' ? form : undefined }, locale: { language: 'en', register: () => () => {} }, effect(run, name) { effects.push(name); const off = run(); if (typeof off === 'function') cleanups.push(off) }, slots: { inject: (_, run) => run(), register: (meta, Component) => { sections.push({ meta, Component }); return () => sections.pop() } }, sessions, workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['archived'] }) } }, uiWorkspace: { unarchiveSession: async (id) => { opened.push(`unarchive:${id}`) }, openSession: async (id) => { opened.push(`open:${id}`) } } }
  return { ctx, effects, sections, writes, opened, subscribers, sessionSubscribers,
    /** 模拟主视图切到某个会话（`retainedBy.mainView`），用于验证「已读」上报。 */
    retain(id) {
      sessionList = { byId: id === undefined ? {} : { [id]: { id, retainedBy: { mainView: 1 } } } }
      for (const listener of [...sessionSubscribers]) listener()
    },
    reject(value) { reject = value }, dispose() { for (const off of cleanups.reverse()) off() } }
}

test('authenticated SSE baselines navigation, deduplicates sequence, and cancels reader on disposal', async (t) => {
  const net = network()
  const selected = []
  const connection = createPetConnection({ onNavigation: (id) => selected.push(id) })
  t.after(() => { connection.dispose(); net.restore() })
  connection.start()
  await flush()
  net.send({ navigation: { seq: 2, sessionId: 'old' }, runtime: { status: 'running', available: true }, pets: [] })
  await flush()
  assert.deepEqual(selected, [])
  net.send({ navigation: { seq: 3, sessionId: 'fresh' } })
  net.send({ navigation: { seq: 3, sessionId: 'fresh' } })
  await flush()
  assert.deepEqual(selected, ['fresh'])
  assert.equal(net.requests[0].options.credentials, 'same-origin')
  assert.equal(net.requests[0].options.headers.Accept, 'text/event-stream')
  assert.equal(connection.getSnapshot().runtime.status, 'running')
  connection.dispose()
  await flush()
  assert.equal(net.streams[0].cancelled, true)
})

test('fragmented SSE survives invalid JSON and refresh does not navigate to a stale selection', async (t) => {
  const net = network()
  const selected = []
  const connection = createPetConnection({ onNavigation: (id) => selected.push(id) })
  t.after(() => { connection.dispose(); net.restore() })
  connection.start()
  await flush()
  const encoder = new TextEncoder()
  net.streams[0].controller.enqueue(encoder.encode(': heartbeat\n\ndata: malformed\n\ndata: {"navigation":{"seq":4,'))
  net.streams[0].controller.enqueue(encoder.encode('"sessionId":"old"}}\n\n'))
  await flush()
  await connection.refresh()
  net.send({ navigation: { seq: 5, sessionId: 'new' } })
  await flush()
  assert.deepEqual(selected, ['new'])
  await connection.action('prepare')
  const post = net.requests.find((request) => request.options.method === 'POST')
  assert.deepEqual(JSON.parse(post.options.body), { action: 'prepare' })
  assert.equal(post.options.credentials, 'same-origin')
})

test('settings use root-scoped accepted config writes, independent toggles, runtime action, and cleanup', async (t) => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://dsh.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
  const net = network()
  const runtime = context()
  const module = await clientModule()
  const HostSwitch = ({ checked, disabled, label, onChange }) => React.createElement('button', { type: 'button', className: 'host-switch', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange(!checked) })
  const client = module.default((name) => {
    if (name === 'react') return React
    assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives')
    return { Switch: HostSwitch }
  })
  client.apply(runtime.ctx)
  const { meta, Component } = runtime.sections[0]
  assert.equal(meta.id, 'desktop-pet')
  assert.equal(meta.order, 25)
  assert.equal(meta.locale, 'dsh-toolkit.pet')
  assert.deepEqual(client.inject, ['slots', 'locale', 'configForms', 'uiWorkspace', 'workspaces', 'sessions'])
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()); runtime.dispose(); net.restore(); for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }; dom.window.close() })
  await act(async () => { root.render(React.createElement(Component)); await flush() })
  assert.equal(document.querySelectorAll('[role=switch]').length, 4)
  assert.equal(document.querySelectorAll('.host-switch').length, 4)
  assert.equal(document.querySelector('.pet-switch'), null)
  assert.equal(document.querySelectorAll('input[type=range]').length, 4)
  assert.equal(document.querySelectorAll('.pet-screen').length, 2)
  const petToggle = document.querySelector('[aria-label="Show floating pet"]')
  const islandToggle = document.querySelector('[aria-label="Show island"]')
  await act(async () => { petToggle.click(); await flush() })
  assert.deepEqual(runtime.writes.at(-1), [{ op: 'set', path: ['pet', 'petEnabled'], value: true }])
  assert.equal(petToggle.getAttribute('aria-checked'), 'true')
  assert.equal(islandToggle.getAttribute('aria-checked'), 'false')
  runtime.reject(true)
  await act(async () => { islandToggle.click(); await flush() })
  assert.equal(islandToggle.getAttribute('aria-checked'), 'false')
  assert.match(document.querySelector('[role=alert]').textContent, /islandEnabled/)
  runtime.reject(false)
  const prepare = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Prepare desktop runtime')
  await act(async () => { prepare.click(); await flush() })
  assert.deepEqual(JSON.parse(net.requests.find((request) => request.options.method === 'POST').options.body), { action: 'prepare' })
  await act(async () => { net.send({ navigation: { seq: 0 } }); await flush(); net.send({ navigation: { seq: 1, sessionId: 'archived' } }); await flush() })
  assert.deepEqual(runtime.opened, ['unarchive:archived', 'open:archived'])
  await act(async () => { runtime.dispose(); await flush() })
  assert.equal(runtime.subscribers.size, 0)
  assert.equal(document.querySelector('style[data-plugin=toolkit-pet]'), null)
  assert.equal(net.streams[0].cancelled, true)
})

test('switching the main view to a Session marks it read so the island updates', async (t) => {
  const net = network()
  const runtime = context()
  const module = await clientModule()
  const client = module.default((name) => {
    if (name === 'react') return React
    return { Switch: () => null }
  })
  t.after(() => { runtime.dispose(); net.restore() })
  client.apply(runtime.ctx)
  await flush()
  const seen = () => net.requests
    .filter((request) => request.options.method === 'POST')
    .map((request) => JSON.parse(request.options.body))
  assert.deepEqual(seen(), [], 'a plugin load with no main view must not report anything')

  // 系统通知点击跳转 / 侧栏切到另一个会话：主视图持有它 → 立刻上报已读。
  runtime.retain('session-b')
  await flush()
  assert.deepEqual(seen(), [{ action: 'seen', sessionId: 'session-b' }])

  // 同一个会话反复渲染不重复上报（去抖只认「换了会话」）。
  runtime.retain('session-b')
  await flush()
  assert.equal(seen().length, 1)

  // 切到空视图不产生新的已读；再切到另一个会话才上报。
  runtime.retain(undefined)
  await flush()
  assert.equal(seen().length, 1)
  runtime.retain('session-c')
  await flush()
  assert.deepEqual(seen().at(-1), { action: 'seen', sessionId: 'session-c' })

  // 卸载后不再有订阅者，也不再有上报。
  runtime.dispose()
  await flush()
  assert.equal(runtime.sessionSubscribers.size, 0)
  runtime.retain('session-d')
  await flush()
  assert.equal(seen().at(-1).sessionId, 'session-c')
})

test('coming back to the foreground, or a finished turn on the island, marks the open Session read', async (t) => {
  // pretendToBeVisual 才能拿到 visibilityState === 'visible'（jsdom 默认是 'prerender'）。
  const dom = new JSDOM('<html><head></head><body></body></html>', { url: 'https://dsh.test', pretendToBeVisual: true })
  const saved = new Map()
  let focused = true
  dom.window.document.hasFocus = () => focused
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
  })) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
  dom.window.localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-a' }))
  const net = network()
  const runtime = context()
  const module = await clientModule()
  const client = module.default((name) => {
    if (name === 'react') return React
    return { Switch: () => null }
  })
  t.after(() => {
    runtime.dispose()
    net.restore()
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }
    dom.window.close()
  })
  client.apply(runtime.ctx)
  await flush()
  const seen = () => net.requests
    .filter((request) => request.options.method === 'POST')
    .map((request) => JSON.parse(request.options.body))
  assert.deepEqual(seen(), [{ action: 'seen', sessionId: 'session-a' }])

  // 灵动岛推来「回合结束、有新结果」，而窗口就在前台 —— 用户正看着它，直接算已读。
  await act(async () => { net.send({ sessions: [{ id: 'session-a', status: 'completed', updatedAt: 123 }] }); await flush() })
  assert.equal(seen().length, 2)
  assert.deepEqual(seen().at(-1), { action: 'seen', sessionId: 'session-a' })

  // 同一帧反复推送不重复上报。
  await act(async () => { net.send({ sessions: [{ id: 'session-a', status: 'completed', updatedAt: 123 }] }); await flush() })
  assert.equal(seen().length, 2)

  // 切到别的应用（窗口失焦）：新的「有新结果」不再自动已读。
  focused = false
  await act(async () => { net.send({ sessions: [{ id: 'session-a', status: 'completed', updatedAt: 456 }] }); await flush() })
  assert.equal(seen().length, 2)

  // 切回 DSH：恢复前台这一下就该把「有新结果」清掉，哪怕会话没变、也没点通知。
  focused = true
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); await flush() })
  assert.equal(seen().length, 3)
  assert.deepEqual(seen().at(-1), { action: 'seen', sessionId: 'session-a' })

  // 再切回来一次：新的激活事实重新上报（不是永久去重）。
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); await flush() })
  assert.equal(seen().length, 4)
})

test('the pet library searches Petdex and installs or removes a pet from the settings page', async (t) => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://dsh.test', pretendToBeVisual: true })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
  const old = globalThis.fetch
  const calls = []
  const installed = new Set()
  const pets = () => [{ id: 'qoduck-lab', name: 'Qoduck', source: 'builtin' }, ...(installed.has('boba') ? [{ id: 'petdex:boba', name: 'Boba', source: 'petdex' }] : [])]
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/events')) { const body = new ReadableStream({ start() {} }); return { ok: true, body } }
    const action = options.body ? JSON.parse(options.body) : undefined
    if (action) calls.push(action)
    if (action?.action === 'catalog') return new Response(JSON.stringify({ ok: true, total: 1, pets: [{ slug: 'boba', displayName: 'Boba', installed: installed.has('boba') }] }), { headers: { 'Content-Type': 'application/json' } })
    if (action?.action === 'install') installed.add(action.slug)
    if (action?.action === 'remove') installed.delete(action.slug)
    return new Response(JSON.stringify({ ok: true, settings: DEFAULT_SETTINGS, pets: pets(), runtime: { status: 'stopped', available: false }, navigation: { seq: 0 } }), { headers: { 'Content-Type': 'application/json' } })
  }
  const runtime = context()
  const module = await clientModule()
  const client = module.default((name) => { if (name === 'react') return React; return {} })
  client.apply(runtime.ctx)
  const { Component } = runtime.sections[0]
  const root = createRoot(document.getElementById('root'))
  t.after(async () => { await act(async () => root.unmount()); runtime.dispose(); globalThis.fetch = old; for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }; dom.window.close() })
  await act(async () => { root.render(React.createElement(Component)); await flush() })
  assert.equal(document.querySelector('.pet-libraryRow'), null)
  const browse = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Browse library')
  await act(async () => { browse.click(); await flush() })
  assert.deepEqual(calls.at(-1), { action: 'catalog', query: '' })
  const row = document.querySelector('.pet-libraryRow')
  assert.match(row.textContent, /Boba/)
  // 预览图走插件自己的受认证路由，页面不直连 Petdex。
  const thumb = row.querySelector('.pet-thumb')
  assert.ok(thumb, 'each library row shows the pet artwork')
  assert.match(thumb.getAttribute('style'), /\/api\/plugins\/dsh-toolkit\/pet\/asset\?slug=boba/)
  const install = [...row.querySelectorAll('button')].find((button) => button.textContent === 'Install')
  await act(async () => { install.click(); await flush() })
  assert.deepEqual(calls.filter((call) => call.action === 'install'), [{ action: 'install', slug: 'boba' }])
  const uninstall = [...document.querySelectorAll('.pet-libraryRow button')].find((button) => button.textContent === 'Uninstall')
  assert.ok(uninstall, 'an installed pet offers removal')
  await act(async () => { uninstall.click(); await flush() })
  assert.deepEqual(calls.filter((call) => call.action === 'remove'), [{ action: 'remove', slug: 'boba' }])
  const options = [...document.querySelectorAll('select option')].map((option) => option.textContent)
  assert.ok(options.includes('Qoduck'))
})
