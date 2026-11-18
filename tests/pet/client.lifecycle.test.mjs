import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import React from 'react'
import { JSDOM } from 'jsdom'
import { DEFAULT_SETTINGS } from '../../src/modules/pet/client/model.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function clientModule() {
  const result = await build({ entryPoints: ['src/modules/pet/client/index.tsx'], bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['react', 'react/*', 'react-dom', 'react-dom/*'], jsxFactory: '__dshReact.createElement', jsxFragment: '__dshReact.Fragment', loader: { '.css': 'text' }, write: false, logLevel: 'silent' })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = 'node_modules/.cache/pet_client_lifecycle.mjs'
  await writeFile(out, result.outputFiles[0].text)
  // 共享组件直接 import 'react'：写成文件再从 node_modules 解析，才能和测试里的 React 是同一份。
  return import(`../../${out}?case=${Math.random()}`)
}

function browser(t) {
  const dom = new JSDOM('<html><head></head><body></body></html>', { url: 'https://dsh.test', pretendToBeVisual: true })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }
    dom.window.close()
  })
}

function network(t) {
  const old = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (url.endsWith('/events')) {
      // 一条永远不回包的 SSE：只要客户端连着就行，这个用例不关心事件内容。
      return { ok: true, body: new ReadableStream({ start() {} }) }
    }
    return new Response(JSON.stringify({ ok: true, settings: DEFAULT_SETTINGS, pets: [], runtime: { status: 'stopped', available: false }, navigation: { seq: 0 } }), { headers: { 'Content-Type': 'application/json' } })
  }
  t.after(() => { globalThis.fetch = old })
}

/** 只记录 setInterval：用例要断言「宠物/岛都关着时到底有没有常驻定时器」。 */
function intervals(t) {
  const live = new Map()
  let next = 0
  const set = globalThis.setInterval
  const clear = globalThis.clearInterval
  globalThis.setInterval = (fn, ms) => { const id = ++next; live.set(id, { fn, ms }); return id }
  globalThis.clearInterval = (id) => { live.delete(id) }
  t.after(() => { globalThis.setInterval = set; globalThis.clearInterval = clear })
  return live
}

function context() {
  let snapshot = { value: { pet: { ...DEFAULT_SETTINGS } } }
  const subscribers = new Set()
  const cleanups = []
  const form = {
    getSnapshot: () => snapshot,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener) },
  }
  const ctx = {
    configForms: { get: (id) => (id === 'dsh-toolkit' ? form : undefined) },
    locale: { language: 'en', register: () => () => {} },
    effect(run) { const off = run(); if (typeof off === 'function') cleanups.push(off) },
    slots: { inject: (_, run) => run(), register: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    uiWorkspace: {},
  }
  return {
    ctx,
    /** 与真实配置表单一致：先换快照，再通知订阅者。 */
    setPet(patch) {
      snapshot = { value: { ...snapshot.value, pet: { ...snapshot.value.pet, ...patch } } }
      for (const listener of [...subscribers]) listener()
    },
    dispose() { for (const off of cleanups.reverse()) off() },
  }
}

test('宠物与灵动岛都关闭时不安装 1s 轮询，开启才安装、关闭即清掉', async (t) => {
  browser(t)
  network(t)
  const timers = intervals(t)
  const runtime = context()
  const module = await clientModule()
  const client = module.default((name) => (name === 'react' ? React : {}))
  client.apply(runtime.ctx)
  await flush()
  assert.equal(timers.size, 0, '两个功能都关着，不该留下每秒唤醒的定时器')

  runtime.setPet({ petEnabled: true })
  assert.equal(timers.size, 1, '开启桌宠后安装轮询')
  assert.equal([...timers.values()][0].ms, 1000)

  runtime.setPet({ petEnabled: false })
  assert.equal(timers.size, 0, '关掉桌宠要立刻清掉轮询')

  runtime.setPet({ islandEnabled: true })
  assert.equal(timers.size, 1, '只开启灵动岛也要轮询（岛上要显示会话状态）')

  runtime.setPet({ petEnabled: true })
  assert.equal(timers.size, 1, '两个都开着也只装一个定时器')

  runtime.setPet({ petEnabled: false, islandEnabled: false })
  assert.equal(timers.size, 0)

  runtime.dispose()
  assert.equal(timers.size, 0, '插件卸载后不残留定时器')
})