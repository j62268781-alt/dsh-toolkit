import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ARCH_COPY } from '../../src/modules/archived/client/locale.js'

test('archived popup and settings use native danger actions and one persistent irreversible confirmation', async t => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>')
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(document.getElementById('root'))
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
  const h = React.createElement
  const primitives = {
    Button: ({ variant, size = 'md', icon, children, ...props }) => h('button', { ...props, 'data-variant': variant, 'data-size': size }, icon && h('span', { 'data-button-icon': true }, icon), children),
    IconTrashOutlineRegular: () => h('svg', { 'data-icon': 'trash' }),
    MenuItemButton: ({ danger, separatorBefore, disabled, onSelect, icon, children }) => h('button', { role: 'menuitem', disabled, 'data-danger': danger, 'data-separator': separatorBefore, onClick: onSelect }, icon, children),
    Modal: ({ title, description, footer, children, onClose }) => h('div', { role: 'dialog' }, h('h2', null, title), h('p', null, description), children, h('button', { onClick: onClose }, '关闭'), footer),
  }
  let spec
  let calls = 0, refreshes = 0, unarchives = 0, unpins = 0, complete
  let response = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'session-loaded' }) })
  vm.runInNewContext(await readFile(new URL('../../lib/modules/archived/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { spec = value } } }, document, Headers,
    fetch: (...args) => { calls++; return response(...args) },
  })
  const client = spec.factory(id => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw Error(id)
  })
  const workspace = { items: [], archivedSessionIds: ['archived'] }
  const sessions = { byId: { archived: { title: '归档示例', updatedAt: 1 } } }
  const registrations = new Map()
  client.apply({
    effect(run) { const off = run(); if (typeof off === 'function') cleanups.push(off) },
    locale: { register: () => () => {}, bind: () => key => ARCH_COPY.zh[key] },
    sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, refresh: async () => { refreshes++ } },
    workspaces: { list: { getSnapshot: () => workspace, subscribe: () => () => {} }, unarchiveSession: async () => { unarchives++ }, unpinSession: async () => { unpins++ } },
    slots: { inject: (_name, run) => run(), register(meta, Component) { registrations.set(meta.name, Component); return () => registrations.delete(meta.name) } },
  })
  const Menu = registrations.get('sidebar.workspaces.session.menu.item')
  const Overlay = registrations.get('shell.overlay')
  const Settings = registrations.get('settings.section')
  let menuVisible = true, sessionId = 'ordinary', closeCalls = 0
  const render = () => root.render(h(React.Fragment, null,
    menuVisible && h(Menu, { sessionId, displayTitle: '归档示例', useWorkspaces: select => select(workspace), useMenuOpenState: () => [true, open => { assert.equal(open, false); closeCalls++; menuVisible = false; render() }] }),
    h(Overlay), h(Settings),
  ))
  const click = async (text, selector = 'button') => {
    const button = [...document.querySelectorAll(selector)].find(node => node.textContent === text)
    assert.ok(button, text)
    await act(async () => button.click())
  }
  await act(async () => render())
  assert.equal(document.querySelector('[role="menuitem"]'), null, 'ordinary sessions have no delete entry')
  sessionId = 'archived'
  await act(async () => render())
  const menu = document.querySelector('[role="menuitem"]')
  assert.equal(menu.dataset.danger, 'true')
  assert.ok(menu.querySelector('[data-icon="trash"]'))
  await click('删除会话', '[role="menuitem"]')
  assert.equal(closeCalls, 1)
  assert.equal(document.querySelector('[role="menuitem"]'), null)
  assert.ok(document.querySelector('[role="dialog"]'), 'dialog survives popup unmount')
  assert.match(document.querySelector('[role="dialog"]').textContent, /归档示例.*无法恢复.*不可逆/)
  assert.equal(calls, 0)
  await click('取消')
  assert.equal(calls, 0)
  assert.equal(document.querySelector('[role="dialog"]'), null)

  await click('删除会话') // Settings opens the same overlay.
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1)
  const confirmButton = document.querySelector('[role="dialog"] .sk-arch__delete')
  assert.equal(confirmButton.dataset.variant, 'outline')
  assert.equal(confirmButton.dataset.size, 'md')
  assert.ok(confirmButton.querySelector('[data-button-icon] [data-icon="trash"]'))
  const cancelButton = [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent === '取消')
  assert.equal(confirmButton.dataset.size, cancelButton.dataset.size)
  assert.equal(document.querySelector('.sk-arch__row .sk-arch__delete').dataset.size, 'sm')
  await click('确认删除')
  assert.equal(calls, 1)
  assert.match(document.querySelector('[role="alert"]').textContent, /删除失败：session-loaded/)
  assert.equal(refreshes, 0)
  assert.equal(unarchives, 0)
  response = () => new Promise(resolve => { complete = resolve })
  await click('确认删除')
  assert.equal(calls, 2)
  const pending = [...document.querySelectorAll('button')].find(node => node.textContent === '删除中…')
  assert.equal(pending.disabled, true)
  await act(async () => pending.click())
  await click('关闭')
  assert.ok(document.querySelector('[role="dialog"]'), 'cannot dismiss an in-progress deletion')
  assert.equal(calls, 2)
  await act(async () => complete({ ok: true, status: 200, json: async () => ({ ok: true }) }))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelector('.sk-arch__row'), null)
  assert.equal(refreshes, 1)
  assert.equal(unarchives, 1)
  assert.equal(unpins, 1)

  workspace.items = [
    { workspaceId: 'a', title: '项目 A', sessionIds: ['a1', 'a2'] },
    { workspaceId: 'b', title: '项目 B', sessionIds: ['b1'] },
  ]
  workspace.archivedSessionIds = ['a1', 'a2', 'b1']
  sessions.byId = { a1: { title: '第一条', updatedAt: 3 }, a2: { title: '第二条', updatedAt: 2 }, b1: { title: '其他项目', updatedAt: 1 } }
  await act(async () => render())
  assert.equal(document.querySelector('.sk-arch__head .sk-arch__subtitle').textContent, ARCH_COPY.zh.removeHint)
  assert.equal(document.querySelectorAll('.sk-arch__subtitle').length, 1)
  await click('删除全部', '.sk-arch__group:first-of-type button')
  assert.match(document.querySelector('[role="dialog"]').textContent, /项目 A.*全部 2 个归档会话.*不可逆/)
  assert.equal(calls, 2, 'bulk request still requires confirmation')
  await click('取消')
  const deleted = []
  response = async (_input, options) => {
    const { sessionId } = JSON.parse(options.body)
    deleted.push(sessionId)
    return { ok: sessionId === 'a1', status: sessionId === 'a1' ? 200 : 409, json: async () => sessionId === 'a1' ? { ok: true } : { ok: false, reason: 'session-loaded' } }
  }
  await click('删除全部', '.sk-arch__group:first-of-type button')
  await click('确认删除')
  assert.deepEqual(deleted, ['a1', 'a2'])
  assert.match(document.querySelector('[role="dialog"]').textContent, /全部 1 个归档会话/)
  assert.match(document.querySelector('[role="alert"]').textContent, /第二条: session-loaded/)
  assert.equal(document.querySelectorAll('.sk-arch__row').length, 2, 'failed session and other project remain')
  response = async (_input, options) => {
    deleted.push(JSON.parse(options.body).sessionId)
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  await click('确认删除')
  assert.deepEqual(deleted, ['a1', 'a2', 'a2'], 'retry only sends failed sessions')
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelectorAll('.sk-arch__row').length, 1)
  assert.match(document.querySelector('.sk-arch__row').textContent, /其他项目/)
  assert.equal(refreshes, 3)
  assert.equal(unarchives, 3)
  assert.equal(unpins, 3)
})
