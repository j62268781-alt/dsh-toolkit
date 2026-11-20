/**
 * 任务监控面板的交互：环境信息 + 四分区、行/查看更多/折叠、原生打开、只读展示
 * （没有添加/移除入口）、错误态重试。fetch 全替身，不碰网络。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React from 'react'
import { TASK_MONITOR_COPY } from '../../src/modules/task-monitor/client/locale.ts'
import { TASK_MONITOR_SNAPSHOT_PATH } from '../../src/modules/task-monitor/host/constants.ts'
import { GIT_BRANCHES_PATH, GIT_CHANGES_PATH } from '../../src/modules/git/host/constants.ts'

const ENTRY = 'src/modules/task-monitor/client/components/panel/index.tsx'

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
    IconChecklistOutlineRegular: icon,
    IconCheckCircleOutlineRegular: icon,
    IconFolderOpenOutlineRegular: icon,
    IconWorkspaceTreeOutlineRegular: icon,
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
      return respond(200, { ok: true, sessionId: body.sessionId, updatedAt: 1700000000000, entries: state.entries, review: state.review ?? null })
    }
    if (url === GIT_BRANCHES_PATH) return respond(200, { ok: true, branch: 'main', dirty: true, detached: false })
    if (url === GIT_CHANGES_PATH) {
      return respond(200, state.changes ?? { ok: true, files: 0, insertions: 0, deletions: 0, untracked: 0 })
    }
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

async function mount(t, dom, state, { host = true, reviewAction = true } = {}) {
  const { calls, fetchImpl } = fakeFetch(state)
  const savedFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchImpl })
  t.after(() => {
    if (savedFetch) Object.defineProperty(globalThis, 'fetch', savedFetch)
    else delete globalThis.fetch
  })
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { createTaskMonitorPanel } = await loadEntry(host ? 'host' : 'bare')
  const opened = []
  const Tab = createTaskMonitorPanel({ locale: { bind: () => translator() } })
  const props = {
    sessionId: 's1',
    useProjection: () => 'D:/repo',
    useSessions: (selector) => selector({ byId: { s1: { cwd: 'D:/repo' } } }),
    useTabInfo: () => ({ tab: { visible: true, navigation: { revision: 0 }, actions: {
      openResource: (address) => opened.push(['resource', address]),
      openTab: (kind, options) => opened.push(['tab', kind, options]),
      ...(reviewAction ? { openReview: (address) => opened.push(['review', address]) } : {}),
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

test('环境信息 + 四分区渲染：计数、去重后不显示 ×N、失败标记，知识不占分区', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries() }
  await mount(t, dom, state)
  const titles = all(dom, '.sk-task-monitor__sectionTitle').map((node) => node.textContent)
  assert.deepEqual(titles, ['环境信息', '技能与 MCP', '产出', '网页查阅', '来源'])
  // 条目已按路径去重，出现次数不再画成 ×N 徽标。
  assert.ok(rowsIn(dom, 'capability')[0].querySelector('.sk-task-monitor__times') === null, '不再渲染 ×N 徽标')
  assert.equal(rowsIn(dom, 'web').length, 2)
  assert.ok(rowsIn(dom, 'web').some((row) => row.querySelector('.sk-task-monitor__failed') !== null))
  const env = rowsIn(dom, 'environment').map((row) => row.querySelector('.sk-task-monitor__label').textContent)
  assert.deepEqual(env, ['有未提交改动', '本地', 'main', 'repo'])
  // 产出 / 来源只画文件名：目录副标题不再出现在行里（避免两行文本挤成三行）。
  assert.ok(rowsIn(dom, 'artifact')[0].querySelector('.sk-task-monitor__detail') === null, '产出行没有副标题')
  assert.ok(rowsIn(dom, 'source')[0].querySelector('.sk-task-monitor__detail') === null, '来源行没有副标题')
  assert.ok(rowsIn(dom, 'capability')[0].querySelector('.sk-task-monitor__detail') !== null, '技能行仍带副标题')
  // 知识条目仍按 knowledge 入库，只是不再占分区；面板也不再有添加/移除入口。
  assert.equal(all(dom, '.sk-task-monitor__section[data-kind="knowledge"]').length, 0)
  assert.equal(all(dom, '.sk-task-monitor__add').length, 0)
  assert.equal(all(dom, '.sk-task-monitor__remove').length, 0)
})

test('网页查阅只显示完整链接；无链接的搜索记录只显示搜索词', async (t) => {
  const dom = withDom(t)
  const url = 'https://example.com/docs?q=task#monitor'
  const { act, opened } = await mount(t, dom, { entries: [
    entry(`url:${url}`, 'web', { label: 'example.com', detail: url, target: url }),
    entry('search:task monitor', 'web', { label: 'task monitor', detail: 'web_search' }),
  ] })
  const rows = rowsIn(dom, 'web')
  const labelOf = (row) => row.querySelector('.sk-task-monitor__label').textContent
  assert.deepEqual(rows.map(labelOf).sort(), [url, 'task monitor'])
  assert.ok(rows.every((row) => row.querySelector('.sk-task-monitor__detail') === null))
  const link = rows.find((row) => labelOf(row) === url)
  assert.equal(link.title, url)
  await click(dom, act, link)
  assert.deepEqual(opened, [['tab', 'browser', { params: { url } }]])
})

test('新会话没有条目时打上 data-empty，右栏与标题栏按钮据此不出现', async (t) => {
  const dom = withDom(t)
  await mount(t, dom, { entries: [] })
  const root = query(dom, '.sk-task-monitor')
  assert.equal(root.getAttribute('data-empty'), 'true')
  // 面板仍然挂载着（轮询要跑），只是由 data-empty 让外层把它藏掉。
  assert.equal(root.getAttribute('data-phase'), 'ready')
})

test('有条目时不打 data-empty', async (t) => {
  const dom = withDom(t)
  await mount(t, dom, { entries: seedEntries() })
  assert.equal(query(dom, '.sk-task-monitor').hasAttribute('data-empty'), false)
})

test('环境信息第一行：工作区改动只显示 +新增 / −删除，不显示新文件计数', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries(), changes: { ok: true, files: 4, insertions: 1234, deletions: 12, untracked: 2 } }
  await mount(t, dom, state)
  const status = rowsIn(dom, 'environment')[0]
  assert.equal(status.querySelector('.sk-task-monitor__added').textContent, '+1.2k')
  assert.equal(status.querySelector('.sk-task-monitor__deleted').textContent, '−12')
  assert.ok(status.querySelector('.sk-task-monitor__detail') === null)
})

test('环境信息第一行：只有新文件（或二进制改动）时不画 +0 −0，仍算有改动', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries(), changes: { ok: true, files: 3, insertions: 0, deletions: 0, untracked: 3 } }
  await mount(t, dom, state)
  const status = rowsIn(dom, 'environment')[0]
  assert.equal(status.querySelector('.sk-task-monitor__label').textContent, '有未提交改动')
  assert.ok(status.querySelector('.sk-task-monitor__detail') === null)
  assert.ok(status.querySelector('.sk-task-monitor__added') === null)
  assert.ok(status.querySelector('.sk-task-monitor__deleted') === null)
})

test('环境信息第一行：有改动且带审查坐标时点开官方审查 tab', async (t) => {
  const dom = withDom(t)
  const state = {
    entries: seedEntries(),
    changes: { ok: true, files: 2, insertions: 5, deletions: 1, untracked: 0 },
    review: { seq: 7, turn: 3 },
  }
  const { act, opened } = await mount(t, dom, state)
  const status = rowsIn(dom, 'environment')[0]
  assert.equal(status.getAttribute('data-clickable'), 'true')
  await click(dom, act, status)
  assert.deepEqual(opened, [['review', 'dsh-resource://changes-review/session/s1/7/3']])
})

test('环境信息第一行：没有审查坐标时不做成可点', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries(), changes: { ok: true, files: 2, insertions: 5, deletions: 1, untracked: 0 } }
  const { opened } = await mount(t, dom, state)
  const status = rowsIn(dom, 'environment')[0]
  assert.ok(status.getAttribute('data-clickable') === null, '缺坐标时不可点')
  assert.deepEqual(opened, [])
})

test('环境信息第一行：有改动但宿主没装审查 tab 时点出提示，而不是死行', async (t) => {
  const dom = withDom(t)
  const state = {
    entries: seedEntries(),
    changes: { ok: true, files: 2, insertions: 5, deletions: 1, untracked: 0 },
    review: { seq: 7, turn: 3 },
  }
  const { act, opened } = await mount(t, dom, state, { reviewAction: false })
  const status = rowsIn(dom, 'environment')[0]
  assert.equal(status.getAttribute('data-clickable'), 'true')
  await click(dom, act, status)
  assert.deepEqual(opened, [])
  const toast = query(dom, '.sk-toast__text')
  assert.ok(toast !== null, 'toast 出现了')
  assert.match(toast.textContent, /代码审查和变更/)
})

test('行点击：网页开右栏 browser，文件走宿主原生预览', async (t) => {
  const dom = withDom(t)
  const state = {
    entries: [
      ...seedEntries(),
      // 相对路径按会话 cwd 折叠；空格要按段编码，右栏只认这一种拼写。
      entry('artifact:src/main.ts', 'artifact', { label: 'main.ts', detail: 'src', target: 'src/main.ts' }),
      entry('source:docs/a b.md', 'source', { label: 'a b.md', detail: 'docs', target: 'docs/a b.md' }),
    ],
  }
  const { act, opened } = await mount(t, dom, state)
  const webRow = rowsIn(dom, 'web').find((row) => row.textContent.includes('example.com'))
  await click(dom, act, webRow)
  const artifactRows = rowsIn(dom, 'artifact')
  await click(dom, act, artifactRows.find((row) => row.textContent.includes('main.ts')))
  await click(dom, act, artifactRows.find((row) => row.textContent.includes('out.png')))
  const sourceRow = rowsIn(dom, 'source').find((row) => row.textContent.includes('a b.md'))
  await click(dom, act, sourceRow)
  assert.deepEqual(opened[0], ['tab', 'browser', { params: { url: 'https://example.com/a' } }])
  assert.equal(opened[1][0], 'resource')
  assert.equal(opened[1][1], 'dsh-resource://file/session/s1/src/main.ts')
  assert.equal(opened[2][1], 'dsh-resource://file/session/s1//repo/out.png')
  assert.equal(opened[3][1], 'dsh-resource://file/session/s1/docs/a%20b.md')
})

test('缺失的产出留在末尾，仅展示不可用状态；来源不分页', async (t) => {
  const dom = withDom(t)
  const state = { entries: [
    entry('artifact:gone', 'artifact', { label: 'gone.txt', target: 'gone.txt', unavailable: true }),
    entry('artifact:ok', 'artifact', { label: 'ok.txt', target: 'ok.txt', modifiedAt: 1 }),
    ...Array.from({ length: 7 }, (_, index) => entry(`input:file:${index}`, 'source')),
  ] }
  const { act, opened } = await mount(t, dom, state)
  const [available, missing] = rowsIn(dom, 'artifact')
  assert.match(available.textContent, /ok\.txt/)
  assert.match(missing.textContent, /gone\.txt.*文件不可用/)
  assert.equal(missing.hasAttribute('tabindex'), false)
  await click(dom, act, missing)
  assert.deepEqual(opened, [])
  assert.equal(rowsIn(dom, 'source').length, 7)
  assert.ok(query(dom, '.sk-task-monitor__section[data-kind="source"] .sk-task-monitor__more') === null)
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
  // 收起只改 <details open>，行仍留在 DOM 里给 ::details-content 做高度过渡。
  assert.equal(query(dom, '.sk-task-monitor__section[data-kind="web"]').hasAttribute('open'), false)
})

test('空分区默认收起、有数据的分区默认展开，且只在首帧定一次', async (t) => {
  const dom = withDom(t)
  // 只有「技能与 MCP」有数据：其余三个分区应当收起，环境信息（第一个）永远展开。
  const state = { entries: [entry('skill:browser-use', 'capability', { label: 'browser-use', detail: 'Skill' })] }
  const { act } = await mount(t, dom, state)
  const open = (kind) => query(dom, `.sk-task-monitor__section[data-kind="${kind}"]`).hasAttribute('open')
  assert.equal(open('environment'), true, '环境信息常开')
  assert.equal(open('capability'), true, '有数据的分区展开')
  assert.equal(open('artifact'), false, '空分区收起')
  assert.equal(open('web'), false, '空分区收起')
  assert.equal(open('source'), false, '空分区收起')
  // 之后用户手动展开空分区：只要首帧已经定过，不会被再合上。
  const trigger = query(dom, '.sk-task-monitor__section[data-kind="artifact"] .sk-task-monitor__trigger')
  await click(dom, act, trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(open('artifact'), true)
})

test('只读：来源分区不提供添加与移除入口，手动来源照常展示', async (t) => {
  const dom = withDom(t)
  const state = { entries: seedEntries() }
  const { act } = await mount(t, dom, state)
  const source = query(dom, '.sk-task-monitor__section[data-kind="source"]')
  assert.ok(source.textContent.includes('pinned.example'))
  assert.equal(source.querySelector('.sk-task-monitor__add'), null)
  assert.equal(source.querySelector('.sk-task-monitor__remove'), null)
  // 没入口可点，点击行也不会触发删除请求。
  await click(dom, act, rowsIn(dom, 'source')[1])
  assert.ok(rowsIn(dom, 'source').some((row) => row.textContent.includes('pinned.example')))
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
  assert.equal(rowsIn(dom, 'source').length, 2)
})

test('无宿主 primitives：图标降级为空、重试按钮走原生 button', async (t) => {
  const dom = withDom(t, { host: false })
  const state = { entries: seedEntries(), failSnapshot: true }
  const { act } = await mount(t, dom, state, { host: false })
  // 图标组件拿不到就渲染 null，分区与行仍在；没有 Modal/Menu，也不再需要添加来源。
  assert.ok(rowsIn(dom, 'environment').length >= 1)
  // 错误态只露环境信息；重试成功后四个分区与来源行才回来。
  assert.equal(rowsIn(dom, 'source').length, 0)
  const retry = query(dom, '.sk-task-monitor__errorBox button')
  assert.equal(retry.tagName, 'BUTTON')
  state.failSnapshot = false
  await click(dom, act, retry)
  assert.equal(query(dom, '.sk-task-monitor__errorBox'), null)
  assert.equal(all(dom, '.sk-task-monitor__section').length, 5)
  assert.equal(rowsIn(dom, 'source').length, 2)
})
