/** Registration and real jsdom settings behavior against the source client bundle. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { NOTIFICATION_COPY, NOTIFICATION_NS } from '../../src/modules/notification/client/locale.ts'
import {
  chatSnapshot, createFakeContext, createNotificationStub, createSoundFetchStub,
  loadNotificationModule, makeDom, mountComponent, sleep,
} from './helpers.mjs'

/** No host primitives: exercise the accessible fallback controls. */
function makeRequire() {
  const required = []
  const require = (id) => {
    required.push(id)
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: undefined, Button: undefined }
    throw new Error(`unexpected module ${id}`)
  }
  return { require, required }
}

async function bootPanel(t, options = {}) {
  const page = makeDom()
  const fetch = createSoundFetchStub(options.catalog)
  const stub = createNotificationStub(options.permission ?? {})
  const runtime = createFakeContext(options)
  const module = await loadNotificationModule(`notification-panel-${Math.random().toString(36).slice(2)}`)
  const { require } = makeRequire()
  module.default(require).apply(runtime.ctx)
  assert.deepEqual(fetch.requests, [], 'plugin registration must not fetch the catalogue or audio')
  const [{ Component }] = runtime.sections
  const app = await mountComponent(Component)
  t.after(async () => {
    await app.unmount()
    runtime.dispose()
    stub.restore()
    fetch.restore()
    page.restore()
  })
  return { page, fetch, stub, runtime, app, Component }
}

async function changeValue(page, node, value) {
  await act(async () => {
    const prototype = node.tagName === 'SELECT' ? page.window.HTMLSelectElement.prototype : page.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
    node.dispatchEvent(new page.window.Event(node.type === 'range' ? 'input' : 'change', { bubbles: true }))
    await sleep(10)
  })
}

function switchFor(document, title) {
  return document.querySelector(`[role="switch"][aria-label="${title}"]`)
}

function assertWrite(runtime, field, value) {
  assert.deepEqual(runtime.writes.at(-1), [{ op: 'set', path: ['notification', field], value }])
  assert.equal(runtime.formValues[field], value)
}

