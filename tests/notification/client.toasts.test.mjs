/**
 * 应用内提醒卡片（toasts）：
 *   1. store 契约 —— 上限、丢弃最旧、订阅/退订、错误文案截断；
 *   2. 组件行为 —— 渲染、关闭按钮、Escape、自动消失与悬停暂停、点击导航；
 *   3. 端到端接线 —— 真实 index.jsx：前台事件推卡片而不发系统通知，后台仍发系统通知，
 *      always 两者都发；导航失败重试一次，仍失败把原因写回卡片；缺 slots 服务时回退系统通知。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import {
  TOAST_ERROR_LIMIT, TOAST_LIMIT, createToastStore,
} from '../../src/modules/notification/client/toasts.js'
import {
  chatSnapshot, createFakeContext, createNotificationStub, createSoundFetchStub, loadClientEntry, loadNotificationModule,
  makeDom, mountComponent, sleep,
} from './helpers.mjs'

/* ── store：纯内存，无 DOM ─────────────────────────────────────────────── */

test('store：推入的卡片新的在前，字段收敛成单行字符串', () => {
  const store = createToastStore()
  store.push({ kind: 'completed', sessionId: 's1', title: '  修复\n登录  ', body: '完成', at: 100 })
  store.push({ kind: 'failed', sessionId: 's2', title: '二', body: '失败' })
  const [newest, older] = store.getSnapshot()
  assert.equal(newest.sessionId, 's2')
  assert.equal(older.sessionId, 's1')
  assert.equal(older.title, '修复 登录')
  assert.equal(older.at, 100)
  assert.equal(typeof older.id, 'number')
  assert.ok(newest.id > older.id)
  assert.equal(older.error, undefined)
})

test('store：最多保留 3 张，超出丢最旧的；可自定义上限', () => {
  const store = createToastStore()
  for (const id of ['a', 'b', 'c', 'd']) store.push({ sessionId: id })
  assert.equal(TOAST_LIMIT, 3)
  assert.deepEqual(store.getSnapshot().map((item) => item.sessionId), ['d', 'c', 'b'])

  const small = createToastStore(1)
  small.push({ sessionId: 'a' })
  small.push({ sessionId: 'b' })
  assert.deepEqual(small.getSnapshot().map((item) => item.sessionId), ['b'])
})

test('store：dismiss/clear 与订阅（含取消订阅、订阅者抛错隔离）', () => {
  const store = createToastStore()
  const seen = []
  let throws = true
  const offBad = store.subscribe(() => {
    if (throws) throw new Error('bad listener')
  })
  const off = store.subscribe(() => seen.push(store.getSnapshot().length))
  const first = store.push({ sessionId: 's1' })
  const second = store.push({ sessionId: 's2' })
  assert.deepEqual(seen, [1, 2])
  assert.equal(store.getSnapshot()[0].id, second.id)

  assert.equal(store.dismiss(first.id), true)
  assert.equal(store.dismiss(first.id), false, 'already dismissed')
  assert.deepEqual(seen, [1, 2, 1])

  throws = false
  off()
  offBad()
  store.clear()
  // clear 后仍然只有之前的两次通知：退订者的回调不再触发。
  assert.deepEqual(seen, [1, 2, 1])
  assert.deepEqual(store.getSnapshot(), [])
})

test('store：setError 只改目标卡片、截断到上限，可清空', () => {
  const store = createToastStore()
  const first = store.push({ sessionId: 's1' })
  const second = store.push({ sessionId: 's2' })

  const updated = store.setError(first.id, 'x'.repeat(TOAST_ERROR_LIMIT + 20))
  assert.equal(updated.error.length, TOAST_ERROR_LIMIT)
  assert.equal(store.getSnapshot().find((item) => item.id === first.id).error.length, TOAST_ERROR_LIMIT)
  assert.equal(store.getSnapshot().find((item) => item.id === second.id).error, undefined)

  store.setError(first.id, '')
  assert.equal(store.getSnapshot().find((item) => item.id === first.id).error, undefined)
  assert.equal(store.setError(9999, 'gone'), undefined)
})

