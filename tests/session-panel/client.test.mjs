import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { primitives } from '../../src/client/ui/primitives.js'
import { TASK_MONITOR_COPY } from '../../src/modules/session-panel/client/locale.js'
import { TASK_MONITOR_SNAPSHOT_PATH } from '../../src/modules/session-panel/host/constants.js'
import { install } from '../../src/modules/session-panel/client/surfaces/session-panel/index.jsx'

const slot = 'conversation.session.panel.section'
const copy = TASK_MONITOR_COPY.zh
const entry = (id, kind, extra = {}) => ({ id, kind, label: id, detail: '', count: 1, status: 'ok', updatedAt: 1700000000000, ...extra })
const all = (dom, selector) => [...dom.window.document.querySelectorAll(selector)]

function translate(key, params) {
  let text = copy[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

async function setup(t, fetch, sidebar, tabs) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://dsh.example.test', pretendToBeVisual: true })
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, fetch }
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.window.document.getElementById('root'))
  const sections = []
  let disposed = false
  const off = install({
    locale: {
      bind(namespace) { assert.equal(namespace, 'shell-kit.session-panel'); return translate },
    },
    slots: {
      inject(name, activate) { assert.equal(name, slot); activate(); return () => { disposed = true } },
      register(spec, Component) { sections.push({ spec, Component }) },
    },
    get: (name) => ({ sidebarRight: sidebar, sidebarRightTabs: tabs }[name]),
  })
  t.after(async () => {
    await act(async () => root.unmount())
    off()
    assert.equal(disposed, true, '卸载交回宿主 slot 清理')
    dom.window.close()
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  let dismissals = 0
  const render = (sessionId, props) => act(async () => root.render(sections.map(({ spec, Component }) => React.createElement(Component, {
    key: spec.id,
    sessionId,
    useProjection: (name) => { assert.equal(name, 'workingDirectory'); return '/repo' },
    useSessions: (select) => select({ byId: { [sessionId]: { cwd: '/original' } } }),
    dismissOverlay: () => { dismissals++ },
    ...props,
  }))))
  const rows = () => all(dom, '[data-session-panel-row]')
  const click = (element) => act(async () => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })))
  return { dom, sections, render, rows, click, dismissals: () => dismissals }
}

const response = (entries) => ({ ok: true, json: async () => ({ ok: true, entries }) })
const labelOf = (row) => row.querySelector('[data-row-part="content"]').textContent
const trailingOf = (row) => row.querySelector('[data-row-part="trailing"]')?.textContent

test('官方会话面板：四分区共享快照，区分技能、MCP 和知识记录，保留原生导航', async (t) => {
  const entries = [
    entry('skill:browser-use', 'capability', { label: 'browser-use', detail: 'Skill', count: 3 }),
    entry('mcp:demo', 'capability', { label: 'demo' }),
    entry('mcp:offline', 'capability', { label: 'offline', status: 'failed' }),
    entry('artifact:/repo/out.png', 'artifact', { label: 'out.png', detail: '/repo', target: '/repo/out.png' }),
    entry('artifact:gone', 'artifact', { label: 'gone.txt', target: 'gone.txt', unavailable: true }),
    entry('url:https://example.com/a', 'web', { label: 'example.com', target: 'https://example.com/a' }),
    entry('search:task monitor', 'web', { label: 'task monitor', detail: 'web_search' }),
    entry('source:docs/a b.md', 'source', { label: 'a b.md', target: 'docs/a b.md' }),
    entry('manual:url:https://pinned.example/x', 'source', { label: 'pinned.example', target: 'https://pinned.example/x', manual: true }),
    entry('mcp:qmind:retrieve', 'knowledge', { label: '支付模块', detail: 'qmind · retrieve' }),
  ]
  const calls = []
  const opened = []
  let staleSignal
  let releaseStale
  const stale = new Promise((resolve) => { releaseStale = resolve })
  const panel = await setup(t, async (url, options) => {
    assert.equal(url, TASK_MONITOR_SNAPSHOT_PATH)
    const { sessionId } = JSON.parse(options.body)
    calls.push(sessionId)
    if (sessionId === 's2') {
      staleSignal = options.signal
      await stale
    }
    return response(sessionId === 's3' ? [] : entries)
  }, { openResourceIn: (...args) => opened.push(args) })
  assert.deepEqual(panel.sections.map(({ spec }) => [spec.name, spec.label()]), [
    [slot, copy.sectionCapability],
    [slot, copy.sectionWeb],
    [slot, copy.sectionArtifact],
    [slot, copy.sectionSource],
  ])
  await panel.render('s1')
  assert.deepEqual(calls, ['s1'])
  assert.equal(panel.rows().length, 9)
  const row = (label) => panel.rows().find((row) => labelOf(row) === label)
  assert.ok(!row('支付模块'))
  assert.equal(trailingOf(row('browser-use')), copy.capabilitySkill)
  assert.equal(row('browser-use').title, `${copy.capabilitySkill} · browser-use`)
  assert.equal(trailingOf(row('demo')), copy.capabilityMcp)
  assert.equal(row('demo').title, `${copy.capabilityMcp} · demo`)
  assert.equal(trailingOf(row('offline')), copy.failedStatus)
  assert.equal(trailingOf(row('gone.txt')), copy.artifactUnavailable)
  assert.ok(row('gone.txt').querySelector('a, button') === null)
  assert.ok(row('task monitor').querySelector('a, button') === null)
  const link = row('https://example.com/a').querySelector('a')
  assert.equal(link?.href, 'https://example.com/a')
  assert.equal(link?.target, '_blank')
  assert.equal(link?.rel, 'noopener noreferrer')
  assert.equal(row('pinned.example').querySelector('a')?.href, 'https://pinned.example/x')
  const fallbackMore = row('pinned.example').querySelector('summary')
  assert.equal(fallbackMore?.getAttribute('aria-label'), '更多操作')
  assert.equal(fallbackMore?.nextElementSibling.href, 'https://pinned.example/x')
  assert.equal(fallbackMore?.nextElementSibling.textContent, '在系统浏览器中打开')
  for (const label of ['out.png', 'a b.md']) await panel.click(row(label).querySelector('button'))
  assert.deepEqual(opened, [
    ['s1', 'dsh-resource://file/session/s1/out.png'],
    ['s1', 'dsh-resource://file/session/s1/docs/a%20b.md'],
  ])
  assert.equal(panel.dismissals(), 2)
  await panel.render('s2')
  assert.equal(staleSignal.aborted, false)
  assert.equal(panel.rows().length, 0)
  await panel.render('s3')
  assert.equal(staleSignal.aborted, true)
  await act(async () => { releaseStale() })
  assert.deepEqual(calls, ['s1', 's2', 's3'])
  assert.equal(panel.rows().length, 0)
})

