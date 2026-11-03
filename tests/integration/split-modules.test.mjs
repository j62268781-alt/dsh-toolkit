import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { readArchived } from '../../src/modules/archived/client/model.js'
import { ARCH_COPY } from '../../src/modules/archived/client/locale.js'
import { installDesktopMarker } from '../../src/modules/theme/client/platform.js'
import { installSidebarWidth, installWorkspaceCollapse } from '../../src/modules/theme/client/sidebar.js'

function page(t, html) {
  const dom = new JSDOM(html)
  const original = new Map()
  const frames = new Map()
  const cleanup = []
  let frameId = 0
  const values = {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame(run) { frames.set(++frameId, run); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
  }
  for (const [name, value] of Object.entries(values)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const dispose of cleanup.reverse()) dispose()
    dom.window.close()
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return {
    document: dom.window.document,
    onCleanup(dispose) { cleanup.push(dispose) },
    async flush() {
      for (let turn = 0; turn < 8; turn++) {
        await Promise.resolve()
        if (!frames.size) continue
        const pending = [...frames.values()]
        frames.clear()
        for (const run of pending) run()
      }
      assert.equal(frames.size, 0, 'theme observers must settle after host changes')
    },
  }
}

test('theme follows late platform attributes and tears down its marker', async (t) => {
  const { document, flush } = page(t, '<html><body></body></html>')
  const root = document.documentElement
  const dispose = installDesktopMarker()
  assert.equal(root.hasAttribute('data-sk-desktop'), false)
  root.setAttribute('data-platform', 'darwin')
  await flush()
  assert.equal(root.hasAttribute('data-sk-desktop'), true)
  root.removeAttribute('data-platform')
  await flush()
  assert.equal(root.hasAttribute('data-sk-desktop'), false)
  root.setAttribute('data-windows-titlebar', '')
  await flush()
  assert.equal(root.hasAttribute('data-sk-desktop'), true)
  dispose()
  assert.equal(root.hasAttribute('data-sk-desktop'), false)
})

test('theme preserves workspace, rail, hidden, and reopened sidebar widths', async (t) => {
  const { document, flush, onCleanup } = page(t, `<html data-platform="darwin"><body>
    <div class="_frame_test" style="grid-template-columns: 296px minmax(0, 1fr) 0px">
      <aside data-slot="sidebar"><div class="_root_test"><button class="_toggle_test"></button></div></aside>
    </div></body></html>`)
  const frame = document.querySelector('._frame_test')
  const sidebar = document.querySelector('._root_test')
  const subscriptions = new Set()
  let activePanelId = null
  const ctx = { layout: {
    panelInfo: {
      getSnapshot: () => ({ activePanelId }),
      subscribe(run) { subscriptions.add(run); return () => subscriptions.delete(run) },
    },
    toggleSidebar() { frame.toggleAttribute('data-sidebar-collapsed') },
  } }
  const stopWidth = installSidebarWidth(ctx)
  const stopCollapse = installWorkspaceCollapse(ctx)
  onCleanup(() => { stopCollapse(); stopWidth() })
  assert.match(frame.style.gridTemplateColumns, /^296px/)
  document.querySelector('._toggle_test').click()
  assert.match(frame.style.gridTemplateColumns, /^52px/)
  assert.equal(sidebar.hasAttribute('data-sk-rail-only'), true)
  document.querySelector('.sk-collapse-hit').click()
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^0px/)
  ctx.layout.toggleSidebar()
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^296px/)
  assert.equal(sidebar.hasAttribute('data-sk-rail-only'), false)
  activePanelId = 'conversation'
  for (const run of subscriptions) run()
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^52px/)
})

function archivedContext() {
  const sessions = { byId: {
    first: { title: ' First ', cwd: '/other', updatedAt: 10 },
    recent: { displayTitle: ' Recent ', cwd: '/project', updatedAt: 30 },
    loose: { title: '', updatedAt: 20 },
    child: { title: 'Child', origin: 'subagent', updatedAt: 40 },
  } }
  const workspaces = {
    items: [{ workspaceId: 'project', title: 'Project', path: '/project', sessionIds: ['first'] }],
    archivedSessionIds: ['first', 'recent', 'loose', 'child', 'missing'],
  }
  return {
    sessions: { list: { getSnapshot: () => sessions } },
    workspaces: { list: { getSnapshot: () => workspaces } },
  }
}

test('archived projection keeps workspace membership, recency, and unavailable counts', () => {
  const ctx = archivedContext()
  const before = JSON.stringify([ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot()])
  const result = readArchived(ctx)
  assert.deepEqual(result.groups.map(({ id, rows }) => [id, rows.map(({ id, title }) => [id, title])]), [
    ['project', [['recent', 'Recent'], ['first', 'First']]],
    ['__ungrouped', [['loose', '']]],
  ])
  assert.equal(result.total, 3)
  assert.equal(result.unlisted, 2)
  assert.equal(JSON.stringify([ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot()]), before)
})

test('archived bundle owns its page, CSS lifecycle, and local React JSX binding', async (t) => {
  const { document } = page(t, '<html><head></head><body></body></html>')
  let spec
  vm.runInNewContext(await readFile(new URL('../../lib/modules/archived/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { spec = value } } },
    document,
  })
  assert.equal(spec.id, 'dsh-toolkit/archived')
  const client = spec.factory(id => {
    assert.equal(id, 'react')
    return React
  })
  let Component
  const cleanup = []
  const ctx = {
    ...archivedContext(),
    effect(run) { const dispose = run(); if (typeof dispose === 'function') cleanup.push(dispose) },
    locale: {
      register(namespace, copy) { assert.equal(namespace, 'shell-kit.archived'); assert.deepEqual(Object.keys(copy).sort(), ['en', 'zh']); return () => {} },
      bind: () => key => ARCH_COPY.zh[key],
    },
    slots: {
      inject(name, run) { assert.equal(name, 'settings.section'); return run() },
      register(registration, view) { assert.equal(registration.id, 'archived-chats'); Component = view; return () => {} },
    },
  }
  client.apply(ctx)
  assert.equal(document.querySelectorAll('style[data-plugin="toolkit-archived"]').length, 1)
  const html = renderToStaticMarkup(React.createElement(Component))
  assert.match(html, /已归档的聊天/)
  assert.match(html, /Recent/)
  assert.doesNotMatch(html, /disabled=""|no-endpoint/, 'same-origin deletion is available without an injected bridge')
  assert.doesNotMatch(html, /Child/)
  assert.match(html, /另有 2 条归档记录/)
  for (const dispose of cleanup.reverse()) dispose()
  assert.equal(document.querySelectorAll('style').length, 0)
})
