import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ARCH_COPY } from '../../src/modules/archived/client/locale.js'

const h = React.createElement

function primitivesFor() {
  return {
    Button: ({ variant, size = 'md', icon, className, children, ...props }) => h('button', { ...props, className, 'data-variant': variant, 'data-size': size }, icon && h('span', { 'data-button-icon': true }, icon), children),
    IconTrashOutlineRegular: () => h('svg', { 'data-icon': 'trash' }),
    IconSearchOutlineRegular: () => h('svg', { 'data-icon': 'search' }),
    MenuItemButton: ({ danger, disabled, onSelect, icon, children }) => h('button', { role: 'menuitem', disabled, 'data-danger': danger, onClick: onSelect }, icon, children),
    Modal: ({ title, description, footer, children, onClose, closeLabel }) => h('div', { role: 'dialog' },
      h('h2', null, title), h('p', null, description), children, h('button', { onClick: onClose }, closeLabel ?? '关闭'), footer),
  }
}

async function boot(t) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>')
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root'))
  const cleanups = []
  t.after(async () => {
    await act(async () => root.unmount())
    for (const off of cleanups.reverse()) off()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })

  const primitives = primitivesFor()
  let fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  let spec
  vm.runInNewContext(await readFile(new URL('../../lib/modules/archived/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { spec = value } } }, document: dom.window.document, Headers,
    fetch: (...args) => fetchImpl(...args),
  })
  const client = spec.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw Error(id)
  })

  const workspace = { items: [], archivedSessionIds: [] }
  const sessions = { byId: {} }
  const calls = { delete: [], unarchive: 0, unpin: 0, refresh: 0, archive: [] }
  const registrations = new Map()
  const ctx = {
    effect(run) {
      const off = run()
      if (typeof off === 'function') cleanups.push(off)
      return off
    },
    locale: { register: () => () => {}, bind: () => key => ARCH_COPY.zh[key] },
    sessions: {
      list: { getSnapshot: () => sessions, subscribe: () => () => {} },
      refresh: async () => { calls.refresh++ },
    },
    workspaces: {
      list: { getSnapshot: () => workspace, subscribe: () => () => {} },
      unarchiveSession: async () => { calls.unarchive++ },
      unpinSession: async () => { calls.unpin++ },
      delete: async (id) => { calls.delete.push(id) },
      archiveSession: async (sessionId, options) => { calls.archive.push({ sessionId, options }) },
    },
    slots: {
      inject: (_name, run) => run(),
      register(meta, Component) { registrations.set(meta.id ?? meta.name, Component); return () => registrations.delete(meta.id ?? meta.name) },
    },
  }
  client.apply(ctx)

  const sections = registrations.get('archived-chats')
  const removalDialog = registrations.get('dsh-toolkit.archived.delete-confirm')
  const archiveDialog = registrations.get('dsh-toolkit.archived.archive-confirm')
  const menuItem = registrations.get('dsh-toolkit.archived.delete')
  const overlay = (extra) => h(React.Fragment, null,
    h(removalDialog), h(archiveDialog), extra ?? null)
  const render = (element) => act(async () => { root.render(element) })
  const click = async (label) => {
    const button = [...dom.window.document.querySelectorAll('button')].find((node) => node.textContent === label)
    assert.ok(button, `missing button: ${label}`)
    await act(async () => button.click())
  }
  return {
    dom, root, ctx, workspace, sessions, calls, registrations, cleanups,
    sections, menuItem, removalDialog, archiveDialog, overlay, render, click,
    setFetch(impl) { fetchImpl = impl },
    text: () => dom.window.document.body.textContent,
    dialog: () => dom.window.document.querySelector('[role="dialog"]'),
  }
}

function seed(workspace, sessions) {
  workspace.items = [
    { workspaceId: 'A', title: '项目 A', path: '/a', sessionIds: ['a1', 'a2'] },
    { workspaceId: 'B', title: '项目 B', path: '/b', sessionIds: ['b1', 'b2'] },
  ]
  workspace.archivedSessionIds = ['a1', 'a2', 'loose', 'missing']
  sessions.byId = {
    a1: { title: '第一条', updatedAt: 2 },
    a2: { title: '第二条', updatedAt: 1 },
    loose: { title: '单独归档', updatedAt: 3 },
    b1: { title: '仍在列表', updatedAt: 4 },
    b2: { title: '也在列表', updatedAt: 5 },
  }
}