test('store：快照引用在两次变更之间保持稳定', () => {
  const store = createToastStore()
  const empty = store.getSnapshot()
  assert.equal(store.getSnapshot(), empty)
  store.push({ sessionId: 's1' })
  const pushed = store.getSnapshot()
  assert.notEqual(pushed, empty)
  assert.equal(store.getSnapshot(), pushed)
})

/* ── 组件：直接驱动一张假 store ───────────────────────────────────────── */

/** 用与主 bundle 相同的 jsxFactory 打包 toasts.jsx（node 不能直接 import JSX）。 */
let componentBuild
function loadToastComponent() {
  if (componentBuild === undefined) {
    componentBuild = loadClientEntry('src/modules/notification/client/toasts.jsx', 'notification-toasts-module')
  }
  return componentBuild
}

const TRANSLATIONS = {
  toastsLabel: '提醒',
  dismiss: '关闭提醒',
  openSession: '打开会话',
  untitled: '无标题会话',
  navigateFailed: '未能切换到该会话，请从侧边栏手动打开。',
}
const t = (key) => TRANSLATIONS[key] ?? key

/**
 * 挂载组件。
 * @param {object} options
 * @param {object} options.store 卡片 store。
 * @param {Function} [options.openSession] 导航桩。
 * @param {number} [options.autoDismissMs] 缩短自动消失时间。
 */
async function mountToasts({ store, openSession = async () => ({ ok: true }), autoDismissMs } = {}) {
  globalThis.__dshReact = React
  const module = await loadToastComponent()
  const Component = module.createNotificationToasts(React, { t, store, openSession, autoDismissMs })
  const mounted = await mountComponent(Component)
  return mounted
}

test('组件：渲染标题/正文/关闭按钮；关闭按钮只关卡片，不导航', async (t) => {
  const page = makeDom()
  const store = createToastStore()
  let opened = 0
  const app = await mountToasts({ store, openSession: async () => { opened += 1; return { ok: true } } })
  t.after(async () => {
    await app.unmount()
    page.restore()
  })

  await act(async () => {
    store.push({ kind: 'completed', sessionId: 's1', title: '修复登录', body: '最后一条回复' })
  })
  const card = app.container.querySelector('.ntf-toast')
  assert.ok(card)
  assert.equal(card.querySelector('.ntf-toastTitle').textContent, '修复登录')
  assert.equal(card.querySelector('.ntf-toastText').textContent, '最后一条回复')
  const close = card.querySelector('.ntf-toastClose')
  assert.equal(close.getAttribute('aria-label'), '关闭提醒')
  assert.equal(app.container.querySelector('.ntf-toasts').getAttribute('aria-label'), '提醒')
  assert.equal(app.container.querySelector('.ntf-toastError'), null)

  await app.click(close)
  assert.deepEqual(store.getSnapshot(), [])
  assert.equal(opened, 0, 'the close button never navigates')
})

