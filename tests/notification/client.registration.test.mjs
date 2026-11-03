/**
 * 注册契约与页面渲染测试。
 *
 * 用 esbuild 按主 bundle 同一套 jsxFactory 现场打包 `index.jsx`，断言：
 *   - 工厂负责发布全局 `__dshReact`、inject 契约、effect 标签顺序；
 *   - 词典注册到 `dsh-toolkit.notification`，样式以 `toolkit-notification` 安装且只用主题变量；
 *   - `settings.section` 的 id/order/locale/label；
 *   - 把页面真正挂进 jsdom：行渲染、开关写回 `notification.<field>`、下拉/滑块写回、只读降级、卸载清理。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { NOTIFICATION_COPY, NOTIFICATION_NS } from '../../src/modules/notification/client/locale.js'
import {
  chatSnapshot, createFakeContext, createNotificationStub, loadNotificationModule, makeDom, mountComponent, sleep,
} from './helpers.mjs'

/** 工厂的 require：react + 一个「没有 primitives」的降级环境（组件走自绘控件）。 */
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

test('createNotification 工厂：全局 React、inject 契约、effect 顺序与词典/样式/设置页注册', async (t) => {
  assert.equal(globalThis.__dshReact, undefined, '工厂之前不应该已经有全局 JSX 工厂')
  const module = await loadNotificationModule('notification-registration')
  const { require, required } = makeRequire()
  const client = module.default(require)
  assert.equal(globalThis.__dshReact, React, 'factory must publish __dshReact for JSX modules')
  assert.equal(client.name, 'toolkit-notification-client')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'configForms', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'workspaces'])
  assert.equal(typeof client.apply, 'function')

  const page = makeDom()
  t.after(() => page.restore())
  const runtime = createFakeContext()
  client.apply(runtime.ctx)
  // 页面需要官方 primitives 的 Switch/Button；缺失时组件会回落到自绘控件。
  assert.deepEqual([...new Set(required)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])

  assert.deepEqual(runtime.effects, [
    'toolkit-notification:dictionary',
    'toolkit-notification:stylesheet',
    'toolkit-notification:settings',
    'toolkit-notification:sessions',
    'toolkit-notification:pending',
    'toolkit-notification:sounds',
    'toolkit-notification:section',
  ])

  // 词典：命名空间 + 中英文都在。
  assert.equal(runtime.localeRegistrations.length, 1)
  assert.equal(runtime.localeRegistrations[0].namespace, NOTIFICATION_NS)
  assert.ok(NOTIFICATION_COPY.zh.nav)
  assert.ok(NOTIFICATION_COPY.en.nav)
  // 打包后的模块内联了自己那份词典，比较结构而不是对象身份。
  assert.deepEqual(Object.keys(runtime.localeRegistrations[0].dictionary).sort(), ['en', 'zh'])
  assert.equal(runtime.localeRegistrations[0].dictionary.zh.nav, '通知')

  // 样式：独立的 style 标签、ntf- 前缀、只用主题变量、复用通用设置页的行几何。
  const style = page.document.querySelector('style[data-plugin="toolkit-notification"]')
  assert.ok(style, 'stylesheet installed via installStylesheet(css, "toolkit-notification")')
  const css = style.textContent.replace(/\s+/g, '')
  assert.match(css, /\.ntf-page\{/)
  assert.match(css, /\.ntf-row\{[^}]*padding:16px0/)
  assert.match(css, /\.ntf-row\{[^}]*border-bottom:0\.5pxsolidvar\(--dsw-alias-border-l2\)/)
  assert.match(css, /\.ntf-title\{[^}]*font-size:14px/)
  assert.match(css, /\.ntf-desc\{[^}]*font-size:12px/)
  assert.match(css, /\.ntf-recentButton\{/)
  assert.match(css, /var\(--dsw-alias-/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/, 'no hardcoded hex colours')

  // 设置页：接在 usage(23) 之后，label 走词典而不是硬编码。
  const sections = runtime.sections.filter(({ meta }) => meta.name === 'settings.section')
  assert.equal(sections.length, 1)
  const [{ meta, Component }] = sections
  assert.equal(meta.id, 'notification')
  assert.equal(meta.order, 24)
  assert.equal(meta.locale, NOTIFICATION_NS)
  assert.equal(meta.label(), '通知')
  assert.equal(typeof Component, 'function')

  // 卸载：样式标签被 effect 清理。
  runtime.dispose()
  assert.equal(page.document.querySelector('style[data-plugin="toolkit-notification"]'), null)
})

test('页面渲染：行用 title + 副标题，开关与下拉写回 notification 命名空间', async (t) => {
  const module = await loadNotificationModule('notification-panel')
  const { require } = makeRequire()
  const client = module.default(require)
  const page = makeDom()
  t.after(() => page.restore())
  const runtime = createFakeContext({
    sessions: { s1: { id: 's1', displayTitle: '修复登录问题', running: false } },
  })
  client.apply(runtime.ctx)
  const [{ Component }] = runtime.sections
  const app = await mountComponent(Component)
  t.after(() => app.unmount())

  const document = page.document
  assert.equal(document.querySelector('.ntf-pageTitle').textContent, '通知')
  // 每一行都有 title + 副标题（通用设置页的 item 结构）。
  const rows = [...document.querySelectorAll('.ntf-row')]
  assert.ok(rows.length >= 8, `expected the settings rows, got ${rows.length}`)
  for (const row of rows) {
    assert.ok(row.querySelector('.ntf-title'), 'every row has a title')
  }
  assert.ok(document.body.textContent.includes('通知提醒'))
  assert.ok(document.body.textContent.includes('当前会话提醒时机'))
  assert.ok(document.body.textContent.includes('通知范围'))
  assert.ok(document.body.textContent.includes('会话完成'))
  assert.ok(document.body.textContent.includes('需要授权'))
  assert.ok(document.querySelector('.ntf-empty'), 'recent list starts empty')

  // 总开关：默认开，点一下写回 enabled=false。
  const master = document.querySelectorAll('.ntf-switch')[0]
  assert.equal(master.getAttribute('aria-checked'), 'true')
  assert.equal(master.getAttribute('aria-label'), '通知提醒')
  await app.click(master)
  assert.equal(runtime.writes.at(-1)[0].path[0], 'notification')
  assert.equal(runtime.writes.at(-1)[0].path[1], 'enabled')
  assert.equal(runtime.writes.at(-1)[0].value, false)
  assert.equal(runtime.formValues.enabled, false)
  assert.equal(document.querySelectorAll('.ntf-switch')[0].getAttribute('aria-checked'), 'false')

  // 「当前会话提醒时机」下拉：写回 currentMode。
  const currentSelect = document.querySelectorAll('.ntf-select')[0]
  assert.equal(currentSelect.value, 'hidden')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(page.window.HTMLSelectElement.prototype, 'value').set
    setter.call(currentSelect, 'always')
    currentSelect.dispatchEvent(new page.window.Event('change', { bubbles: true }))
  })
  await act(async () => {
    await sleep(10)
  })
  assert.deepEqual(runtime.writes.at(-1)[0].path, ['notification', 'currentMode'])
  assert.equal(runtime.writes.at(-1)[0].value, 'always')

  // 音量滑块：0..100 的 UI 值写回 0..1 的配置值。
  const range = document.querySelector('.ntf-range')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(page.window.HTMLInputElement.prototype, 'value').set
    setter.call(range, '25')
    range.dispatchEvent(new page.window.Event('change', { bubbles: true }))
  })
  await act(async () => {
    await sleep(10)
  })
  assert.deepEqual(runtime.writes.at(-1)[0].path, ['notification', 'volume'])
  assert.equal(runtime.writes.at(-1)[0].value, 0.25)

  // 类型行：单独关掉「会话失败」写回 failedEnabled（先把总开关打回开，类型开关才可操作）。
  await app.click(document.querySelectorAll('.ntf-switch')[0])
  const failedRow = rows.find((row) => row.textContent.includes('会话失败'))
  const failedSwitch = failedRow.querySelector('.ntf-switch')
  await app.click(failedSwitch)
  assert.deepEqual(runtime.writes.at(-1)[0].path, ['notification', 'failedEnabled'])
  assert.equal(runtime.writes.at(-1)[0].value, false)
})

