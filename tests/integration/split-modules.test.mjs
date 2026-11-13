import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { readArchived } from '../../src/modules/archived/client/model.ts'
import { ARCH_COPY } from '../../src/modules/archived/client/locale.ts'
import { installShellMarkers } from '../../src/modules/theme/client/platform.ts'
import { installSidebarWidth, installWorkspaceCollapse } from '../../src/modules/theme/client/sidebar.ts'

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
  const dispose = installShellMarkers()
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

for (const platform of ['darwin', 'windows']) test(`theme preserves resized workspace, rail, hidden, and reopened widths on ${platform}`, async (t) => {
  const marker = platform === 'darwin' ? 'data-platform="darwin"' : 'data-windows-titlebar=""'
  const { document, flush, onCleanup } = page(t, `<html ${marker}><body>
    <div class="_frame_test" style="grid-template-columns: 296px minmax(0, 1fr) 0px">
      <aside data-slot="sidebar"><div class="_root_test"><div class="${platform === 'darwin' ? '_topStrip_test' : '_logoRow_test'}"><button class="_iconButton_test _toggle_test"><span></span></button></div><div class="_regionArea_test"><button class="_toggle_region"><span>收起分组</span></button></div></div></aside>
      <main><section class="_editedFiles_test"><button class="_toggle_files"><span>全部5个文件</span></button></section></main>
      <div class="_handle_test" data-side="sidebar" style="left:296px"></div>
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
  assert.match(frame.style.gridTemplateColumns, /^302px/)
  const handle = document.querySelector('[data-side="sidebar"]')
  assert.equal(handle.getAttribute('aria-valuenow'), '250')
  assert.equal(frame.hasAttribute('data-sk-workspace-expanded'), true)
  const filesToggle = document.querySelector('._toggle_files')
  const regionToggle = document.querySelector('._toggle_region')
  const nativeToggle = document.querySelector('._toggle_test')
  let nativeClicks = 0
  nativeToggle.addEventListener('click', () => { nativeClicks++; ctx.layout.toggleSidebar() })
  let fileClicks = 0
  let regionClicks = 0
  let bubbledClicks = 0
  filesToggle.addEventListener('click', () => {
    fileClicks++
    const expanded = filesToggle.getAttribute('aria-expanded') !== 'true'
    filesToggle.setAttribute('aria-expanded', String(expanded))
    filesToggle.firstElementChild.textContent = expanded ? '收起' : '全部5个文件'
  })
  regionToggle.addEventListener('click', () => regionClicks++)
  document.body.addEventListener('click', () => bubbledClicks++)
  for (const label of ['收起', '全部5个文件']) {
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true })
    assert.equal(filesToggle.firstElementChild.dispatchEvent(event), true, 'edited-files click must not be canceled')
    assert.equal(event.defaultPrevented, false)
    assert.equal(filesToggle.textContent, label, 'edited-files card handles its own expand/collapse click')
    await flush()
    assert.match(frame.style.gridTemplateColumns, /^302px/, 'edited-files toggle must not collapse the sidebar')
    assert.equal(sidebar.hasAttribute('data-sk-rail-only'), false)
  }
  regionToggle.firstElementChild.click()
  assert.equal(fileClicks, 2)
  assert.equal(regionClicks, 1, 'unrelated toggles inside the sidebar keep their own behavior')
  assert.equal(bubbledClicks, 3, 'unrelated toggle clicks propagate normally')
  assert.match(frame.style.gridTemplateColumns, /^302px/)
  const pointer = (type, x, id = 1) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: id })
    handle.dispatchEvent(event)
  }
  let nativeDrags = 0
  handle.addEventListener('pointerdown', () => nativeDrags++)
  pointer('pointerdown', 302)
  pointer('pointermove', 1000, 2)
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^302px/, 'other pointers must not resize')
  pointer('pointermove', 1000)
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^502px/)
  assert.equal(handle.style.left, '502px')
  pointer('pointerup', 1000)
  assert.equal(nativeDrags, 0, 'native width clamp must not handle theme drags')
  assert.equal(frame.hasAttribute('data-dragging'), false)
  frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 0px'
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^502px/, 'host updates must preserve dragged width')
  pointer('pointerdown', 502)
  pointer('pointerup', -1000)
  assert.match(frame.style.gridTemplateColumns, /^302px/, 'minimum width applies on final pointerup')
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  assert.match(frame.style.gridTemplateColumns, /^502px/)
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  assert.equal(handle.getAttribute('aria-valuenow'), '440')
  nativeToggle.firstElementChild.click()
  assert.equal(nativeClicks, 0, 'expanded native toggle enters the theme rail before host collapse')
  assert.match(frame.style.gridTemplateColumns, /^52px/)
  assert.equal(sidebar.hasAttribute('data-sk-rail-only'), true)
  document.querySelector('.sk-collapse-hit').click()
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^0px/)
  nativeToggle.firstElementChild.click()
  assert.equal(nativeClicks, 1, 'hidden sidebar toggle reaches the native reopen handler')
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^492px/)
  assert.equal(sidebar.hasAttribute('data-sk-rail-only'), false)
  activePanelId = 'conversation'
  for (const run of subscriptions) run()
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^52px/)
  assert.equal(frame.hasAttribute('data-sk-workspace-expanded'), false)
  activePanelId = null
  for (const run of subscriptions) run()
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^492px/)
  pointer('pointerdown', 492)
  pointer('pointercancel', 492)
  assert.equal(frame.hasAttribute('data-dragging'), false)
  stopCollapse()
  stopWidth()
  assert.equal(handle.hasAttribute('role'), false)
  pointer('pointerdown', 492)
  pointer('pointerup', 1000)
  assert.equal(nativeDrags, 1, 'cleanup restores native event handling')
  assert.match(frame.style.gridTemplateColumns, /^280px/)
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

test('archived projection lists every archived record, keeps workspace membership, and offers every workspace to the filter', () => {
  const ctx = archivedContext()
  const before = JSON.stringify([ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot()])
  const result = readArchived(ctx)
  assert.deepEqual(result.groups.map(({ id, rows }) => [id, rows.map(({ id, title }) => [id, title])]), [
    ['project', [['recent', 'Recent'], ['first', 'First']]],
    ['__ungrouped', [['child', 'Child'], ['loose', ''], ['missing', '']]],
  ])
  assert.deepEqual(result.groups.map(({ id }) => id), ['project', '__ungrouped'])
  assert.equal(result.total, 5)
  assert.deepEqual(result.projects, [{ id: 'project', title: 'Project' }])
  assert.equal(result.hasUngrouped, true)
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
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' }
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
      inject(name, run) { assert.ok(['settings.section', 'shell.overlay', 'sidebar.workspaces.session.menu.item'].includes(name)); return run() },
      register(registration, view) { if (registration.id === 'archived-chats') Component = view; return () => {} },
    },
  }
  client.apply(ctx)
  assert.equal(document.querySelectorAll('style[data-plugin="toolkit-archived"]').length, 1)
  const html = renderToStaticMarkup(React.createElement(Component))
  assert.match(html, /已归档的会话/)
  assert.match(html, /搜索、恢复或永久删除已归档的会话/)
  assert.match(html, /Recent/)
  assert.match(html, /Child/, 'subagent archives stay listed so they can be restored or deleted')
  assert.match(html, /未分组/)
  assert.match(html, /个会话/)
  assert.match(html, /sk-searchInput/)
  assert.doesNotMatch(html, /个工作区|工作区和/, 'the archived page never deletes workspaces')
  assert.doesNotMatch(html, /disabled=""|no-endpoint/, 'same-origin deletion is available without an injected bridge')
  for (const dispose of cleanup.reverse()) dispose()
  assert.equal(document.querySelectorAll('style').length, 0)
})