test('createNotification 工厂：全局 React、inject 契约、effect 顺序与词典/样式/设置页注册', async (t) => {
  assert.equal(globalThis.__dshReact, undefined, '工厂之前不应该已经有全局 JSX 工厂')
  const module = await loadNotificationModule('notification-registration')
  const { require, required } = makeRequire()
  const client = module.default(require)
  assert.equal(globalThis.__dshReact, React)
  assert.equal(client.name, 'dsh-toolkit-notification-client')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'configForms', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'workspaces'])
  assert.equal(typeof client.apply, 'function')
  const page = makeDom()
  const fetch = createSoundFetchStub()
  const runtime = createFakeContext()
  t.after(() => { runtime.dispose(); fetch.restore(); page.restore() })
  client.apply(runtime.ctx)
  assert.deepEqual(fetch.requests, [], 'registration stays lazy until panel mount or an event')
  // 只依赖宿主提供的 react 与 primitives：提醒走系统通知（`new Notification`），
  // 插件不再自己渲染应用内卡片，所以不需要 react-dom。
  assert.deepEqual([...new Set(required)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
  assert.deepEqual(runtime.effects, [
    'dsh-toolkit-notification:dictionary', 'dsh-toolkit-notification:stylesheet',
    'dsh-toolkit-notification:settings', 'dsh-toolkit-notification:sessions',
    'dsh-toolkit-notification:pending', 'dsh-toolkit-notification:audio-unlock',
    'dsh-toolkit-notification:sounds',
    'dsh-toolkit-notification:dismiss-visible',
    'dsh-toolkit-notification:section',
    'dsh-toolkit-notification:settings-icon',
  ])
  assert.equal(runtime.localeRegistrations.length, 1)
  assert.equal(runtime.localeRegistrations[0].namespace, NOTIFICATION_NS)
  assert.ok(NOTIFICATION_COPY.zh.nav)
  assert.ok(NOTIFICATION_COPY.en.nav)
  assert.deepEqual(Object.keys(runtime.localeRegistrations[0].dictionary).sort(), ['en', 'zh'])
  assert.equal(runtime.localeRegistrations[0].dictionary.zh.nav, '通知')
  const style = page.document.querySelector('style[data-plugin="dsh-toolkit-notification"]')
  assert.ok(style)
  const css = style.textContent.replace(/\s+/g, '')
  assert.match(css, /\.ntf-page\{/)
  assert.match(css, /\.ntf-row\{[^}]*padding:16px0/)
  assert.match(css, /\.ntf-row\{[^}]*border-bottom:0\.5pxsolidvar\(--dsw-alias-border-l2\)/)
  assert.match(css, /\.ntf-title\{[^}]*font-size:14px/)
  assert.match(css, /\.ntf-desc\{[^}]*font-size:12px/)
  assert.match(css, /\.ntf-card\{/)
  assert.match(css, /\.ntf-select\{[^}]*appearance:none/)
  assert.match(css, /\.ntf-select\{[^}]*background-position:right10pxcenter/)
  assert.match(css, /var\(--dsw-alias-/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/)
  const sections = runtime.sections.filter(({ meta }) => meta.name === 'settings.section')
  assert.equal(sections.length, 1)
  // 只有设置页一个注册点：应用内卡片通道已经移除。
  assert.deepEqual(runtime.overlays, [])
  const [{ meta, Component }] = sections
  assert.equal(meta.id, 'notification')
  assert.equal(meta.order, 24)
  assert.equal(meta.locale, NOTIFICATION_NS)
  assert.equal(meta.label(), '通知')
  assert.equal(typeof Component, 'function')
  runtime.dispose()
  assert.equal(page.document.querySelector('style[data-plugin="dsh-toolkit-notification"]'), null)
})

test('页面：四张分组卡片、全局声音与四种类型开关，无最近通知和范围控件', async (t) => {
  const { page, fetch, runtime, app } = await bootPanel(t)
  const document = page.document
  assert.equal(document.querySelector('.ntf-pageTitle').textContent, '通知')
  assert.deepEqual([...document.querySelectorAll('.ntf-section')].map((section) => section.getAttribute('aria-label')), ['通知', '提醒类型', '声音'])
  assert.equal(document.querySelectorAll('.ntf-card').length, 3)
  for (const row of document.querySelectorAll('.ntf-row')) {
    assert.ok(row.querySelector('.ntf-title'))
    assert.ok(row.querySelector('.ntf-desc'))
  }
  assert.doesNotMatch(document.body.textContent, /最近通知|通知范围/)
  assert.equal(document.querySelector('[class*="ntf-recent"]'), null)
  assert.equal(document.querySelectorAll('select').length, 2, 'global timing + sound selectors; no per-type sound or scope selectors')
  assert.equal(document.querySelectorAll('[role="switch"]').length, 6)
  assert.equal(fetch.requests.length, 1)
  assert.equal(fetch.requests[0].url.pathname, '/api/plugins/toolkit/notification/sounds')
  assert.equal(fetch.requests[0].options.method ?? 'GET', 'GET')

  const master = switchFor(document, '启用通知')
  assert.equal(master.getAttribute('aria-checked'), 'true')
  await app.click(master)
  assertWrite(runtime, 'enabled', false)
  assert.equal(master.getAttribute('aria-checked'), 'false')
  assert.equal(document.querySelector('.ntf-selectTiming').disabled, true)
  assert.equal(document.querySelector('.ntf-range').disabled, true)
  await app.click(master)
  assertWrite(runtime, 'enabled', true)

  for (const [title, field] of [['会话完成', 'completedEnabled'], ['会话失败', 'failedEnabled'], ['等待回答', 'questionEnabled'], ['需要授权', 'permissionEnabled']]) {
    const toggle = switchFor(document, title)
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    await app.click(toggle)
    assertWrite(runtime, field, false)
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
  }
  const audio = switchFor(document, '播放声音')
  await app.click(audio)
  assertWrite(runtime, 'soundEnabled', false)
  // 播放声音只影响通知自动播放；选音、试听、音量是独立的本地动作，不该跟着变灰。
  assert.equal(document.querySelector('.ntf-selectSound').disabled, false)
  assert.equal(document.querySelector('.ntf-range').disabled, false)
  assert.equal([...document.querySelectorAll('button')].find((node) => node.textContent === '试听').disabled, false)
  await app.click(audio)
  assertWrite(runtime, 'soundEnabled', true)
  const range = document.querySelector('.ntf-range')
  assert.equal(range.value, '100')
  assert.equal(document.querySelector('.ntf-volumeValue').textContent, '100%')
  await changeValue(page, range, '25')
  assertWrite(runtime, 'volume', 0.25)
  assert.equal(document.querySelector('.ntf-volumeValue').textContent, '25%')
  const sound = document.querySelector('.ntf-selectSound')
  assert.equal(sound.value, 'system')
  assert.deepEqual([...sound.options].map((option) => [option.value, option.textContent]), [['system', '系统默认'], ['a'.repeat(32), 'Glass']])
  await changeValue(page, sound, 'a'.repeat(32))
  assertWrite(runtime, 'sound', 'a'.repeat(32))
  assert.equal(sound.value, 'a'.repeat(32))
  const preview = [...document.querySelectorAll('button')].find((node) => node.textContent === '试听')
  assert.equal(preview.disabled, false)
  await app.click(preview)
  assert.match(document.querySelector('[role="alert"]').textContent, /声音无法播放/)
  assert.equal(fetch.requests.length, 1, 'without AudioContext preview never requests real audio')
})

test('音量连续拖动：保存中保持可用，串行写入并在失败时恢复已保存值', async (t) => {
  const { page, runtime } = await bootPanel(t)
  const range = page.document.querySelector('.ntf-range')
  const mutate = runtime.rootForm.mutate
  const pending = []
  runtime.rootForm.mutate = (operations) => new Promise((resolve, reject) => pending.push({ operations, resolve, reject }))
  await changeValue(page, range, '80')
  await changeValue(page, range, '30')
  assert.equal(range.disabled, false)
  assert.equal(range.value, '30')
  assert.equal(pending.length, 1, 'only one write may be in flight')
  await act(async () => { pending[0].resolve(mutate(pending[0].operations)); await sleep(10) })
  assert.equal(pending.length, 2)
  assert.equal(range.value, '30', 'an older saved snapshot must not move the thumb back')
  await act(async () => { pending[1].resolve(mutate(pending[1].operations)); await sleep(10) })
  assertWrite(runtime, 'volume', 0.3)
  await changeValue(page, range, '60')
  await act(async () => { pending[2].reject(new Error('volume write rejected')); await sleep(10) })
  assert.equal(range.value, '30')
  assert.match(page.document.querySelector('[role="alert"]').textContent, /volume write rejected/)
})

test('开关点击立即回显，写入在途期间不变灰', async (t) => {
  const { page, runtime, app } = await bootPanel(t)
  const document = page.document
  const master = switchFor(document, '启用通知')
  const completed = switchFor(document, '会话完成')
  const mutate = runtime.rootForm.mutate
  const pending = []
  runtime.rootForm.mutate = (operations) => new Promise((resolve, reject) => pending.push({ operations, resolve, reject }))
  await app.click(completed)
  assert.equal(completed.getAttribute('aria-checked'), 'false', '点击立刻回显')
  assert.equal(completed.disabled, false, '写入在途时开关不该变灰')
  assert.equal(pending.length, 1)
  // 依赖式禁用仍然即时生效：总开关返回 false 后，类型开关立刻不可点。
  await app.click(master)
  assert.equal(master.getAttribute('aria-checked'), 'false')
  assert.equal(master.disabled, false, '总开关保存中也保持可点')
  assert.equal(completed.disabled, true, '联动禁用跟随乐观值')
  assert.equal(document.querySelector('.ntf-selectTiming').disabled, true)
  await act(async () => { pending[0].resolve(mutate(pending[0].operations)); await sleep(10) })
  assert.deepEqual(runtime.writes[0], [{ op: 'set', path: ['notification', 'completedEnabled'], value: false }])
  assert.equal(completed.getAttribute('aria-checked'), 'false')
  await act(async () => { pending[1].resolve(mutate(pending[1].operations)); await sleep(10) })
  assertWrite(runtime, 'enabled', false)
  assert.equal(master.getAttribute('aria-checked'), 'false')
})

test('通知时机：原生 select 三选一、写入后重新挂载保留', async (t) => {
  const { page, runtime, app, Component } = await bootPanel(t)
  const document = page.document
  const timing = document.querySelector('.ntf-selectTiming')
  assert.ok(timing, 'the timing control is a native <select>')
  assert.equal(timing.tagName, 'SELECT')
  assert.equal(timing.value, 'unfocused')
  assert.deepEqual([...timing.options].map((option) => [option.value, option.textContent]), [['never', '从不'], ['unfocused', '仅在失焦时'], ['always', '始终']])
  await changeValue(page, timing, 'always')
  assertWrite(runtime, 'currentMode', 'always')
  assert.equal(timing.value, 'always')
  await changeValue(page, timing, 'never')
  assertWrite(runtime, 'currentMode', 'never')
  assert.deepEqual(runtime.writes.length, 2)
  await app.unmount()
  const remounted = await mountComponent(Component)
  assert.equal(document.querySelector('.ntf-selectTiming').value, 'never')
  await remounted.unmount()
})

test('移除最近通知列表后，系统通知仍使用会话标题和固定正文，点击打开会话', async (t) => {
  const { page, stub, runtime } = await bootPanel(t, {
    notification: { soundEnabled: false },
    sessions: { s1: { id: 's1', displayTitle: '修复登录问题', running: true } },
    chats: { s1: chatSnapshot({ reply: '这是修复后的最后回复' }) },
  })
  page.window.focus = () => {}
  await act(async () => { runtime.setRunning('s1', false); await sleep(450) })
  assert.equal(stub.instances.length, 1)
  assert.equal(stub.instances[0].title, '修复登录问题')
  assert.equal(stub.instances[0].options.body, '已完成这一轮回复。')
  assert.equal(page.document.querySelector('[class*="ntf-recent"]'), null)
  stub.instances[0].onclick()
  assert.deepEqual(runtime.openedSessions, ['s1'])
})

test('configForms 缺失时页面只读，禁用所有配置控件', async (t) => {
  const { page, runtime, app } = await bootPanel(t, { withConfigForms: false })
  assert.ok(page.document.querySelector('.ntf-page'))
  assert.match(page.document.body.textContent, /宿主没有提供可写的配置表单/)
  for (const control of page.document.querySelectorAll('[role="switch"], select, input')) assert.equal(control.disabled, true)
  await app.click(switchFor(page.document, '启用通知'))
  assert.deepEqual(runtime.writes, [])
})

test('缺少会话服务时页面照常注册和挂载', async (t) => {
  const { page } = await bootPanel(t, { withServices: false })
  assert.ok(page.document.querySelector('.ntf-pageTitle'))
})

test('测试通知仍可申请权限并发送；配置保存失败不会乐观更新', async (t) => {
  const { page, stub, runtime, app } = await bootPanel(t, { permission: { permission: 'default', requestResult: 'granted' } })
  page.window.focus = () => {}
  const button = (text) => [...page.document.querySelectorAll('button')].find((node) => node.textContent === text)
  // default 不是拒绝：桌面外壳的权限由系统侧决定，这里允许直接试发（失败有 error 级诊断）。
  assert.equal(button('发送测试通知').disabled, false)
  await app.click(button('发送测试通知'))
  assert.equal(stub.instances.length, 1, 'default 权限下也应当真的尝试发送')
  await app.click(button('授权'))
  assert.equal(button('授权'), undefined)
  assert.match(page.document.body.textContent, /通知权限：已授予|已获得通知权限/)
  await app.click(button('发送测试通知'))
  assert.equal(stub.instances.length, 2)
  assert.equal(page.document.querySelector('[role="status"]'), null, '发送成功后不再额外提示一条状态文案')
  assert.doesNotMatch(page.document.body.textContent, /已发送一条测试通知/)

  runtime.rootForm.mutate = async () => false
  await app.click(switchFor(page.document, '启用通知'))
  assert.match(page.document.querySelector('[role="alert"]').textContent, /保存失败|宿主拒绝/)
  assert.equal(switchFor(page.document, '启用通知').getAttribute('aria-checked'), 'true')
  assert.equal(runtime.formValues.enabled, true)
  assert.deepEqual(runtime.writes, [])

  runtime.rootForm.mutate = async () => { throw new Error('disk unavailable') }
  await changeValue(page, page.document.querySelector('.ntf-selectSound'), 'a'.repeat(32))
  assert.match(page.document.querySelector('[role="alert"]').textContent, /disk unavailable/)
  assert.equal(page.document.querySelector('.ntf-selectSound').value, 'system')
  assert.equal(runtime.formValues.sound, 'system')
  assert.deepEqual(runtime.writes, [])
})

test('声音目录不可用时保留系统默认和通知设置，并禁用试听', async (t) => {
  const { page, app } = await bootPanel(t, { catalog: { status: 503 } })
  const sound = page.document.querySelector('.ntf-selectSound')
  assert.equal(sound.value, 'system')
  assert.equal(sound.disabled, false)
  assert.match(page.document.body.textContent, /暂时无法读取系统声音/)
  const preview = [...page.document.querySelectorAll('button')].find((node) => node.textContent === '试听')
  assert.equal(preview.disabled, true)
  await app.click(switchFor(page.document, '启用通知'))
  assert.equal(switchFor(page.document, '启用通知').getAttribute('aria-checked'), 'false')
})