test('最近通知：标题 = 会话标题、副标题 = 最终回复，点击重新打开会话', async (t) => {
  const module = await loadNotificationModule('notification-recent')
  const { require } = makeRequire()
  const client = module.default(require)
  const page = makeDom()
  t.after(() => page.restore())
  page.window.focus = () => {}
  const stub = createNotificationStub({ permission: 'granted' })
  t.after(() => stub.restore())
  const runtime = createFakeContext({
    sessions: { s1: { id: 's1', displayTitle: '修复登录问题', running: true } },
    chats: { s1: chatSnapshot({ reply: '这是修复后的最后回复' }) },
  })
  client.apply(runtime.ctx)
  const [{ Component }] = runtime.sections

  const app = await mountComponent(Component)
  t.after(() => app.unmount())

  // 会话跑完：等 settle 窗口（250ms）+ 分发链路落地。
  runtime.setRunning('s1', false)
  await act(async () => {
    await sleep(450)
  })

  assert.equal(stub.instances.length, 1, 'one system notification must be shown')
  assert.equal(stub.instances[0].title, '修复登录问题', 'notification title is the session title')
  assert.equal(stub.instances[0].options.body, '这是修复后的最后回复', 'notification body is the final reply')

  const title = page.document.querySelector('.ntf-recentTitle')
  const body = page.document.querySelector('.ntf-recentBody')
  assert.ok(title, 'a recent notification row must appear')
  assert.equal(title.textContent, '修复登录问题')
  assert.equal(body.textContent, '这是修复后的最后回复')

  const before = runtime.openedSessions.length
  await app.click(page.document.querySelector('.ntf-recentButton'))
  assert.equal(runtime.openedSessions.length, before + 1)
  assert.equal(runtime.openedSessions.at(-1), 's1')

  // 点击系统通知本身也回到对应会话。
  stub.instances[0].onclick()
  assert.equal(runtime.openedSessions.at(-1), 's1')
})

