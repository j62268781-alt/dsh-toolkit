import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ARCH_COPY } from '../../src/modules/archived/client/locale.ts'

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

async function boot(t, options = {}) {
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
  // A page reads its startup snapshot (which ids were already deleted) as soon as the
  // client installs, so a reload test has to seed the transport before this point.
  let fetchImpl = options.fetch ?? (async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
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
      register(meta, Component) {
        // Nav glyphs are a separate slot; keep this map to the section/overlay entries.
        if (meta.name === 'settings.section.icon') return () => {}
        registrations.set(meta.id ?? meta.name, Component)
        return () => registrations.delete(meta.id ?? meta.name)
      },
    },
  }
  client.apply(ctx)
  // Let the startup snapshot land before the caller starts rendering and replacing
  // the transport, so the two never race for the same first answer.
  await new Promise((resolve) => setTimeout(resolve, 0))

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
  assert.doesNotMatch(app.text(), /全部恢复/, 'no bulk restore in the header')
  const search = document.querySelector('.sk-arch input[type="search"]')
  assert.ok(search, 'search input rendered')
  assert.equal(search.className, 'sk-searchInput')
  assert.equal(search.placeholder, '搜索已归档的会话')
  assert.ok(document.querySelector('.sk-searchIcon [data-icon="search"]'))
  assert.equal(document.querySelectorAll('.sk-arch__subtitle').length, 1)
  // The toolbar keeps its own row: search, project filter, one bulk action.
  assert.equal(document.querySelectorAll('.sk-arch__bar .sk-arch__select').length, 1)
  const removeAll = [...document.querySelectorAll('.sk-arch__bar button')].find((node) => node.textContent === '全部删除')
  assert.ok(removeAll, 'bulk action sits in the toolbar')
  assert.match(removeAll.className, /sk-arch__removeAll/, 'bulk action must not wrap or shrink')
  assert.equal(document.querySelectorAll('.sk-arch__head button').length, 0)

  // Every Workspace is a filter option, including one with no archived rows.
  const options = [...document.querySelectorAll('.sk-arch__select option')].map((node) => node.textContent)
  assert.deepEqual(options, ['所有项目', '项目 A', '项目 B', '未分组'])

  const groups = [...document.querySelectorAll('.sk-arch__group')]
  assert.deepEqual(groups.map((node) => node.querySelector('.sk-arch__groupTitle').textContent), ['项目 A', '未分组'])
  assert.deepEqual(groups.map((node) => node.querySelector('.sk-arch__groupCount').textContent), ['2 个会话', '2 个会话'])
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

test('bulk delete sends one batch request, retries failures, and never touches workspaces', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  await app.render(app.overlay(h(app.sections)))

  await app.click('全部删除')
  assert.match(app.dialog().textContent, /永久删除 4 个会话？/)
  assert.match(app.dialog().textContent, /此操作会从本机移除全部已归档会话，之后不能从 dsh 恢复。/)
  assert.doesNotMatch(app.dialog().textContent, /工作区/)
  await app.click('取消')
  assert.equal(app.dialog(), null)
  assert.equal(app.calls.delete.length, 0)

  const batches = []
  app.setFetch(async (input, options) => {
    // The page also asks which ids were already deleted; nothing is pending here.
    if (options.method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: [] }) }
    const { sessionIds } = JSON.parse(options.body)
    batches.push(input)
    return {
      ok: true, status: 200, json: async () => ({
        ok: true,
        results: sessionIds.map((sessionId) => {
          if (sessionId === 'a2') return { sessionId, statusCode: 409, ok: false, code: 'session-loaded' }
          // Files already gone: the archive entry must still be cleared, not reported as a failure.
          if (sessionId === 'missing') return { sessionId, statusCode: 404, ok: false, code: 'not-found' }
          return { sessionId, statusCode: 200, ok: true, code: 'deleted' }
        }),
      }),
    }
  })
  await app.click('全部删除')
  await app.click('永久删除')
  assert.equal(batches.length, 1, 'one round trip for the whole page')
  assert.match(String(batches[0]), /archived\/delete-sessions$/)
  assert.match(app.dom.window.document.querySelector('[role="alert"]').textContent, /第二条: dsh 仍持有这个会话/)
  assert.doesNotMatch(app.dom.window.document.querySelector('[role="alert"]').textContent, /missing/, 'a not-found code is a success, not noise')
  assert.deepEqual(app.calls.delete, [], 'bulk delete never removes a workspace registration')
  assert.equal(app.dom.window.document.querySelectorAll('.sk-arch__row').length, 1, 'only the failed session remains listed')
  assert.match(app.text(), /永久删除 1 个会话？/)

  app.setFetch(async (_input, options) => {
    if (options.method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: [] }) }
    const { sessionIds } = JSON.parse(options.body)
    return { ok: true, status: 200, json: async () => ({ ok: true, results: sessionIds.map((sessionId) => ({ sessionId, statusCode: 200, ok: true, code: 'deleted' })) }) }
  })
  await app.click('永久删除')
  assert.equal(app.dialog(), null)
  assert.deepEqual(app.calls.delete, [])
  assert.equal(app.calls.unarchive, 4)
  assert.equal(app.calls.unpin, 4)
  assert.equal(app.calls.refresh, 2)
  assert.equal(app.dom.window.document.querySelectorAll('.sk-arch__row').length, 0)
})

