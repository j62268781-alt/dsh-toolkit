import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { readFile, writeFile, rm } from 'node:fs/promises'

import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { apply as applyHost } from '../../src/modules/boot/host/index.js'
import { createBootScene, createPreviewDocument } from '../../src/modules/boot/host/scene.js'

const sourceAssets = {
  css: await readFile(new URL('../../src/modules/boot/host/boot.css', import.meta.url), 'utf8'),
  html: await readFile(new URL('../../src/modules/boot/host/boot.html', import.meta.url), 'utf8'),
  script: await readFile(new URL('../../src/modules/boot/host/boot.js', import.meta.url), 'utf8'),
}

const panelBundle = `node_modules/.cache/boot-panel-test-${process.pid}.mjs`
const builtPanel = await build({
  entryPoints: ['src/modules/boot/client/index.jsx'], bundle: true, platform: 'node', format: 'esm',
  target: 'node20', external: ['react', 'react/*'], jsxFactory: '__dshReact.createElement',
  jsxFragment: '__dshReact.Fragment', loader: { '.css': 'text', '.html': 'text' }, write: false, logLevel: 'silent',
})
await writeFile(panelBundle, builtPanel.outputFiles[0].text)
const { apply: applyClient, BootPanel } = await import(`${pathToFileURL(process.cwd() + '/' + panelBundle).href}?test=${Date.now()}`)

test('host reads every volatile config leaf on each index injection', async () => {
  let values = { animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true }
  const reads = Object.fromEntries(Object.keys(values).map((field) => [field, 0]))
  const config = Object.fromEntries(Object.keys(values).map((field) => [field, { get() { reads[field]++; return values[field] } }]))
  let inject
  applyHost({ on(event, callback) { assert.equal(event, 'webserver/index-inject'); inject = callback } }, config)
  assert.equal(typeof inject, 'function')

  const first = []
  inject(first)
  const firstHtml = first.find((item) => item.kind === 'html').html
  assert.match(firstHtml, /data-sk-animation="draw"/)
  assert.match(firstHtml, /data-sk-duration="2400"/)
  assert.match(firstHtml, /data-sk-theme="auto"/)
  assert.match(firstHtml, /data-sk-wordmark="true"/)
  assert.match(firstHtml, /data-sk-skip="true"/)
  assert.equal(first.find((item) => item.kind === 'script').text, sourceAssets.script)

  values = { animation: 'water', durationMs: 5200, theme: 'dark', showWordmark: false, allowSkip: false }
  const second = []
  inject(second)
  const secondHtml = second.find((item) => item.kind === 'html').html
  assert.match(secondHtml, /data-sk-animation="water"/)
  assert.match(secondHtml, /data-sk-duration="5200"/)
  assert.match(secondHtml, /data-sk-theme="dark"/)
  assert.match(secondHtml, /data-sk-wordmark="false"/)
  assert.match(secondHtml, /data-sk-skip="false"/)
  assert.match(second.find((item) => item.kind === 'style').text, /sk-ripple/)
  assert.ok(Object.values(reads).every((count) => count === 2))
})

test('scene presets are distinct, constrained and safe from config markup', () => {
  const draw = createBootScene(sourceAssets, { animation: 'draw' })
  const water = createBootScene(sourceAssets, { animation: 'water' })
  const abyss = createBootScene(sourceAssets, { animation: 'abyss' })
  assert.notEqual(draw.html, water.html)
  assert.notEqual(water.html, abyss.html)
  assert.match(water.css, /sk-ripple/)
  assert.match(water.css, /sk-water-reflect/)
  assert.match(abyss.css, /sk-sonar/)
  assert.match(abyss.css, /sk-whale-dive/)
  assert.match(abyss.css, /sk-abyss-assemble/)
  assert.match(abyss.css, /prefers-reduced-motion/)
  assert.match(draw.css, /sk-trace/)
  assert.match(draw.css, /prefers-reduced-motion/)

  const hostile = createBootScene(sourceAssets, { animation: '" onload="x', durationMs: 999999, theme: '<script>', showWordmark: false, allowSkip: false })
  assert.match(hostile.html, /data-sk-animation="draw"/)
  assert.match(hostile.html, /data-sk-duration="8000"/)
  assert.match(hostile.html, /data-sk-theme="auto"/)
  assert.match(hostile.html, /data-sk-wordmark="false"/)
  assert.doesNotMatch(hostile.html, /onload=/)
  assert.match(createBootScene(sourceAssets, { animation: 'abyss' }).html, /data-sk-animation="abyss"/)
  assert.match(createBootScene(sourceAssets, { animation: 'aurora' }).html, /data-sk-animation="draw"/)
})

