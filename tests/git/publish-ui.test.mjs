import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act, createElement as h } from 'react'
import { GIT_PUBLISH_ACTION_PATH, GIT_PUBLISH_PREVIEW_PATH, GIT_PUBLISH_REASON } from '../../src/modules/git/client/constants.js'
import { GIT_PUBLISH_COPY } from '../../src/modules/git/client/components/publish/locale.js'
import { announceRepositoryChange, onRepositoryChange } from '../../src/modules/git/client/repository-events.js'

const { en } = GIT_PUBLISH_COPY
const cwd = '/example/project'
const destination = { remote: 'origin', ref: 'refs/heads/main', url: 'https://git.example.test/project.git' }
const preview = (action, overrides = {}) => ({
  ok: true, action, branch: 'main', head: 'abc123', stagedPaths: action === 'commit' ? ['staged.ts'] : [],
  destination: action === 'push' ? destination : null, ahead: action === 'push' ? 2 : null, behind: action === 'push' ? 0 : null,
  token: `${action}-preview`, ...overrides,
})

async function setup(t) {
  const { window } = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://dsh.example.test', pretendToBeVisual: true })
  const requests = []
  const Button = ({ variant, ...props }) => h('button', props)
  const Modal = ({ title, description, children, footer, closeLabel, onClose }) => h('section', { role: 'dialog' },
    h('h2', null, title), h('p', null, description), h('button', { onClick: onClose }, closeLabel), children, footer)
  const globals = {
    window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true, __dshReact: React,
    require: (id) => {
      assert.equal(id, '@deepseek-ai/dsh-client-ui-primitives')
      return { Modal, Button }
    },
    fetch: (path, options) => new Promise((resolve, reject) => requests.push({
      path, method: options.method, body: JSON.parse(options.body), reject,
      respond: (payload, status = 200) => resolve({ ok: status < 400, status, json: async () => payload }),
    })),
  }
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client')
  const { createGitPublish } = await import('../../src/modules/git/client/components/publish/index.js')
  const { clearToasts } = await import('../../src/client/ui/toast.js')
  const app = document.getElementById('root')
  const root = createRoot(app)
  const Publish = createGitPublish({ locale: { bind: (ns) => {
    assert.equal(ns, 'shell-kit.task-monitor')
    return (key) => en[key]
  } } })
  t.after(async () => {
    await act(() => root.unmount())
    clearToasts()
    window.close()
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const render = (directory) => act(() => root.render(h(Publish, { cwd: directory }, 'Publish row')))
  await render(cwd)
  const button = (label) => {
    const match = [...app.querySelectorAll('button')].find((element) => element.textContent === label)
    assert.ok(match, `Missing button: ${label}`)
    return match
  }
  const click = (label) => act(() => button(label).click())
  const row = button('Publish row')
  assert.equal(row.getAttribute('data-kind'), 'environment')
  assert.equal(row.hasAttribute('data-clickable'), true)
  assert.ok(row.classList.contains('sk-task-monitor__row'))
  await click('Publish row')
  return { window, app, requests, button, click, render }
}

test('commit previews only staged paths, requires a message, and never automatically pushes', async (t) => {
  const { window, app, requests, button, click } = await setup(t)
  assert.equal(requests.length, 0)
  await click(en.gitPublishPreviewCommit)
  assert.deepEqual(requests.map(({ path, method, body }) => ({ path, method, body })), [
    { path: GIT_PUBLISH_PREVIEW_PATH, method: 'POST', body: { cwd, action: 'commit' } },
  ])
  await act(() => requests[0].respond(preview('commit', { stagedPaths: [] })))
  assert.equal(button(en.gitPublishConfirmCommit).disabled, true)
  assert.ok(app.textContent.includes(en.gitPublishNothingStaged))
  await click(en.gitPublishPreviewCommit)
  await act(() => requests[1].respond(preview('commit')))
  assert.equal(button(en.gitPublishConfirmCommit).disabled, true)
  assert.ok(app.textContent.includes('staged.ts'))
  assert.ok(app.textContent.includes(en.gitPublishStagedOnly))
  const input = app.querySelector('textarea')
  assert.equal(app.querySelector('label').htmlFor, input.id)
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, '  Fix example  ')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  assert.equal(button(en.gitPublishConfirmCommit).disabled, false)
  await act(() => {
    button(en.gitPublishConfirmCommit).click()
    button(en.gitPublishConfirmCommit).click()
    button(en.gitPublishClose).click()
  })
  assert.ok(app.querySelector('[role="dialog"]'))
  assert.equal(requests.length, 3)
  assert.equal(requests[2].path, GIT_PUBLISH_ACTION_PATH)
  assert.deepEqual(requests[2].body, { cwd, action: 'commit', token: 'commit-preview', message: 'Fix example' })
  let changes = 0
  const off = onRepositoryChange(cwd, () => ++changes)
  try {
    await act(() => requests[2].respond({ ok: true, action: 'commit' }))
  } finally {
    off()
  }
  assert.ok(!app.querySelector('[role="dialog"]'))
  assert.equal(requests.length, 3)
  assert.equal(changes, 1)
})

test('push confirms exact preview, rejects stale or superseded previews and cannot silently retry', async (t) => {
  const { app, requests, button, click, render } = await setup(t)
  await click(en.gitPublishPreviewCommit)
  await click(en.gitPublishPreviewPush)
  await act(() => requests[1].respond(preview('push', { behind: 1 })))
  await act(() => requests[0].respond(preview('commit')))
  assert.ok(app.textContent.includes(destination.ref))
  assert.ok(app.textContent.includes(destination.url))
  assert.ok(app.textContent.includes(en.gitPublishPushBehind))
  assert.equal(button(en.gitPublishConfirmPush).disabled, true)
  assert.ok(!app.querySelector('textarea'))
  await click(en.gitPublishPreviewPush)
  await act(() => requests[2].respond(preview('push')))
  await act(() => announceRepositoryChange(cwd))
  assert.equal(button(en.gitPublishConfirmPush).disabled, true)
  assert.ok(app.textContent.includes(en.gitPublishStale))
  await click(en.gitPublishPreviewPush)
  await act(() => requests[3].respond(preview('push', { token: 'fresh' })))
  await click(en.gitPublishConfirmPush)
  assert.deepEqual(requests[4].body, { cwd, action: 'push', token: 'fresh' })
  await act(() => requests[4].reject(Error('network disconnected')))
  assert.equal(button(en.gitPublishConfirmPush).disabled, true)
  assert.ok(app.textContent.includes(en.gitPublishUncertain))
  assert.equal(requests.length, 5)
  await click(en.gitPublishPreviewPush)
  await act(() => requests[5].respond(preview('push', { token: 'next' })))
  await click(en.gitPublishConfirmPush)
  await act(() => requests[6].respond({ ok: false, code: GIT_PUBLISH_REASON['stale-preview'], detail: 'Snapshot changed' }, 409))
  assert.equal(button(en.gitPublishConfirmPush).disabled, true)
  assert.ok(app.textContent.includes(en.gitPublishStale))
  assert.ok(app.textContent.includes('Snapshot changed'))
  await click(en.gitPublishPreviewPush)
  await render('/different/worktree')
  await act(() => requests[7].respond(preview('push')))
  assert.ok(!app.querySelector('[role="dialog"]'))
  assert.equal(requests.length, 8)
})