test('confirming a bulk delete closes the dialog at once and loads the button instead', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)

  // The host round trip is held open, so the in-flight state is observable instead
  // of being over by the time the click handler returns.
  const gates = []
  let lookups = 0
  let posts = 0
  app.setFetch(async (_input, options) => {
    if (options.method === 'GET') {
      lookups++
      return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: [] }) }
    }
    posts++
    const { sessionIds } = JSON.parse(options.body)
    await new Promise((resolve) => gates.push(resolve))
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, results: sessionIds.map((sessionId) => ({ sessionId, statusCode: 200, ok: true, code: 'deleted' })) }),
    }
  })
  await app.render(app.overlay(h(app.sections)))
  assert.equal(lookups, 0, 'the page does not re-read what the client already read at startup')

  await app.click('全部删除')
  assert.match(app.dialog().textContent, /永久删除 4 个会话？/)

  await act(async () => {
    const confirm = [...app.dom.window.document.querySelectorAll('[role="dialog"] button')]
      .find((node) => node.textContent === '永久删除')
    assert.ok(confirm, 'confirmation button rendered')
    confirm.click()
  })
  assert.equal(app.dialog(), null, 'the dialog closes before the host answers')

  // The wait is carried by the bulk button: a ring plus aria-busy, never a page row.
  const document = app.dom.window.document
  const removeAll = document.querySelector('.sk-arch__removeAll')
  assert.equal(removeAll.getAttribute('aria-busy'), 'true')
  assert.ok(removeAll.querySelector('.sk-arch__spinner'), 'the bulk button shows the ring')
  assert.equal(document.querySelector('.sk-arch__progress'), null, 'no progress line on the page')
  assert.equal(posts, 1, 'the whole page is one request')
  assert.equal(removeAll.disabled, false, 'a working button is busy, not disabled')

  await act(async () => gates.shift()())
  assert.equal(app.dialog(), null)
  assert.equal(document.querySelector('.sk-arch__spinner'), null, 'the ring clears with the batch')
  assert.equal(document.querySelector('.sk-arch__removeAll').getAttribute('aria-busy'), null)
  assert.equal(lookups, 1, 'one lookup at startup, one after the batch')
  assert.equal(document.querySelectorAll('.sk-arch__row').length, 0)
  assert.equal(app.calls.unarchive, 4)
  assert.equal(app.calls.unpin, 4)
})

test('a session the host still holds keeps its archive entry until the restart clears it', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  await app.render(app.overlay(h(app.sections)))

  let pending = []
  app.setFetch(async (_input, options) => {
    if (options.method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: pending }) }
    const { sessionIds } = JSON.parse(options.body)
    return {
      ok: true, status: 200, json: async () => ({
        ok: true,
        results: sessionIds.map((sessionId) => {
          // The host moved the files but still holds the record: clearing the archive
          // registration now would put a session without files back in the sidebar.
          if (sessionId !== 'loose') return { sessionId, statusCode: 200, ok: true, code: 'deleted' }
          pending = ['loose']
          return { sessionId, statusCode: 200, ok: true, code: 'retained' }
        }),
      }),
    }
  })
  await app.click('全部删除')
  await app.click('永久删除')

  assert.equal(app.calls.unarchive, 3, 'a retained deletion must not be unarchived')
  assert.equal(app.calls.unpin, 3)
  const status = app.dom.window.document.querySelector('[role="status"]')
  assert.match(status.textContent, /已删除 1 个会话的文件/)
  // The row is gone from view even though the registration is still there.
  assert.equal(app.dom.window.document.querySelectorAll('.sk-arch__row').length, 0)
})

