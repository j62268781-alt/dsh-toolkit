/**
 * 设置页「用量统计」的 jsdom 渲染测试。
 *
 * 用真实形状的快照（docs/usage/README.md）喂给被 mock 的 fetch，挂载 `createUsagePanel`
 * 生成的组件，断言 KPI / 预算 / 时间线 / 会话表 / CPU 都画出了真实数字；
 * 另测排序、只读降级、保存预算、错误与空态。全程不发网络请求。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createUsagePanel } from '../../src/modules/usage/client/panel.jsx'
import { createTranslator } from '../../src/modules/usage/client/locale.js'
import { createSnapshot, okResponse } from './fixture.mjs'

// panel.jsx 里的 JSX 走主 bundle 的全局 jsxFactory（__dshReact.createElement）。
globalThis.__dshReact = React

function setupDom(t) {
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
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    restore() {
      globalThis.fetch = originalFetch
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
      dom.window.close()
    },
  }
}

async function settle(ms = 25) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mount(t, options = {}) {
  const dom = setupDom(t)
  // react-dom 必须在 jsdom 全局就位后再加载：它初始化时捕获 window/document，
  // 先静态 import 会让事件系统以为在 SSR 环境里，onChange 不会触发。
  const { createRoot } = await import('react-dom/client')
  const calls = { fetch: 0 }
  let fetchImpl = options.fetchImpl ?? (() => okResponse(createSnapshot()))
  globalThis.fetch = async (...args) => {
    calls.fetch += 1
    return fetchImpl(calls.fetch, ...args)
  }
  const Panel = createUsagePanel(React, {
    form: options.form,
    entryId: 'shell-kit',
    t: options.t ?? createTranslator(undefined),
    locale: 'zh-CN',
  })
  const root = createRoot(dom.document.getElementById('root'))
  t.after(async () => {
    try {
      await act(async () => root.unmount())
    } catch {
      // 组件已经卸载或渲染失败；清理仍然要跑。
    }
    dom.restore()
  })
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await settle()
  return {
    dom: dom.dom,
    window: dom.window,
    document: dom.document,
    calls,
    root,
    setFetchImpl(impl) {
      fetchImpl = impl
    },
  }
}

async function click(node) {
  assert.ok(node, 'element must exist before clicking')
  await act(async () => {
    node.click()
  })
  await settle(10)
}

async function setInputValue(app, input, value) {
  const setter = Object.getOwnPropertyDescriptor(app.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }))
  })
  await settle(5)
}

async function submitForm(app, formElement) {
  await act(async () => {
    formElement.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle(10)
}

function rowTitles(document) {
  return [...document.querySelectorAll('tr.usg-sessionRow .usg-sessionTitle')].map((node) => node.textContent)
}

test('mocked 快照渲染出 KPI / 预算 / 时间线 / 会话 / CPU 的真实数字', async (t) => {
  const form = {
    writable: true,
    getSnapshot: () => ({
      value: { budget: 100, currency: 'CNY', period: 'month' },
      status: 'ready',
      writable: true,
    }),
    subscribe: () => () => {},
    set: () => {},
  }
  const app = await mount(t, { form })
  const document = app.document

  /* KPI：4 张卡，总 token 紧凑显示，token 四项分项在卡片里可见 */
  const kpis = [...document.querySelectorAll('.usg-kpi')]
  assert.deepEqual(kpis.map((node) => node.dataset.kpi), ['tokens', 'sessions', 'cost', 'budget'])
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M')
  const breakdown = document.querySelector('.usg-tokenBreakdown').textContent
  assert.match(breakdown, /输入 12K/)
  assert.match(breakdown, /输出 45K/)
  assert.match(breakdown, /缓存读 1\.2M/)
  assert.match(breakdown, /缓存写 17\.6K/)
  assert.equal(document.querySelector('.usg-sessionCount').textContent, '3')
  assert.match(document.querySelector('.usg-cost').textContent, /0\.0123/)
  assert.match(document.querySelector('.usg-budget').textContent, /100/)
  // 成本 KPI 必须说明「高峰单价估算」，不能假装是最终账单
  assert.match(document.querySelector('.usg-kpi[data-kpi="cost"]').textContent, /高峰单价估算/)
  assert.match(document.querySelector('.usg-kpi[data-kpi="sessions"]').textContent, /1 个活跃/)

  /* 预算进度条 */
  const bar = document.querySelector('.usg-budgetBar')
  assert.ok(bar, 'budget progressbar rendered')
  assert.equal(bar.getAttribute('role'), 'progressbar')
  assert.equal(bar.dataset.tone, 'normal')
  assert.equal(bar.getAttribute('aria-valuenow'), '0.01')
  assert.equal(document.querySelector('.usg-budgetFill').style.width, '0.01%')
  assert.match(document.querySelector('.usg-budgetPercent').textContent, /0\.01%/)
  assert.match(document.querySelector('.usg-budgetInfo').textContent, /已用/)

  /* 内联预算编辑器（可写） */
  const budgetInput = document.querySelector('.usg-budgetInput')
  assert.equal(budgetInput.value, '100')
  assert.equal(budgetInput.disabled, false)
  assert.equal(document.querySelector('.usg-budgetCurrency').value, 'CNY')
  assert.equal(document.querySelector('.usg-budgetPeriod').value, 'month')

  /* 时间线：14 根柱 + 折线路径 + 横轴 */
  assert.equal(document.querySelectorAll('.usg-chartBar').length, 14)
  const line = document.querySelector('.usg-chartLine')
  assert.ok(line)
  assert.match(line.getAttribute('d'), /^M/)
  assert.equal(document.querySelectorAll('.usg-chartAxis span').length, 8)
  assert.match(document.querySelector('.usg-timeline .usg-cardMeta').textContent, /最近 14 天/)

  /* 会话表：3 行、默认 token 降序、活跃/子代理徽章、cwd */
  assert.deepEqual(rowTitles(document), ['Greeting', 'Sub agent task', 'Tiny task'])
  const rows = [...document.querySelectorAll('tr.usg-sessionRow')]
  assert.equal(rows.length, 3)
  assert.equal(document.querySelectorAll('.usg-badge[data-tone="live"]').length, 1)
  assert.equal(document.querySelectorAll('.usg-badge[data-tone="subagent"]').length, 1)
  assert.match(rows[0].textContent, /活跃/)
  assert.match(rows[1].textContent, /子代理/)
  assert.match(rows[0].textContent, /D:\\项目\\dsh-toolkit/)
  assert.match(rows[0].textContent, /turing \/ deepseek-flash/)
  assert.equal(rows[0].querySelectorAll('td')[3].textContent, '507K')

  /* CPU 面板 */
  assert.equal(document.querySelector('.usg-cpuProcess').textContent, '3.2%')
  assert.equal(document.querySelector('.usg-cpuSystem').textContent, '12.5%')
  assert.equal(document.querySelector('.usg-cpuMemory').textContent, '256 MB')
  assert.equal(document.querySelectorAll('.usg-sparkLine').length, 2, '主进程 + 整机两条折线')
  const spark = document.querySelector('.usg-sparkLine[data-series="process"]')
  assert.match(spark.getAttribute('points'), /^\d+(\.\d+)?,\d+(\.\d+)? /)
  assert.match(document.querySelector('.usg-cpuFacts').textContent, /16 核/)
  assert.match(document.querySelector('.usg-cpuFacts').textContent, /1\.20 \/ 0\.90 \/ 0\.70/)

  /* 页脚：价格来源与扫描统计 */
  assert.match(document.querySelector('.usg-foot').textContent, /单价：内置/)
  assert.match(document.querySelector('.usg-foot').textContent, /扫描 3 个文件/)

  /* 手动刷新按钮会再拉一次快照 */
  const before = app.calls.fetch
  await click([...document.querySelectorAll('button')].find((node) => node.textContent === '刷新'))
  assert.ok(app.calls.fetch > before, 'refresh button must refetch the snapshot')
})