test('configForms 缺失时页面降级为只读，仍然渲染且不抛错', async (t) => {
  const module = await loadNotificationModule('notification-readonly')
  const { require } = makeRequire()
  const client = module.default(require)
  const page = makeDom()
  t.after(() => page.restore())
  const runtime = createFakeContext({ withConfigForms: false })
  client.apply(runtime.ctx)
  const [{ Component }] = runtime.sections
  const app = await mountComponent(Component)
  t.after(() => app.unmount())

  assert.ok(page.document.querySelector('.ntf-page'))
  assert.match(page.document.body.textContent, /宿主没有提供可写的配置表单/)
  const master = page.document.querySelectorAll('.ntf-switch')[0]
  assert.equal(master.disabled, true, 'switches are disabled without a writable form')
  await app.click(master)
  assert.deepEqual(runtime.writes, [])
})

test('缺少会话服务时页面照常注册，只是不会发出通知', async (t) => {
  const module = await loadNotificationModule('notification-noservices')
  const { require } = makeRequire()
  const client = module.default(require)
  const page = makeDom()
  t.after(() => page.restore())
  const runtime = createFakeContext({ withServices: false })
  assert.doesNotThrow(() => client.apply(runtime.ctx))
  assert.equal(runtime.sections.length, 1)
  const [{ Component }] = runtime.sections
  const app = await mountComponent(Component)
  t.after(() => app.unmount())
  assert.ok(page.document.querySelector('.ntf-pageTitle'))
})
