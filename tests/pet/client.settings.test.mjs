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
  const form = { getSnapshot: () => snapshot, subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener) }, async mutate(operations) {
    writes.push(operations)
    if (reject) return false
    const pet = { ...snapshot.value.pet }
    for (const operation of operations) pet[operation.path[1]] = operation.value
    snapshot = { value: { ...snapshot.value, pet } }
    for (const listener of subscribers) listener()
  } }
  const ctx = { configForms: { get: (id) => id === 'dsh-toolkit' ? form : undefined }, locale: { language: 'en', register: () => () => {} }, effect(run, name) { effects.push(name); const off = run(); if (typeof off === 'function') cleanups.push(off) }, slots: { inject: (_, run) => run(), register: (meta, Component) => { sections.push({ meta, Component }); return () => sections.pop() } }, workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['archived'] }) } }, uiWorkspace: { unarchiveSession: async (id) => { opened.push(`unarchive:${id}`) }, openSession: async (id) => { opened.push(`open:${id}`) } } }
  return { ctx, effects, sections, writes, opened, subscribers, reject(value) { reject = value }, dispose() { for (const off of cleanups.reverse()) off() } }
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
  assert.deepEqual(client.inject, ['slots', 'locale', 'configForms', 'uiWorkspace', 'workspaces'])
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