test('archived page mirrors the built-in search, lists every archived record, and keeps the filter usable', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  await app.render(app.overlay(h(app.sections)))

  const document = app.dom.window.document
  assert.equal(document.querySelector('.sk-arch__subtitle').textContent, '搜索、恢复或永久删除已归档的会话。')
  const search = document.querySelector('.sk-arch input[type="search"]')
  assert.ok(search, 'search input rendered')
  assert.equal(search.className, 'sk-searchInput')
  assert.equal(search.placeholder, '搜索已归档的聊天')
  assert.ok(document.querySelector('.sk-searchIcon [data-icon="search"]'))
  assert.equal(document.querySelectorAll('.sk-arch__subtitle').length, 1)

  // Every Workspace is a filter option, including one with no archived rows.
  const options = [...document.querySelectorAll('.sk-arch__select option')].map((node) => node.textContent)
  assert.deepEqual(options, ['所有项目', '项目 A', '项目 B', '未分组'])

  const groups = [...document.querySelectorAll('.sk-arch__group')]
  assert.deepEqual(groups.map((node) => node.querySelector('.sk-arch__groupTitle').textContent), ['项目 A', '未分组'])
  assert.deepEqual(groups.map((node) => node.querySelector('.sk-arch__groupCount').textContent), ['2 个聊天', '2 个聊天'])
  // No per-workspace bulk delete: the only bulk action sits in the toolbar.
  assert.equal(document.querySelectorAll('.sk-arch__groupHead .sk-arch__delete').length, 0)

  const rows = [...document.querySelectorAll('.sk-arch__row')]
  assert.equal(rows.length, 4)
  assert.equal(rows[0].querySelector('.sk-arch__rowTitle').textContent, '第一条')
  assert.match(rows[0].textContent, /恢复/)
  assert.match(rows[0].textContent, /删除/)
  const unreadable = rows.find((row) => row.textContent.includes('无法读取的会话'))
  assert.ok(unreadable, 'records without session data stay listable so they can be deleted')
  assert.equal(unreadable.querySelector('.sk-arch__rowTitle').getAttribute('title'), 'missing')

  // The filter reaches a workspace that currently has no archived row.
  const select = document.querySelector('.sk-arch__select')
  await act(async () => {
    select.value = 'B'
    select.dispatchEvent(new app.dom.window.Event('change', { bubbles: true }))
  })
  assert.equal(document.querySelectorAll('.sk-arch__group').length, 0)
  assert.match(app.text(), /没有匹配的归档会话/)
})

test('bulk delete confirms both counts, retries failed sessions, and only drops fully archived workspaces', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  await app.render(app.overlay(h(app.sections)))

  await app.click('全部删除')
  assert.match(app.dialog().textContent, /永久删除 1 个工作区和 4 个任务？/)
  assert.match(app.dialog().textContent, /此操作会从本机移除全部已归档工作区及其任务，以及单独归档的任务，之后不能从 dsh 恢复。/)
  await app.click('取消')
  assert.equal(app.dialog(), null)
  assert.equal(app.calls.delete.length, 0)

  app.setFetch(async (_input, options) => {
    const { sessionId } = JSON.parse(options.body)
    if (sessionId === 'a2') return { ok: false, status: 409, json: async () => ({ ok: false, reason: 'session-loaded' }) }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
  await app.click('全部删除')
  await app.click('永久删除')
  assert.match(app.dom.window.document.querySelector('[role="alert"]').textContent, /第二条: session-loaded/)
  assert.deepEqual(app.calls.delete, [], 'a workspace with a failed session keeps its registration')
  assert.equal(app.dom.window.document.querySelectorAll('.sk-arch__row').length, 1, 'only the failed session remains listed')
  assert.match(app.text(), /永久删除 1 个工作区和 1 个任务？/)

  app.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
  await app.click('永久删除')
  assert.equal(app.dialog(), null)
  assert.deepEqual(app.calls.delete, ['A'])
  assert.equal(app.calls.unarchive, 4)
  assert.equal(app.calls.unpin, 4)
  assert.equal(app.calls.refresh, 2)
  assert.equal(app.dom.window.document.querySelectorAll('.sk-arch__row').length, 0)
})

test('sidebar delete entry still asks for the irreversible confirmation', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  let closed = 0
  let visible = true
  const MenuItem = app.menuItem
  await app.render(h(React.Fragment, null,
    visible && h(MenuItem, {
      sessionId: 'loose', displayTitle: '单独归档',
      useWorkspaces: (select) => select(app.workspace),
      useMenuOpenState: () => [true, () => { closed++; visible = false }],
    }),
    app.overlay(),
  ))
  assert.equal(app.dom.window.document.querySelector('[role="menuitem"]').dataset.danger, 'true')
  await act(async () => app.dom.window.document.querySelector('[role="menuitem"]').click())
  assert.equal(closed, 1)
  assert.match(app.dialog().textContent, /永久删除“单独归档”？/)
  await app.click('取消')
  assert.equal(app.calls.delete.length, 0)
})

test('archiving from the sidebar asks first and refuses silently when cancelled', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  await app.render(app.overlay(h(app.sections)))

  let pending
  await act(async () => { pending = app.ctx.workspaces.archiveSession('a1') })
  pending.catch(() => {})
  assert.match(app.dialog().textContent, /归档“第一条”？/)
  assert.match(app.dialog().textContent, /它会离开当前任务列表，保留在设置里的已归档的聊天中；之后你可以在那里永久删除。/)
  await app.click('取消')
  await assert.rejects(pending, /cancelled/)
  assert.equal(app.dialog(), null)
  assert.deepEqual(app.calls.archive, [], 'cancelling archives nothing')

  let confirmed
  await act(async () => { confirmed = app.ctx.workspaces.archiveSession('a2') })
  await app.click('归档')
  await confirmed
  assert.deepEqual(app.calls.archive, [{ sessionId: 'a2', options: undefined }])
  assert.equal(app.dialog(), null)

  // The host's own stop-and-archive dialog already asked; that path stays direct.
  await act(async () => { await app.ctx.workspaces.archiveSession('loose', { stopActivity: true }) })
  assert.deepEqual(app.calls.archive.at(-1), { sessionId: 'loose', options: { stopActivity: true } })
  assert.equal(app.dialog(), null)
})

test('disposing the page restores the wrapped archive command', async (t) => {
  const app = await boot(t)
  const wrapped = app.ctx.workspaces.archiveSession
  for (const off of [...app.cleanups].reverse()) off()
  app.cleanups.length = 0
  assert.notEqual(app.ctx.workspaces.archiveSession, wrapped)
  await app.ctx.workspaces.archiveSession('a1', { stopActivity: true })
  assert.deepEqual(app.calls.archive.at(-1), { sessionId: 'a1', options: { stopActivity: true } })
})