test('组件：Escape 关闭最新一张，较早的保留', async (t) => {
  const page = makeDom()
  const store = createToastStore()
  const app = await mountToasts({ store })
  t.after(async () => {
    await app.unmount()
    page.restore()
  })

  await act(async () => {
    store.push({ sessionId: 'older', title: '旧', body: '旧正文' })
  })
  await act(async () => {
    store.push({ sessionId: 'newest', title: '新', body: '新正文' })
  })
  assert.equal(app.container.querySelectorAll('.ntf-toast').length, 2)

  await act(async () => {
    page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  assert.deepEqual(store.getSnapshot().map((item) => item.sessionId), ['older'])
  assert.equal(app.container.querySelectorAll('.ntf-toast').length, 1)
})

test('组件：点击卡片主体用正确的 sessionId 导航，成功后关掉该卡片', async (t) => {
  const page = makeDom()
  const store = createToastStore()
  const opened = []
  const app = await mountToasts({
    store,
    openSession: async (sessionId) => { opened.push(sessionId); return { ok: true } },
  })
  t.after(async () => {
    await app.unmount()
    page.restore()
  })

  await act(async () => {
    store.push({ sessionId: 'keep-me', title: '保留', body: 'a' })
  })
  await act(async () => {
    store.push({ sessionId: 's2', title: '要打开', body: 'b' })
  })

  const newest = app.container.querySelectorAll('.ntf-toast')[0]
  await app.click(newest.querySelector('.ntf-toastBody'))
  assert.deepEqual(opened, ['s2'])
  assert.deepEqual(store.getSnapshot().map((item) => item.sessionId), ['keep-me'])
})

test('组件：自动消失约 8 秒；悬停/聚焦时暂停计时', async (t) => {
  const page = makeDom()
  const store = createToastStore()
  const app = await mountToasts({ store, autoDismissMs: 40 })
  t.after(async () => {
    await app.unmount()
    page.restore()
  })

  await act(async () => {
    store.push({ sessionId: 's1', title: '自动消失', body: 'x' })
  })
  // 停留阶段：还没到时间就仍在。
  await act(async () => { await sleep(20) })
  assert.equal(store.getSnapshot().length, 1)

  // 聚焦（React 用 focusin 合成 onFocus）暂停计时：等过一个完整周期也不消失。
  const card = app.container.querySelector('.ntf-toast')
  await act(async () => {
    card.dispatchEvent(new page.window.FocusEvent('focusin', { bubbles: true }))
  })
  await act(async () => { await sleep(80) })
  assert.equal(store.getSnapshot().length, 1, 'focus pauses the auto dismiss timer')

  await act(async () => {
    card.dispatchEvent(new page.window.FocusEvent('focusout', { bubbles: true }))
  })
  await act(async () => { await sleep(60) })
  assert.deepEqual(store.getSnapshot(), [], 'focus loss resumes the remaining time')
})

test('组件：导航返回 ok=false 时保留卡片（不假装成功）', async (t) => {
  const page = makeDom()
  const store = createToastStore()
  const app = await mountToasts({ store, openSession: async () => ({ ok: false, error: 'boom' }) })
  t.after(async () => {
    await app.unmount()
    page.restore()
  })

  await act(async () => {
    store.push({ sessionId: 's1', title: '打不开', body: 'x' })
  })
  await app.click(app.container.querySelector('.ntf-toastBody'))
  assert.equal(store.getSnapshot().length, 1)
})

test('组件：openSession 抛错时把本地化原因写回卡片，点击处理器不抛错', async (t) => {
  const page = makeDom()
  const store = createToastStore()
  const app = await mountToasts({
    store,
    openSession: async () => { throw new Error('navigation exploded') },
  })
  t.after(async () => {
    await app.unmount()
    page.restore()
  })

  await act(async () => {
    store.push({ sessionId: 's1', title: '异常', body: 'x' })
  })
  await app.click(app.container.querySelector('.ntf-toastBody'))
  const error = app.container.querySelector('.ntf-toastError')
  assert.ok(error, 'the failure reason is rendered on the card')
  assert.equal(error.textContent, '未能切换到该会话，请从侧边栏手动打开。')
  assert.equal(store.getSnapshot().length, 1)
})

/* ── 端到端接线：真实 index.jsx + 假服务 ─────────────────────────────── */

let clientBuild
function loadClient() {
  if (clientBuild === undefined) clientBuild = loadNotificationModule('notification-toasts-e2e')
  return clientBuild
}

/** 一次完整接线：jsdom + 通知桩 + 假 ctx + 真实 apply + 挂载 overlay。 */
async function boot(options = {}) {
  const page = makeDom()
  page.window.focus = () => {}
  const stub = createNotificationStub({ permission: 'granted' })
  const fetch = createSoundFetchStub()
  const runtime = createFakeContext(options)
  const module = await loadClient()
  const client = module.default((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: undefined, Button: undefined }
    throw new Error(`unexpected module ${id}`)
  })
  client.apply(runtime.ctx)
  const entry = runtime.overlays.find(({ meta }) => meta.id === 'dsh-toolkit.notification.toasts')
  const toasts = entry === undefined ? undefined : await mountComponent(entry.Component)
  return {
    page,
    stub,
    fetch,
    runtime,
    toasts,
    cards() {
      return toasts === undefined ? [] : [...toasts.container.querySelectorAll('.ntf-toast')]
    },
    async dispose() {
      await toasts?.unmount()
      runtime.dispose()
      stub.restore()
      fetch.restore()
      page.restore()
    },
  }
}

/** 前台：可见且有焦点。 */
function focusPage(page) {
  page.document.hasFocus = () => true
  Object.defineProperty(page.document, 'visibilityState', { configurable: true, get: () => 'visible' })
}

/** 后台：窗口隐藏。 */
function hidePage(page) {
  Object.defineProperty(page.document, 'visibilityState', { configurable: true, get: () => 'hidden' })
}

async function flush() {
  await act(async () => {
    await sleep(450)
  })
}

async function settle() {
  await act(async () => {
    await sleep(40)
  })
}

test('接线：窗口在前台时事件推一张卡片，不发系统通知', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '修复登录问题', running: true } },
    chats: { s1: chatSnapshot({ reply: '已修复登录跳转。' }) },
  })
  t.after(() => app.dispose())
  focusPage(app.page)

  app.runtime.setRunning('s1', false)
  await flush()

  assert.equal(app.stub.instances.length, 0, 'foreground events use the in-app card, not a system banner')
  const cards = app.cards()
  assert.equal(cards.length, 1)
  assert.equal(cards[0].querySelector('.ntf-toastTitle').textContent, '修复登录问题')
  assert.equal(cards[0].querySelector('.ntf-toastText').textContent, '已修复登录跳转。')
  assert.deepEqual(app.runtime.openedSessions, [], 'the card itself never navigates')
})

