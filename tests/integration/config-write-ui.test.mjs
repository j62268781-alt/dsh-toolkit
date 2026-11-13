import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const valid = { protocol: 'system-one', baseUrl: 'https://example.test/api', model: 'model', credentialRef: 'KEY', timeoutMs: 1000 }

test('Judgment rejected configuration keeps editor and never writes credentials; legacy success proceeds', async t => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://dsh.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const React = (await import('react')).default
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const result = await build({
    entryPoints: ['src/modules/judgment/client/panel.tsx'], bundle: true, platform: 'node', format: 'esm',
    target: 'node20', external: ['react', 'react/*'], jsx: 'automatic', loader: { '.css': 'text' }, write: false, logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  await writeFile('node_modules/.cache/config-write-ui.mjs', result.outputFiles[0].text)
  const { Panel } = await import('../../node_modules/.cache/config-write-ui.mjs')
  const root = createRoot(document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  let accepted = false, writes = 0, credentialsWrites = 0
  const form = { getSnapshot: () => ({ value: { connections: { demo: valid } }, status: 'ready' }),
    subscribe: () => () => {}, set: async () => { writes++; return accepted } }
  const credentials = { describe: async () => ({ ok: true, value: { KEY: { configured: false } } }),
    set: async () => { credentialsWrites++; return { ok: true } } }
  const clickText = async label => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === label)
    assert.ok(button, `button ${label}`)
    await act(async () => button.click())
  }
  await act(async () => root.render(React.createElement(Panel, { form, credentials })))
  const trigger = document.querySelector('[aria-label="更多操作"]')
  trigger.getBoundingClientRect = () => ({ top: 740, bottom: 760, right: 1000 })
  await act(async () => trigger.click())
  assert.equal(document.querySelector('[role="menu"]').style.position, 'fixed')
  assert.equal(document.querySelector('[role="menu"]').style.top, 'auto')
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('[role="menu"]'), null)
  await act(async () => trigger.click())
  await act(async () => document.dispatchEvent(new dom.window.Event('scroll')))
  assert.equal(document.querySelector('[role="menu"]'), null)
  await act(async () => trigger.click())
  await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
  assert.equal(document.querySelector('[role="menu"]'), null)
  await act(async () => trigger.click())
  await clickText('编辑')
  const input = document.querySelector('input[type="password"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'test-secret-value')
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await clickText('保存')
  assert.equal(writes, 1)
  assert.equal(credentialsWrites, 0)
  assert.match(document.body.textContent, /宿主拒绝/)
  assert.ok(document.querySelector('input[type="password"]'), 'rejected editor remains open')
  accepted = undefined
  await clickText('保存')
  assert.equal(writes, 2)
  assert.equal(credentialsWrites, 1)
  assert.equal(document.querySelector('input[type="password"]'), null)
})
