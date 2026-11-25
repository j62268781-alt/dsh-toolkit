import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React from 'react'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { WORKTREES_COPY } from '../../src/modules/worktrees/client/locale.js'
import { MANAGED_WORKTREE_CHECK_PATH, MANAGED_WORKTREE_SNAPSHOTS_PATH, MANAGED_WORKTREES_PATH, WORKTREE_CONFIG_PATH } from '../../src/modules/worktrees/host/constants.js'

test('independent settings handle retention, saved-config conflicts, managed-list refresh and snapshot recovery', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://dsh.example.test', pretendToBeVisual: true })
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }
  t.after(() => dom.window.close())
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const doc = dom.window.document
  const cfg = { directory: '.agents/worktrees', namePrefix: 'dsh-' }
  const submitted = []
  let conflict = false
  let managedReads = 0
  let finishRefresh
  let finishCheck
  let checkSignal
  let checkReads = 0
  const commits = ['a'.repeat(40), 'b'.repeat(64)]
  const snapshotRequests = []
  let finishRestore
  const navigation = []
  let failOpen = true
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsedUrl = new URL(url, dom.window.location.href)
    switch (parsedUrl.pathname) {
      case WORKTREE_CONFIG_PATH:
        if (options.method === 'POST') {
          const body = JSON.parse(options.body)
          submitted.push(body)
          if (conflict) {
            cfg.directory = '.agents/changed-elsewhere'
            return Response.json({ ok: false }, { status: 409 })
          }
          assert.deepEqual(body.expected, cfg)
          Object.assign(cfg, { directory: body.directory || '.agents/worktrees', namePrefix: body.namePrefix })
          return Response.json({ ok: true, ...cfg })
        }
        return Response.json({ ok: true, ...cfg })
      case MANAGED_WORKTREES_PATH: {
        const request = ++managedReads
        if (request === 3) return new Promise(resolve => { finishRefresh = resolve })
        return Response.json({ ok: true, cleanupCheck: request !== 1, snapshots: request !== 1, worktrees: request === 1 ? [] : [
          { path: '/repo/.agents/worktrees/one', repositoryRoot: '/repo', branch: 'dsh-one', status: 'present',
            sessionId: 'one', sessionTitle: 'Active topic', sessionArchived: false },
          { path: '/second/three', repositoryRoot: '/second', branch: 'dsh-three', status: 'unknown',
            sessionId: 'three' },
          { path: '/repo/two', repositoryRoot: '/repo', branch: 'dsh-two', status: 'missing',
            sessionId: 'two', sessionTitle: 'Archived topic', sessionArchived: true },
        ] })
      }
      case MANAGED_WORKTREE_CHECK_PATH:
        assert.equal(options.method, undefined)
        assert.deepEqual(Object.fromEntries(parsedUrl.searchParams), {
          sessionId: 'two', repositoryRoot: '/repo', path: '/repo/two',
        })
        if (++checkReads === 1) return Response.json({ ok: true, eligible: true, reason: 'clean' })
        if (checkReads === 2) return Response.json({ ok: true, eligible: false, reason: 'checkout-missing' })
        if (checkReads === 3) {
          checkSignal = options.signal
          return new Promise(resolve => { finishCheck = resolve })
        }
        throw new Error('Unexpected repeated check')
      case MANAGED_WORKTREE_SNAPSHOTS_PATH: {
        const method = options.method ?? 'GET'
        snapshotRequests.push({ method, target: Object.fromEntries(parsedUrl.searchParams), body: options.body })
        if (method === 'GET') return Response.json({ ok: true, commits })
        return new Promise(resolve => { finishRestore = resolve })
      }
      default: throw new Error(`Unexpected URL ${url}`)
    }
  })
  let registered
  let value = { retainOnArchive: false }
  const writes = []
  const retainForm = {
    getSnapshot: () => ({ value, status: 'ready', writable: true }),
    set(key, next) { writes.push([key, next]); value = { ...value, [key]: next } },
  }
  const clientPath = new URL('../../packages/worktrees/lib/client.js', import.meta.url)
  let client
  vm.runInNewContext(await readFile(clientPath, 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'dsh-toolkit-worktrees')
      client = factory(name => { assert.equal(name, 'react'); return React })
    } } },
    fetch: globalThis.fetch, AbortController, AbortSignal, Headers, URLSearchParams,
  })
  client.apply({
    effect(run, label) { if (label === 'dsh-toolkit-worktrees:settings') run() },
    locale: { bind: () => key => WORKTREES_COPY.zh[key] },
    slots: { inject(name, run) { assert.equal(name, 'settings.section'); run() }, register(...args) { registered = args } },
    configForms: { get(id) { assert.equal(id, 'worktree'); return retainForm } },
    get(name) {
      assert.equal(name, 'uiWorkspace')
      return { openSession(id) {
        if (failOpen) throw new Error('session not found')
        navigation.push(['open', id])
      } }
    },
  })
  const [descriptor, Section] = registered
  assert.equal(descriptor.id, 'worktrees')
  const root = createRoot(doc.getElementById('root'))
  const button = label => [...doc.querySelectorAll('button')].find(node => node.textContent === label)
  try {
    await act(async () => root.render(React.createElement(Section, {
      ...descriptor.inject(), close: () => navigation.push(['close']),
    })))
    assert.match(doc.body.textContent, /没有受管工作树记录/)
    const input = doc.querySelector('[name="directory"]')
    assert.equal(input.value, '.agents/worktrees')
    const toggle = doc.querySelector('[role="switch"]')
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    await act(async () => toggle.click())
    assert.deepEqual(writes, [['retainOnArchive', true]])
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    const change = (element, value) => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }
    const prefix = doc.querySelector('[name="namePrefix"]')
    await act(async () => { input.focus(); change(input, '.agents/custom') })
    assert.equal(submitted.length, 0)
    await act(async () => { prefix.focus(); change(prefix, 'test-'); prefix.blur() })
    assert.deepEqual(submitted, [
      { expected: { directory: '.agents/worktrees', namePrefix: 'dsh-' }, directory: '.agents/custom', namePrefix: 'dsh-' },
      { expected: { directory: '.agents/custom', namePrefix: 'dsh-' }, directory: '.agents/custom', namePrefix: 'test-' },
    ])
    assert.equal(doc.querySelector('[name="directory"]'), input)
    assert.equal(managedReads, 1)
    assert.match(doc.body.textContent, /已保存/)
    assert.equal(input.required, false)
    const help = doc.getElementById(input.getAttribute('aria-describedby').split(' ')[0])
    assert.match(help.textContent, /清空后离开输入框，恢复 DSH 默认目录/)
    await act(async () => { input.focus(); change(input, '') })
    assert.equal(submitted.length, 2)
    assert.equal(input.value, '')
    await act(async () => prefix.focus())
    assert.deepEqual(submitted[2], {
      expected: { directory: '.agents/custom', namePrefix: 'test-' }, directory: '', namePrefix: 'test-',
    })
    assert.equal(input.value, '.agents/worktrees')
    assert.equal(prefix.value, 'test-')
    assert.equal(input.getAttribute('aria-invalid'), 'false')
    assert.equal(managedReads, 1)
    conflict = true
    await act(async () => { input.focus(); change(input, '.agents/conflict'); input.blur() })
    assert.equal(input.disabled, true)
    await act(async () => button('重新读取').click())
    assert.equal(input.value, '.agents/changed-elsewhere')
    const refresh = button('刷新列表')
    await act(async () => refresh.click())
    const groups = [...doc.querySelectorAll('.sk-worktrees__repository')]
    assert.deepEqual(groups.map(node => node.textContent), ['来源仓库: /repo', '来源仓库: /second'])
    const [active, archived] = groups[0].nextElementSibling.children
    assert.match(active.textContent, /dsh-one.*目录存在.*Active topic/)
    assert.match(archived.textContent, /dsh-two.*目录不存在.*Archived topic.*已归档/)
    assert.ok(!archived.querySelector('[aria-label^="打开会话"]'))
    assert.match(groups[1].nextElementSibling.textContent, /dsh-three.*无法确认目录状态.*three/)
    assert.ok(!groups[1].nextElementSibling.querySelector('[aria-label^="打开会话"]'))

    const { snapshotLoad, restoreCreate, restoreSucceeded } = WORKTREES_COPY.zh
    const recoveryButtons = [...doc.querySelectorAll('button')].filter(node => node.textContent === snapshotLoad)
    assert.equal(recoveryButtons.length, 1, 'only a confirmed archived row offers recovery')
    const [load] = recoveryButtons
    assert.ok(archived.contains(load))
    assert.ok(!archived.querySelector('form'))
    assert.deepEqual(snapshotRequests, [], 'listing managed worktrees does not read snapshots')
    await act(async () => load.click())
    const target = { sessionId: 'two', repositoryRoot: '/repo', path: '/repo/two' }
    assert.deepEqual(snapshotRequests, [{ method: 'GET', target, body: undefined }])
    const form = archived.querySelector('form')
    assert.equal(form.getAttribute('aria-label'), restoreCreate)
    const select = form.querySelector('select')
    assert.deepEqual([...select.options].map(option => option.value), commits)
    const branch = form.querySelector('input')
    const submit = form.querySelector('[type="submit"]')
    await act(async () => submit.click())
    assert.equal(snapshotRequests.length, 1, 'an empty branch cannot be submitted')
    await act(async () => {
      select.value = commits[1]
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      change(branch, 'recover/two')
    })
    assert.equal(snapshotRequests.length, 1, 'editing the form does not create a branch')
    await act(async () => {
      // Submit twice before React commits the disabled state, exercising the request guard.
      form.requestSubmit(submit)
      form.requestSubmit(submit)
    })
    assert.equal(snapshotRequests.length, 2)
    const restore = snapshotRequests[1]
    assert.equal(restore.method, 'POST')
    assert.deepEqual(restore.target, target)
    assert.deepEqual(JSON.parse(restore.body), { branch: 'recover/two', commit: commits[1] })
    assert.equal(submit.disabled, true)
    await act(async () => finishRestore(Response.json({ ok: true, branch: 'recover/two', commit: commits[1] })))
    const status = [...archived.querySelectorAll('[role="status"]')]
    assert.ok(status.some(node => node.textContent.includes(restoreSucceeded) && node.textContent.includes('recover/two')))
    assert.equal(submit.disabled, false)

    assert.equal(checkReads, 0)
    const check = archived.querySelector('[aria-label^="检查清理条件"]')
    assert.match(check.getAttribute('aria-label'), /dsh-two.*\/repo\/two/)
    await act(async () => check.click())
    assert.match(archived.querySelector('[role="status"]').textContent, /符合清理条件（未删除）/)
    await act(async () => check.click())
    assert.match(archived.querySelector('[role="status"]').textContent, /不可清理：工作树目录不存在/)
    await act(async () => { check.focus(); check.click(); check.click() })
    assert.equal(checkReads, 3)
    assert.equal(check.getAttribute('aria-disabled'), 'true')
    assert.ok(doc.activeElement === check)
    assert.equal(archived.querySelector('[role="status"]').textContent, '')
    const open = active.querySelector('[aria-label^="打开会话"]')
    assert.match(open.getAttribute('aria-label'), /打开会话: Active topic/)
    await act(async () => open.click())
    assert.deepEqual(navigation, [])
    assert.match(doc.body.textContent, /无法打开此会话/)
    await act(async () => refresh.click())
    assert.equal(refresh.getAttribute('aria-disabled'), 'true')
    assert.ok(active.isConnected)
    assert.equal(checkSignal.aborted, true)
    await act(async () => finishCheck(Response.json({ ok: true, eligible: true, reason: 'clean' })))
    await act(async () => finishRefresh(Response.json({}, { status: 500 })))
    assert.equal(check.getAttribute('aria-disabled'), 'true')
    assert.doesNotMatch(archived.textContent, /符合清理条件/)
    assert.ok(open.isConnected)
    assert.equal(refresh.getAttribute('aria-disabled'), 'false')
    assert.match(doc.body.textContent, /刷新失败，仍显示上次读取的结果/)
    failOpen = false
    await act(async () => open.click())
    assert.deepEqual(navigation, [['open', 'one'], ['close']])
    assert.equal(managedReads, 3)
  } finally {
    await act(async () => root.unmount())
  }
})