test('接线：点击卡片打开对应会话并关掉卡片', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '要点开的会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  focusPage(app.page)

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.cards().length, 1)

  await app.toasts.click(app.cards()[0].querySelector('.ntf-toastBody'))
  await settle()
  assert.deepEqual(app.runtime.openedSessions, ['s1'])
  assert.equal(app.cards().length, 0, 'successful navigation dismisses the card')
})

test('接线：窗口隐藏时仍发系统通知，且不渲染卡片', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '后台完成', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  hidePage(app.page)

  app.runtime.setRunning('s1', false)
  await flush()

  assert.equal(app.stub.instances.length, 1)
  assert.equal(app.cards().length, 0)
})

test('接线：always 时机两者都发（系统通知 + 卡片）', async (t) => {
  const app = await boot({
    notification: { currentMode: 'always' },
    sessions: { s1: { id: 's1', displayTitle: '全都发', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  focusPage(app.page)

  app.runtime.setRunning('s1', false)
  await flush()

  assert.equal(app.stub.instances.length, 1)
  assert.equal(app.cards().length, 1)
})

test('接线：第一次导航没让主视图持有会话时自动重试一次', async (t) => {
  const app = await boot({
    retainOnOpen: 'second',
    sessions: { s1: { id: 's1', displayTitle: '需要重试', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  focusPage(app.page)

  app.runtime.setRunning('s1', false)
  await flush()

  await app.toasts.click(app.cards()[0].querySelector('.ntf-toastBody'))
  await settle()
  assert.deepEqual(app.runtime.openedSessions, ['s1', 's1'], 'the second attempt is the retry')
  assert.equal(app.cards().length, 0, 'retry succeeded, so the card closes')
})

test('接线：两次导航都没生效时卡片上出现一行失败原因', async (t) => {
  const app = await boot({
    retainOnOpen: 'never',
    sessions: { s1: { id: 's1', displayTitle: '打不开的会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  focusPage(app.page)

  app.runtime.setRunning('s1', false)
  await flush()

  await app.toasts.click(app.cards()[0].querySelector('.ntf-toastBody'))
  await settle()
  assert.deepEqual(app.runtime.openedSessions, ['s1', 's1'])
  const cards = app.cards()
  assert.equal(cards.length, 1, 'failure keeps the card so the user can retry')
  const error = cards[0].querySelector('.ntf-toastError')
  assert.ok(error)
  assert.match(error.textContent, /未能切换到该会话/)
})

test('接线：宿主没有 slots 服务时回退到系统通知，不丢提醒', async (t) => {
  const app = await boot({
    withSlots: false,
    sessions: { s1: { id: 's1', displayTitle: '降级宿主', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  focusPage(app.page)
  assert.equal(app.toasts, undefined)

  app.runtime.setRunning('s1', false)
  await flush()

  assert.equal(app.stub.instances.length, 1, 'missing overlay capability falls back to a system notification')
  assert.equal(app.stub.instances[0].title, '降级宿主')
})