test('token 列表头可排序：默认降序，点击后升序', async (t) => {
  const app = await mount(t)
  const document = app.document
  assert.deepEqual(rowTitles(document), ['Greeting', 'Sub agent task', 'Tiny task'])

  const sortButton = document.querySelector('.usg-sortButton[aria-label="按 token 排序"]')
  assert.ok(sortButton, 'token column sort button')
  const headerCell = sortButton.closest('th')
  assert.equal(headerCell.getAttribute('aria-sort'), 'descending')
  assert.equal(sortButton.dataset.active, 'true')

  await click(sortButton)
  assert.deepEqual(rowTitles(document), ['Tiny task', 'Sub agent task', 'Greeting'])
  assert.equal(sortButton.closest('th').getAttribute('aria-sort'), 'ascending')
})

test('缺少配置表单时预算只读，但页面照常渲染真实数据', async (t) => {
  const app = await mount(t, { form: undefined })
  const document = app.document

  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M')
  const input = document.querySelector('.usg-budgetInput')
  assert.ok(input)
  assert.equal(input.disabled, true, 'read-only budget input')
  assert.equal(document.querySelector('.usg-budgetSave').disabled, true)
  assert.match(document.body.textContent, /宿主未提供配置表单，预算只能只读展示。/)
  // 快照里的预算仍然展示出来（只读不等于不显示）
  assert.match(document.querySelector('.usg-budget').textContent, /100/)
})

