/**
 * 任务监控右栏 body 的交互：分区/行/查看更多/折叠、原生打开、添加来源（Menu+Modal 与
 * 无 primitives 降级两条路）、乐观移除与回滚、错误态重试。fetch 全替身，不碰网络。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React from 'react'
import { TASK_MONITOR_COPY } from '../../src/modules/task-monitor/client/locale.ts'
import { TASK_MONITOR_SNAPSHOT_PATH, TASK_MONITOR_SOURCE_ADD_PATH, TASK_MONITOR_SOURCE_REMOVE_PATH } from '../../src/modules/task-monitor/host/constants.ts'
import { GIT_BRANCHES_PATH } from '../../src/modules/git/host/constants.ts'

const ENTRY = 'src/modules/task-monitor/client/surfaces/sidebar-tab/index.tsx'

const entry = (id, kind, extra = {}) => ({ id, kind, label: id, detail: '', count: 1, status: 'ok', updatedAt: 1700000000000, ...extra })

function translator() {
  return (key, params) => {
    let text = TASK_MONITOR_COPY.zh[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
}

function fakePrimitives() {
  const icon = () => React.createElement('i', null, '•')
  return {
    Button: ({ children, onClick, disabled, variant }) => React.createElement('button', { 'data-variant': variant, onClick, disabled }, children),
    Input: (props) => React.createElement('input', props),
    Menu: ({ anchor, items, open, onSelect }) => React.createElement('div', { className: 'fake-menu' }, anchor, open
      ? React.createElement('ul', null, items.map((item) => React.createElement('li', { key: item.id }, React.createElement('button', { onClick: () => onSelect(item.id) }, item.label))))
      : null),
    Modal: ({ title, description, children, footer }) => React.createElement('div', { className: 'fake-modal', role: 'dialog' },
      React.createElement('h3', null, title), React.createElement('p', null, description), children,
      React.createElement('div', { className: 'fake-modal-foot' }, footer)),
    IconChevronDownOutlineRegular: icon,
    IconRefreshOutlineRegular: icon,
    IconPlusOutlineRegular: icon,
    IconCloseOutlineRegular: icon,
    IconBranchOutlineRegular: icon,
    IconSparkleRegular: icon,
    IconEditOutlineRegular: icon,
    IconGlobeOutlineRegular: icon,
    IconLinkOutlineRegular: icon,
    IconThinkOutlineRegular: icon,
    IconApiOutlineRegular: icon,
    IconBrowseOutlineRegular: icon,
    IconSearchOutlineRegular: icon,
  }
}

const bundleCache = new Map()
async function loadEntry(variant) {
  if (!bundleCache.has(variant)) {
    bundleCache.set(variant, (async () => {
      const result = await build({
        entryPoints: [ENTRY],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
        jsx: 'automatic',
        loader: { '.css': 'text' },
        write: false,
        logLevel: 'silent',
      })
      await mkdir('node_modules/.cache', { recursive: true })
      const path = `node_modules/.cache/sidebar-tab-${variant}.mjs`
      await writeFile(path, result.outputFiles[0].text)
      return path
    })())
  }
  const path = await bundleCache.get(variant)
  return import(new URL(`../../${path}`, import.meta.url).href)
}

function withDom(t, { host = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://dsh.example.test',
    pretendToBeVisual: true,
  })
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  if (host) {
    globals.require = (id) => {
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives()
      if (id === '@deepseek-ai/dsh-util-workspace-path') {
        return { fileAddressFor: (sessionId, cwd, path) => `dsh-resource://file/session/${sessionId}/${encodeURIComponent(path)}` }
      }
      throw new Error(`unexpected require ${id}`)
    }
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  // 不能在这里登记 t.after：node:test 的 after 钩子按注册顺序执行，先于 mount 里
  // 登记的 root.unmount，React 卸载时会读到已被删掉的 window。清理交给 mount 排在
  // 卸载之后登记。
  dom.restoreGlobals = () => {
    dom.window.close()
    // 只撤 require（下一个 host:false 变体据此走降级分支）；window/document 留给
    // 下一个 withDom 覆盖。卸载后仍可能有一次迟到的轮询/提示读 window，提前删掉
    // 会变成 test 结束后的 uncaughtException。
    delete globalThis.require
  }
  return dom
}

function fakeFetch(state) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const body = options.body === undefined ? {} : JSON.parse(options.body)
    calls.push({ url, body })
    const respond = (status, payload) => ({
      ok: status < 400,
      status,
      headers: {},
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    })
    if (url === TASK_MONITOR_SNAPSHOT_PATH) {
      if (state.failSnapshot) return respond(500, { ok: false, code: 5101, detail: 'store down' })
      return respond(200, { ok: true, sessionId: body.sessionId, updatedAt: 1700000000000, entries: state.entries })
    }
    if (url === GIT_BRANCHES_PATH) return respond(200, { ok: true, branch: 'main', dirty: true, detached: false })
    if (url === TASK_MONITOR_SOURCE_ADD_PATH) {
      const value = String(body.value).trim()
      const id = `manual:${body.kind}:${value}`
      const existing = state.entries.find((item) => item.id === id)
      const added = existing ?? entry(id, 'source', { label: value, detail: value, target: value, manual: true, updatedAt: Date.now() })
      if (existing === undefined) state.entries = [...state.entries, added]
      return respond(200, { ok: true, entry: added })
    }
    if (url === TASK_MONITOR_SOURCE_REMOVE_PATH) {
      if (state.failRemove) return respond(409, { ok: false, code: 4103, detail: '不是手动来源' })
      state.entries = state.entries.filter((item) => item.id !== body.id)
      return respond(200, { ok: true })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  return { calls, fetchImpl }
}

async function mount(t, dom, state, { host = true } = {}) {
  const { calls, fetchImpl } = fakeFetch(state)
  const savedFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchImpl })
  t.after(() => {
    if (savedFetch) Object.defineProperty(globalThis, 'fetch', savedFetch)
    else delete globalThis.fetch
  })
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { createTaskMonitorTab } = await loadEntry(host ? 'host' : 'bare')
  const opened = []
  const Tab = createTaskMonitorTab({ locale: { bind: () => translator() } })
  const props = {
    sessionId: 's1',
    useProjection: () => 'D:/repo',
    useSessions: (selector) => selector({ byId: { s1: { cwd: 'D:/repo' } } }),
    useTabInfo: () => ({ tab: { visible: true, navigation: { revision: 0 }, actions: {
      openResource: (address) => opened.push(['resource', address]),
      openTab: (kind, options) => opened.push(['tab', kind, options]),
    } } }),
  }
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => root.render(React.createElement(Tab, props)))
  t.after(async () => { await act(async () => root.unmount()) })
  t.after(() => dom.restoreGlobals())
  return { act, root, opened, calls }
}

const query = (dom, selector) => dom.window.document.querySelector(selector)
const all = (dom, selector) => [...dom.window.document.querySelectorAll(selector)]
const rowsIn = (dom, kind) => all(dom, `.sk-task-monitor__section[data-kind="${kind}"] .sk-task-monitor__row`)

async function click(dom, act, element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function type(dom, act, input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

async function pressEnter(dom, act, input) {
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
}

const seedEntries = () => [
  entry('skill:browser-use', 'capability', { label: 'browser-use', detail: 'Skill', count: 3 }),
  entry('artifact:/repo/out.png', 'artifact', { label: 'out.png', detail: '/repo', target: '/repo/out.png' }),
  entry('url:https://example.com/a', 'web', { label: 'example.com', detail: 'https://example.com/a', target: 'https://example.com/a' }),
  entry('source:/repo/spec.md', 'source', { label: 'spec.md', detail: '/repo', target: '/repo/spec.md' }),
  entry('manual:url:https://pinned.example/x', 'source', { label: 'pinned.example', detail: 'https://pinned.example/x', target: 'https://pinned.example/x', manual: true }),
  entry('mcp:qmind:retrieve', 'knowledge', { label: '支付模块', detail: 'qmind · retrieve' }),
  entry('url:https://bad.example/x', 'web', { label: 'bad.example', detail: 'https://bad.example/x', target: 'https://bad.example/x', status: 'failed' }),
]

test('五分区渲染：标题、计数、×N、失败标记、git 环境条', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries() }
  await mount(t, dom, state)
  const titles = all(dom, '.sk-task-monitor__sectionTitle').map((node) => node.textContent)
  assert.deepEqual(titles, ['Skill 与 MCP', '产出', '网页查阅', '来源', '知识'])
  assert.equal(rowsIn(dom, 'capability')[0].querySelector('.sk-task-monitor__times').textContent, '×3')
  assert.equal(rowsIn(dom, 'web').length, 2)
  assert.ok(rowsIn(dom, 'web').some((row) => row.querySelector('.sk-task-monitor__failed') !== null))
  assert.equal(query(dom, '.sk-task-monitor__gitName').textContent, 'main')
  assert.ok(query(dom, '.sk-task-monitor__gitDot').hasAttribute('data-dirty'))
  assert.equal(all(dom, '.sk-task-monitor__remove').length, 1)
})

test('行点击：网页开右栏 browser，文件走宿主原生预览', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries() }
  const { act, opened } = await mount(t, dom, state)
  const webRow = rowsIn(dom, 'web').find((row) => row.textContent.includes('example.com'))
  await click(dom, act, webRow)
  await click(dom, act, rowsIn(dom, 'artifact')[0])
  assert.deepEqual(opened[0], ['tab', 'browser', { params: { url: 'https://example.com/a' } }])
  assert.equal(opened[1][0], 'resource')
  assert.match(opened[1][1], /^dsh-resource:\/\/file\/session\/s1\//)
})

test('查看更多 / 收起 / 折叠分区', async (t) => {
  const dom = withDom(t)
  const state = { entries: Array.from({ length: 7 }, (_, index) => entry(`url:https://e.example/${index}`, 'web', { label: `e${index}`, target: `https://e.example/${index}`, updatedAt: 1700000000000 + index })) }
  const { act } = await mount(t, dom, state)
  assert.equal(rowsIn(dom, 'web').length, 5)
  const more = query(dom, '.sk-task-monitor__section[data-kind="web"] .sk-task-monitor__more')
  assert.equal(more.textContent, '查看更多（2）')
  await click(dom, act, more)
  assert.equal(rowsIn(dom, 'web').length, 7)
  const collapse = query(dom, '.sk-task-monitor__section[data-kind="web"] .sk-task-monitor__more')
  assert.equal(collapse.textContent, '收起')
  await click(dom, act, collapse)
  assert.equal(rowsIn(dom, 'web').length, 5)
  const trigger = query(dom, '.sk-task-monitor__section[data-kind="web"] .sk-task-monitor__trigger')
  await click(dom, act, trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(rowsIn(dom, 'web').length, 0)
})

test('Menu 添加链接：非法链接就地报错，合法链接入列并 toast', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries() }
  const { act, calls } = await mount(t, dom, state)
  await click(dom, act, query(dom, '.sk-task-monitor__section[data-kind="source"] .sk-task-monitor__add'))
  const linkItem = all(dom, '.fake-menu li button').find((button) => button.textContent === '添加链接')
  await click(dom, act, linkItem)
  const input = query(dom, '.fake-modal input')
  assert.ok(input)
  await type(dom, act, input, 'javascript:alert(1)')
  await pressEnter(dom, act, input)
  assert.match(query(dom, '.fake-modal .sk-task-monitor__error').textContent, /http/)
  assert.equal(calls.some((call) => call.url === TASK_MONITOR_SOURCE_ADD_PATH), false)
  await type(dom, act, input, 'https://ok.example/x')
  await pressEnter(dom, act, input)
  assert.equal(query(dom, '.fake-modal'), null)
  assert.ok(rowsIn(dom, 'source').some((row) => row.textContent.includes('ok.example')))
  assert.ok(calls.some((call) => call.url === TASK_MONITOR_SOURCE_ADD_PATH && call.body.value === 'https://ok.example/x'))
  assert.match(dom.window.document.body.textContent, /已添加来源/)
})

test('移除手动来源：乐观消失；失败回滚并报错', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries() }
  const { act } = await mount(t, dom, state)
  const remove = query(dom, '.sk-task-monitor__remove')
  await click(dom, act, remove)
  assert.equal(rowsIn(dom, 'source').some((row) => row.textContent.includes('pinned.example')), false)
  assert.match(dom.window.document.body.textContent, /已移除来源/)

  state.entries = [...state.entries, entry('manual:url:https://second.example/y', 'source', { label: 'second.example', manual: true, target: 'https://second.example/y' })]
  const refresh = query(dom, '.sk-task-monitor__refresh')
  await click(dom, act, refresh)
  state.failRemove = true
  const second = all(dom, '.sk-task-monitor__remove').at(-1)
  await click(dom, act, second)
  assert.ok(rowsIn(dom, 'source').some((row) => row.textContent.includes('second.example')))
  assert.match(dom.window.document.body.textContent, /无法移除来源/)
})

test('首屏失败进错误态，重试恢复', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries(), failSnapshot: true }
  const { act } = await mount(t, dom, state)
  assert.match(query(dom, '.sk-task-monitor__errorBox').textContent, /store down/)
  state.failSnapshot = false
  await click(dom, act, query(dom, '.sk-task-monitor__errorBox button'))
  assert.equal(query(dom, '.sk-task-monitor__errorBox'), null)
  assert.equal(all(dom, '.sk-task-monitor__section').length, 5)
})

test('无宿主 primitives：内联弹窗带类型切换，文件来源主流程不断', async (t) => {
  const dom = withDom(t, { host: false })
  const state = { entries: [] }
  const { act, calls } = await mount(t, dom, state, { host: false })
  assert.equal(query(dom, '.fake-modal'), null)
  await click(dom, act, query(dom, '.sk-task-monitor__section[data-kind="source"] .sk-task-monitor__add'))
  const dialog = query(dom, '.sk-task-monitor__dialog')
  assert.ok(dialog)
  const fileKind = [...dialog.querySelectorAll('button')].find((button) => button.textContent === '添加文件')
  await click(dom, act, fileKind)
  const input = dialog.querySelector('input')
  await type(dom, act, input, 'docs/spec.md')
  await pressEnter(dom, act, input)
  assert.equal(query(dom, '.sk-task-monitor__dialog'), null)
  assert.ok(rowsIn(dom, 'source').some((row) => row.textContent.includes('spec.md')))
  assert.ok(calls.some((call) => call.url === TASK_MONITOR_SOURCE_ADD_PATH && call.body.kind === 'file'))
})