/**
 * index.jsx 注册契约测试：用 esbuild 按主 bundle 的同一套 jsxFactory 打包 index.jsx，
 * 断言工厂/全局 React/样式/文案/`settings.section` 元数据，并把真实 Component 挂进
 * jsdom 跑一次（预算值来自 findScopedForm 投影出的配置表单）。
 *
 * 这样即使 CSS 只能由 esbuild 的 text loader 读进来（node 不能直接 import .css），
 * 工厂的真实装配路径也被覆盖。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'
import { USAGE_COPY, USAGE_NS } from '../../src/modules/usage/client/locale.js'
import { createSnapshot, okResponse } from './fixture.mjs'

/** 与 scripts/build-client.mjs 一致：JSX 走全局 __dshReact。 */
async function loadUsageModule() {
  const result = await build({
    entryPoints: ['src/modules/usage/client/index.jsx'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['react', 'react/*', '@deepseek-ai/*'],
    jsxFactory: '__dshReact.createElement',
    jsxFragment: '__dshReact.Fragment',
    loader: { '.js': 'jsx', '.css': 'text' },
    write: false,
    logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = 'node_modules/.cache/usage-client-registration.mjs'
  await writeFile(out, result.outputFiles[0].text)
  return import(`../../${out}?v=${Date.now()}`)
}

function makeDom(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'https://dsh.example.test',
  })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => okResponse(createSnapshot())
  const restore = () => {
    globalThis.fetch = originalFetch
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    dom.window.close()
  }
  return { dom, window: dom.window, document: dom.window.document, restore }
}

function createCtx({ withConfigForms = true } = {}) {
  const effects = []
  const cleanups = []
  const localeRegistrations = []
  const registrations = []
  const writes = []
  const rootForm = {
    writable: true,
    getSnapshot: () => ({
      value: { usage: { budget: 250, currency: 'USD', period: 'total' } },
      status: 'ready',
      writable: true,
    }),
    subscribe: () => () => {},
    mutate(operations) {
      writes.push(operations)
      return undefined
    },
  }
  const ctx = {
    effect(run, label) {
      effects.push(label)
      const teardown = run()
      if (typeof teardown === 'function') cleanups.push(teardown)
      return teardown
    },
    locale: {
      register(namespace, dictionary) {
        localeRegistrations.push({ namespace, dictionary })
        return () => {}
      },
      bind() {
        return (key) => USAGE_COPY.zh[key] ?? key
      },
    },
    slots: {
      inject(name, run) {
        assert.ok(name === 'sidebar.panellist' || name === 'main', `unexpected slot ${name}`)
        return run()
      },
      register(meta, Component) {
        registrations.push({ meta, Component })
        return () => {}
      },
    },
  }
  if (withConfigForms) ctx.configForms = { get: (entryId) => (entryId === 'shell-kit' ? rootForm : undefined) }
  return { ctx, effects, cleanups, localeRegistrations, registrations, writes, rootForm }
}

async function settle(ms = 25) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mountPage(t, Component, page = makeDom(t)) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(page.document.getElementById('root'))
  t.after(async () => {
    try {
      await act(async () => root.unmount())
    } catch {
      // 渲染失败的用例也要清理。
    }
    page.restore()
  })
  await act(async () => {
    root.render(React.createElement(Component))
  })
  await settle()
  return page
}