test('保存预算通过 form.set(budget/currency/period) 写回并刷新快照', async (t) => {
  const writes = []
  const form = {
    writable: true,
    getSnapshot: () => ({
      value: { budget: 100, currency: 'CNY', period: 'month' },
      status: 'ready',
      writable: true,
    }),
    subscribe: () => () => {},
    set: (path, value) => {
      writes.push([path, value])
    },
  }
  const app = await mount(t, { form })
  const document = app.document
  assert.equal(document.querySelector('.usg-budgetInput').value, '100')

  const before = app.calls.fetch
  await setInputValue(app, document.querySelector('.usg-budgetInput'), '250')
  await submitForm(app, document.querySelector('.usg-budgetForm'))

  assert.deepEqual(writes, [['budget', 250], ['currency', 'CNY'], ['period', 'month']])
  assert.match(document.body.textContent, /已保存/)
  assert.ok(app.calls.fetch > before, 'saving the budget refreshes the snapshot')
})

test('首次请求失败显示错误与重试；点重试后渲染数据', async (t) => {
  let fail = true
  const app = await mount(t, {
    fetchImpl: () => {
      if (fail) throw new Error('network down')
      return okResponse(createSnapshot())
    },
  })
  const document = app.document
  assert.match(document.querySelector('[role="alert"]').textContent, /读取用量快照失败/)
  assert.match(document.body.textContent, /读取用量快照失败/)
  assert.equal(document.querySelector('.usg-kpi'), null)

  fail = false
  await click([...document.querySelectorAll('button')].find((node) => node.textContent === '重试'))
  assert.equal(document.querySelector('[role="alert"]'), null)
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M')
})

test('后续刷新失败时保留上一份数据并提示过期', async (t) => {
  const app = await mount(t, {
    fetchImpl: (count) => {
      if (count === 1) return okResponse(createSnapshot())
      throw new Error('network down')
    },
  })
  const document = app.document
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M')

  await click([...document.querySelectorAll('button')].find((node) => node.textContent === '刷新'))
  const alert = document.querySelector('[role="alert"]')
  assert.ok(alert, 'stale error line')
  assert.match(alert.textContent, /刷新失败，下面是上一次的数据/)
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '1.2M', 'data survives a failed refresh')
})

test('空数据给出空态文案而不是崩溃', async (t) => {
  const payload = createSnapshot({
    sessionCount: 0,
    sessions: [],
    timeline: { bucket: 'day', days: 14, buckets: [] },
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
    cost: { amount: 0, currency: 'CNY', unpricedTokens: 0 },
    budget: { amount: 0, currency: 'CNY', period: 'month', spent: 0, remaining: 0, ratio: 0, periodStart: 0, configured: false },
    cpu: {
      processPercent: 0,
      systemPercent: 0,
      cores: 0,
      load: [],
      memory: { rss: 0, heapUsed: 0, heapTotal: 0, systemTotal: 0, systemFree: 0 },
      uptimeSec: 0,
      sampledAt: 0,
      warmingUp: true,
      history: [],
    },
  })
  const app = await mount(t, { fetchImpl: () => okResponse(payload) })
  const document = app.document
  assert.equal(document.querySelector('.usg-totalTokens').textContent, '0')
  assert.match(document.querySelector('.usg-sessions').textContent, /还没有可统计的会话/)
  assert.match(document.querySelector('.usg-timeline').textContent, /还没有 token 记录/)
  assert.match(document.querySelector('.usg-budget').textContent, /未设置预算/)
  assert.match(document.querySelector('.usg-cpu').textContent, /采样预热中/)
})