test('preview is inline and script-free with iframe-local theme selection', () => {
  for (const theme of ['auto', 'light', 'dark']) {
    const html = createPreviewDocument(sourceAssets, { animation: 'abyss', theme })
    assert.doesNotMatch(html, /<script\b/i)
    assert.match(html, /\.sk-boot__mark/)
    assert.match(html, /<svg\b/)
    if (theme === 'auto') assert.match(html, /@media \(prefers-color-scheme:dark\)/)
    if (theme === 'dark') assert.match(html, /<body data-ds-dark-theme>/)
    if (theme === 'light') assert.match(html, /<body data-ds-light-theme>/)
  }
})

function makeForm(initial, { writable = true } = {}) {
  let value = { ...initial }
  const listeners = new Set()
  const writes = []
  const form = {
    writable,
    getSnapshot: () => ({ value, status: 'ready', writable }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async set(field, next) {
      writes.push([field, next])
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
      await Promise.resolve()
      return undefined
    },
  }
  return { form, writes, value: () => value }
}

async function mountPanel(t, form) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://dsh.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const registrations = new Map()
  const cleanups = []
  const ctx = {
    configForms: { get(id) { assert.equal(id, 'dsh-toolkit-boot'); return form } },
    effect(run) { const off = run(); if (typeof off === 'function') cleanups.push(off); return off },
    slots: {
      inject(_name, callback) { callback() },
      register(meta, component) { registrations.set(meta.id, { meta, component }); return () => registrations.delete(meta.id) },
    },
  }
  applyClient(ctx)
  const root = createRoot(dom.window.document.getElementById('root'))
  const panel = registrations.get('boot')
  assert.ok(panel)
  await act(async () => root.render(React.createElement(panel.component, { form })))
  t.after(async () => {
    await act(async () => root.unmount())
    for (const off of cleanups.reverse()) off()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { dom, root, panel, text: () => dom.window.document.body.textContent }
}

test('settings panel installs styles, registers order, saves multiple fields without draft loss, and sandboxes preview', async (t) => {
  const { form, writes, value } = makeForm({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true })
  const app = await mountPanel(t, form)
  const { document } = app.dom.window
  assert.equal(app.panel.meta.order, 15)
  assert.equal(app.panel.meta.name, 'settings.section')
  const style = document.querySelector('style[data-plugin="toolkit-boot-panel"]')
  assert.ok(style)
  assert.match(style.textContent, /\.boot-preview/)
  const frame = document.querySelector('iframe.boot-preview')
  assert.ok(frame)
  assert.equal(frame.getAttribute('sandbox'), '')
  assert.doesNotMatch(frame.getAttribute('srcdoc'), /<script\b/i)
  assert.match(frame.getAttribute('srcdoc'), /@media \(prefers-color-scheme:dark\)/)

  const choose = async (label) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(label))
    assert.ok(button)
    await act(async () => button.click())
  }
  await choose('水面浮现')
  await act(async () => document.querySelector('input[type=checkbox]').click())
  await choose('保存')
  assert.deepEqual(writes, [['animation', 'water'], ['showWordmark', false]])
  assert.equal(value().animation, 'water')
  assert.equal(value().showWordmark, false)
  assert.match(app.text(), /设置已保存/)
})

test('read-only config disables every editor and shows an explanation', async (t) => {
  const { form } = makeForm({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true }, { writable: false })
  const app = await mountPanel(t, form)
  const { document } = app.dom.window
  assert.match(app.text(), /当前配置不可写/)
  for (const control of document.querySelectorAll('button,select,input')) assert.equal(control.disabled, true, control.outerHTML)
})

test('standalone package exposes its Host and Web client entries', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../packages/boot/package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.main, './index.js')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.dsh.client.immediately, true)
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
})

test('boot lifecycle preserves configured duration, skip, readiness and failsafe cleanup', async () => {
  assert.match(sourceAssets.script, /var MIN_SHOW = 1700;/)
  assert.match(sourceAssets.script, /var FADE = 280;/)
  assert.match(sourceAssets.script, /data-sk-duration/)
  assert.match(sourceAssets.script, /data-sk-skip/)
  assert.match(sourceAssets.script, /MAX_SHOW = 10000/)
  assert.match(sourceAssets.script, /observer\.disconnect\(\)/)
  assert.match(sourceAssets.script, /document\.querySelector\('\[data-slot="sidebar"\]'\)/)
})

test.after(async () => { await rm(panelBundle, { force: true }) })