test('官方会话面板：通过宿主展开超长分区，已安装的浏览器优先于外部链接', async (t) => {
  const urls = Array.from({ length: 7 }, (_, i) => `https://example.com/${i}`)
  const source = 'https://sources.example/notes'
  const entries = [...urls.map((url) => entry(`url:${url}`, 'web', { target: url })), entry('source', 'source', { target: source })]
  const opened = []
  const external = []
  const originalMenu = primitives.Menu
  primitives.Menu = ({ open, anchor, items, onSelect }) => React.createElement('span', {}, anchor, open &&
    React.createElement('div', { role: 'menu' }, items.map(({ id, label }) =>
      React.createElement('button', { key: id, role: 'menuitem', onClick: () => onSelect(id) }, label))))
  t.after(() => { primitives.Menu = originalMenu })
  const panel = await setup(t, async () => response(entries), { openTabIn: (...args) => opened.push(args) }, {
    get: (kind) => kind === 'browser' ? {} : undefined,
  })
  await panel.render('s1', {
    renderFactorySlot(name, { expanded, label, onToggle }) {
      assert.equal(name, 'conversation.session.panel.fold')
      return React.createElement('button', { 'aria-expanded': expanded, onClick: onToggle }, label)
    },
  })
  panel.dom.window.open = (...args) => external.push(args)
  const fold = () => panel.dom.window.document.querySelector('button[aria-expanded]:not([aria-haspopup])')
  assert.equal(panel.rows().length, 6)
  assert.equal(fold()?.textContent, translate('showMore', { n: 2 }))
  await panel.click(fold())
  assert.equal(panel.rows().length, 8)
  assert.equal(fold()?.textContent, copy.collapse)
  const row = (label) => panel.rows().find((row) => labelOf(row) === label)
  const last = row(urls[6])
  const more = last.querySelector('button[aria-haspopup="menu"]')
  assert.equal(more.getAttribute('aria-label'), '更多操作')
  await panel.click(more)
  assert.deepEqual(opened, [])
  assert.equal(more.getAttribute('aria-expanded'), 'true')
  const action = last.querySelector('button[role="menuitem"]')
  assert.equal(action?.textContent, '在系统浏览器中打开')
  await panel.click(action)
  assert.deepEqual(external, [[urls[6], '_blank', 'noopener,noreferrer']])
  assert.equal(more.getAttribute('aria-expanded'), 'false')
  assert.equal(panel.dismissals(), 0)
  await panel.click(last.querySelector('button[data-row-part="body"]'))
  await panel.click(row('source').querySelector('button[data-row-part="body"]'))
  assert.deepEqual(opened, [urls[6], source].map((url) => ['s1', 'browser', { params: { url } }]))
  assert.equal(panel.dismissals(), 2)
  await panel.click(fold())
  assert.equal(panel.rows().length, 6)
})