test('createUsage 工厂：全局 React、inject 契约、词典/样式/页面注册与清理', async (t) => {
  // 在调用工厂前，全局 JSX 工厂必须还没有被设置（由工厂负责设置）。
  assert.equal(globalThis.__dshReact, undefined)
  const module = await loadUsageModule()
  const createUsage = module.default
  assert.equal(typeof createUsage, 'function')
  const client = createUsage((id) => {
    assert.equal(id, 'react')
    return React
  })
  assert.equal(globalThis.__dshReact, React, 'factory must publish __dshReact for JSX modules')
  assert.equal(client.name, 'toolkit-usage-client')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'configForms'])
  assert.equal(typeof client.apply, 'function')

  const page = makeDom(t)
  t.after(() => page.restore())
  const state = createCtx()
  client.apply(state.ctx)

  // 4 个 effect：词典 / 样式 / 左侧栏图标 / 中栏面板，标签稳定（集成测试按标签断言）。
  assert.deepEqual(state.effects, [
    'toolkit-usage:dictionary',
    'toolkit-usage:stylesheet',
    'toolkit-usage:sidebar-icon',
    'toolkit-usage:main-panel',
  ])

  // 词典注册到契约命名空间，zh/en 都在。
  assert.equal(state.localeRegistrations.length, 1)
  assert.equal(state.localeRegistrations[0].namespace, USAGE_NS)
  assert.ok(state.localeRegistrations[0].dictionary.zh)
  assert.ok(state.localeRegistrations[0].dictionary.en)

  // 样式独立安装：data-plugin=toolkit-usage、usg- 前缀、只用主题变量。
  const style = page.document.querySelector('style[data-plugin="toolkit-usage"]')
  assert.ok(style, 'stylesheet installed via installStylesheet(css, "toolkit-usage")')
  const css = style.textContent
  assert.ok(css.length > 0)
  assert.match(css, /\.usg-page/)
  assert.match(css, /var\(--dsw-alias-/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no hardcoded hex colours')
  assert.doesNotMatch(css, /\brgba?\(\s*\d+\s*,/, 'no hardcoded rgb() colours')

  // 左侧栏图标：id/order/label（在「自动化任务」order 10 之后）。
  const icons = state.registrations.filter(({ meta }) => meta.name === 'sidebar.panellist')
  assert.equal(icons.length, 1)
  const [{ meta: iconMeta, Component: Icon }] = icons
  assert.equal(iconMeta.id, 'usage-tokens')
  assert.equal(iconMeta.order, 11)
  assert.equal(typeof iconMeta.label, 'function')
  assert.equal(iconMeta.label(), '用量统计')
  assert.equal(typeof Icon, 'function')
  // owner 传入 { size, active }；选中态和普通态都能画出 SVG 且不崩。
  const inert = React.createElement(Icon, { size: 18, active: false })
  assert.equal(inert.props.size, 18)
  const iconNode = Icon({ size: 18, active: true })
  assert.equal(iconNode.type, 'svg')
  assert.equal(iconNode.props.width, 18)
  assert.equal(iconNode.props['data-active'], 'true')
  assert.ok(iconNode.props.children.length > 0)

  // 中栏面板：key 与图标 id 相同，点图标即打开。
  const panels = state.registrations.filter(({ meta }) => meta.name === 'main')
  assert.equal(panels.length, 1)
  const [{ meta: panelMeta, Component }] = panels
  assert.equal(panelMeta.key, 'usage-tokens')
  assert.equal(typeof Component, 'function')

  // 不再注册设置页（入口只在左侧栏）。
  assert.equal(state.registrations.some(({ meta }) => meta.name === 'settings.section'), false)

  // 卸载：样式被 effect 清理掉（页面不泄漏）。
  for (const teardown of state.cleanups.reverse()) teardown()
  assert.equal(page.document.querySelector('style[data-plugin="toolkit-usage"]'), null)
})

test('真实 Component 从配置表单读预算并挂载渲染，预算写回 usage 命名空间', async (t) => {
  const module = await loadUsageModule()
  const client = module.default((id) => {
    assert.equal(id, 'react')
    return React
  })
  const state = createCtx()
  const page = makeDom(t)
  client.apply(state.ctx)
  const [{ Component }] = state.registrations.filter(({ meta }) => meta.name === 'main')

  const app = await mountPage(t, Component, page)
  const document = app.document
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M')
  // 表单（budget 250 USD total）优先于快照里的 budget 100 CNY month。
  const input = document.querySelector('.usg-budgetInput')
  assert.equal(input.value, '250')
  assert.equal(document.querySelector('.usg-budgetCurrency').value, 'USD')
  assert.equal(document.querySelector('.usg-budgetPeriod').value, 'total')
  assert.match(document.body.textContent, /已用/)

  // 保存：三个字段都以 [usage, field] 路径写回 scoped form。
  const setter = Object.getOwnPropertyDescriptor(app.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, '300')
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }))
  })
  await act(async () => {
    document.querySelector('.usg-budgetForm').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle()
  assert.deepEqual(state.writes.map((operations) => operations[0].op), ['set', 'set', 'set'])
  assert.deepEqual(state.writes.map((operations) => operations[0].path), [['usage', 'budget'], ['usage', 'currency'], ['usage', 'period']])
  assert.deepEqual(state.writes.map((operations) => operations[0].value), [300, 'USD', 'total'])
  assert.match(document.body.textContent, /已保存/)

  // 测试结束由 mountPage 的 after 钩子卸载并恢复全局；这里只清理 effect。
  for (const teardown of state.cleanups.reverse()) teardown()
})

test('configForms 缺失时仍注册左侧栏入口，页面预算只读且不崩溃', async (t) => {
  const module = await loadUsageModule()
  const client = module.default((id) => {
    assert.equal(id, 'react')
    return React
  })
  const state = createCtx({ withConfigForms: false })
  const page = makeDom(t)
  client.apply(state.ctx)
  assert.deepEqual(state.effects, [
    'toolkit-usage:dictionary',
    'toolkit-usage:stylesheet',
    'toolkit-usage:sidebar-icon',
    'toolkit-usage:main-panel',
  ])
  const [{ Component }] = state.registrations.filter(({ meta }) => meta.name === 'main')

  const app = await mountPage(t, Component, page)
  const document = app.document
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M')
  assert.equal(document.querySelector('.usg-budgetInput').disabled, true)
  assert.match(document.body.textContent, /宿主未提供配置表单，预算只能只读展示。/)
  for (const teardown of state.cleanups.reverse()) teardown()
})