test('a retained deletion hides its sidebar row without hiding the rows the Workspace released', async (t) => {
  const app = await boot(t)
  seed(app.workspace, app.sessions)
  app.setFetch(async (_input, options) => {
    if (options.method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: [] }) }
    const { sessionIds } = JSON.parse(options.body)
    return {
      ok: true, status: 200, json: async () => ({
        ok: true,
        results: sessionIds.map((sessionId) => (
          sessionId === 'loose'
            ? { sessionId, statusCode: 200, ok: true, code: 'retained' }
            : { sessionId, statusCode: 200, ok: true, code: 'deleted' }
        )),
      }),
    }
  })
  await app.render(app.overlay(h(app.sections)))

  const sheet = () => app.dom.window.document.querySelector('style[data-plugin="dsh-toolkit-archived-hidden"]')
  assert.ok(sheet(), 'the row hider installs a stylesheet with the client')
  assert.equal(sheet().textContent, '', 'nothing is hidden before a delete')

  await app.click('全部删除')
  await app.click('永久删除')

  // The core keeps listing a session the host still holds, and the archive tombstone
  // only grays it out: the row itself has to be taken out of the sidebar here.
  assert.match(sheet().textContent, /\[data-row-key="session:loose"\]\{display:none !important\}/)
  assert.doesNotMatch(sheet().textContent, /session:a1/, 'a row the Workspace released comes back as a normal row')
})

test('a reload hides the sessions whose files are already deleted but still registered', async (t) => {
  // The host kept the archive registration as a tombstone for 'loose'; after a
  // restart the page must not list it again as an unreadable row.
  const app = await boot(t, {
    fetch: async (_input, options) => {
      if (options.method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, sessionIds: ['loose'] }) }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    },
  })
  seed(app.workspace, app.sessions)
  await app.render(app.overlay(h(app.sections)))

  const titles = [...app.dom.window.document.querySelectorAll('.sk-arch__rowTitle')].map((node) => node.textContent)
  assert.deepEqual(titles, ['第一条', '第二条', '无法读取的会话'])
  assert.equal(app.dom.window.document.querySelector('.sk-arch__removeAll').disabled, false)
  // The sidebar lookup uses the same markers: a tombstone is not drawn again either.
  const sheet = app.dom.window.document.querySelector('style[data-plugin="dsh-toolkit-archived-hidden"]')
  assert.match(sheet.textContent, /\[data-row-key="session:loose"\]\{display:none !important\}/)

  // Everything archived is pending: no rows left, so the bulk action has nothing to do.
  app.workspace.archivedSessionIds = ['loose']
  await app.render(app.overlay(h(app.sections)))
  assert.equal(app.dom.window.document.querySelectorAll('.sk-arch__row').length, 0)
  assert.equal(app.dom.window.document.querySelector('.sk-arch__removeAll').disabled, true)
  assert.match(app.text(), /还没有归档的会话/)
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
  // 永久删除保留模块自己的红色危险按钮，不是宿主的黑色 primary。
  const confirm = [...app.dialog().querySelectorAll('button')].find((node) => node.textContent === '永久删除')
  assert.match(confirm.className, /sk-arch__delete/)
  assert.equal(confirm.dataset.variant, 'outline')
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
  assert.match(app.dialog().textContent, /它会离开当前任务列表，保留在设置里的已归档的会话中；之后你可以在那里永久删除。/)
  // 归档是常态操作而不是破坏性操作：确认按钮用宿主的黑色 primary，取消用 outline。
  const buttons = [...app.dialog().querySelectorAll('button')]
  assert.equal(buttons.find((node) => node.textContent === '归档').dataset.variant, 'primary')
  assert.equal(buttons.find((node) => node.textContent === '取消').dataset.variant, 'outline')
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
