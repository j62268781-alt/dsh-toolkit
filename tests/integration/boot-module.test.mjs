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
  assert.match(abyss.css, /perspective: 800px/)
  assert.match(abyss.css, /sk-depth-arrive/)
  assert.match(abyss.css, /sk-depth-assemble/)
  assert.doesNotMatch(abyss.css, /infinite/)
  assert.match(abyss.html, /sk-boot__ring--far/)
  assert.match(abyss.html, /sk-boot__ring--middle/)
  assert.match(abyss.html, /sk-boot__ring--near/)
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

test('settings panel previews above choices, applies animation immediately, and saves grouped settings independently', async (t) => {
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
  assert.ok(document.querySelector('.boot-preview-section').compareDocumentPosition(document.querySelector('.boot-options')) & app.dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(document.querySelectorAll('.boot-controls').length, 2)
  assert.equal(document.querySelectorAll('.boot-mode').length, 3)
  assert.equal(document.querySelectorAll('.boot-mode[aria-pressed="true"]').length, 1)

  const choose = async (label) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(label))
    assert.ok(button)
    await act(async () => button.click())
  }
  // An unsaved display draft must survive the volatile animation write.
  await act(async () => document.querySelector('[role="switch"][aria-label="显示文字标识"]').click())
  assert.deepEqual(writes, [])
  await choose('水面浮现')
  assert.deepEqual(writes, [['animation', 'water']])
  assert.equal(value().animation, 'water')
  assert.equal(value().showWordmark, true)
  assert.equal(document.querySelector('[aria-label="显示文字标识"]').getAttribute('aria-checked'), 'false')
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-animation="water"/)
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-wordmark="false"/)
  assert.match(app.text(), /已使用水面浮现/)
  await choose('保存设置')
  assert.deepEqual(writes, [['animation', 'water'], ['showWordmark', false]])
  assert.equal(value().showWordmark, false)
  assert.match(app.text(), /设置已保存/)
  const previousFrame = document.querySelector('.boot-preview')
  await choose('重新播放')
  assert.notEqual(document.querySelector('.boot-preview'), previousFrame)
  await choose('水面浮现')
  assert.deepEqual(writes, [['animation', 'water'], ['showWordmark', false]])
})

test('mode cards reuse the desktop whale and toggles match General Settings geometry and tokens', async (t) => {
  const { form } = makeForm({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true })
  const app = await mountPanel(t, form)
  const { document, getComputedStyle } = app.dom.window
  const logos = [...document.querySelectorAll('.boot-mode-art img')]
  assert.equal(logos.length, 3)
  assert.match(logos[0].getAttribute('src'), /^data:image\/png;base64,/)
  assert.ok(logos.every((logo) => logo.getAttribute('src') === logos[0].getAttribute('src')))
  assert.equal(document.querySelectorAll('.boot-mode-art svg').length, 0)
  const toggle = document.querySelector('[aria-label="显示文字标识"]')
  const thumb = toggle.querySelector('.boot-switch-thumb')
  assert.equal(getComputedStyle(toggle).width, '36px')
  assert.equal(getComputedStyle(toggle).height, '20px')
  assert.equal(getComputedStyle(toggle).padding, '2px')
  assert.equal(getComputedStyle(thumb).width, '16px')
  assert.equal(getComputedStyle(thumb).height, '16px')
  assert.equal(getComputedStyle(thumb).transform, 'translate(16px)')
  assert.equal(thumb.getAttribute('aria-hidden'), 'true')
  const rules = [...document.querySelector('style[data-plugin="toolkit-boot-panel"]').sheet.cssRules]
  const rule = (selector) => rules.find((item) => item.selectorText === selector).style
  assert.equal(rule('.boot-switch[aria-checked=true]').getPropertyValue('background'), 'var(--dsw-alias-brand-primary)')
  assert.equal(rule('.boot-switch[aria-checked=false] .boot-switch-thumb').getPropertyValue('background'), 'var(--dsw-alias-switch-thumb)')
  assert.match(rule('.boot-mode[aria-pressed=true]').getPropertyValue('border-color'), /--dsw-alias-brand-primary-new-colorprimary-new-color/)
  await act(async () => toggle.click())
  assert.equal(toggle.getAttribute('aria-checked'), 'false')
  assert.notEqual(getComputedStyle(thumb).transform, 'translate(16px)')
})

test('read-only config disables editors but keeps the local replay available', async (t) => {
  const { form, writes } = makeForm({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true }, { writable: false })
  const app = await mountPanel(t, form)
  const { document } = app.dom.window
  assert.match(app.text(), /当前配置不可写/)
  for (const control of document.querySelectorAll('.boot-mode,.boot-save,[role="switch"],select,input')) assert.equal(control.disabled, true, control.outerHTML)
  const replayButton = document.querySelector('.boot-button')
  assert.equal(replayButton.disabled, false)
  await act(async () => replayButton.click())
  assert.deepEqual(writes, [])
})

test('rejected animation writes restore the persisted selection and report the failure', async (t) => {
  const { form } = makeForm({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true })
  form.set = async () => false
  const app = await mountPanel(t, form)
  const { document } = app.dom.window
  await act(async () => document.querySelector('.boot-mode-art--abyss').closest('button').click())
  assert.match(document.querySelector('[role="alert"]').textContent, /宿主拒绝/)
  assert.match(document.querySelector('.boot-mode[aria-pressed="true"]').textContent, /经典描摹/)
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-animation="draw"/)
  assert.doesNotMatch(app.text(), /已使用深海之门/)
})

test('animation writes disable competing edits until accepted and persist only animation', async (t) => {
  const { form, writes } = makeForm({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true })
  const set = form.set
  let release
  form.set = async (field, next) => {
    await new Promise((resolve) => { release = resolve })
    return set(field, next)
  }
  const app = await mountPanel(t, form)
  const { document } = app.dom.window
  await act(async () => document.querySelector('.boot-mode-art--abyss').closest('button').click())
  assert.match(app.text(), /正在应用/)
  for (const control of document.querySelectorAll('.boot-mode,[role="switch"],select,input')) assert.equal(control.disabled, true)
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-animation="abyss"/)
  await act(async () => release())
  assert.deepEqual(writes, [['animation', 'abyss']])
  assert.match(document.querySelector('.boot-mode[aria-pressed="true"]').textContent, /深海之门/)
})

test('depth scene owns its light and dark palette and hides decorations in the two original modes', () => {
  for (const animation of ['draw', 'water', 'abyss']) {
    for (const theme of ['light', 'dark']) {
      const dom = new JSDOM(createPreviewDocument(sourceAssets, { animation, theme }))
      const { document } = dom.window
      const backdrop = dom.window.getComputedStyle(document.querySelector('.sk-boot')).getPropertyValue('--dsh-boot-bg')
      const depth = dom.window.getComputedStyle(document.querySelector('.sk-boot__depth')).display
      if (animation === 'abyss') {
        assert.match(backdrop, /radial-gradient/)
        assert.match(backdrop, theme === 'light' ? /#f4fcff/ : /#164667/)
        assert.equal(depth, 'block')
      } else {
        assert.equal(depth, 'none')
        assert.equal(backdrop, theme === 'light' ? '#f4fbfa' : '#101a1d')
      }
      dom.window.close()
    }
  }
})

test('depth artwork remains readable when reduced motion disables every animation', () => {
  const dom = new JSDOM(createPreviewDocument(sourceAssets, { animation: 'abyss', theme: 'dark' }))
  const styles = [...dom.window.document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
  const reduced = styles.filter((rule) => rule.conditionText === '(prefers-reduced-motion: reduce)').flatMap((rule) => [...rule.cssRules])
  const stop = reduced.find((rule) => rule.selectorText?.includes('.sk-boot *'))
  assert.equal(stop.style.getPropertyValue('animation'), 'none')
  assert.equal(stop.style.getPropertyPriority('animation'), 'important')
  const visible = reduced.find((rule) => rule.selectorText?.includes('.sk-boot .sk-boot__fill'))
  assert.equal(visible.style.getPropertyValue('opacity'), '1')
  assert.ok(visible.selectorText.includes('.sk-boot .sk-boot__wordmark'))
  assert.equal(dom.window.document.querySelectorAll('.sk-boot__ring').length, 3)
  assert.equal(dom.window.document.querySelectorAll('script,canvas,img,video').length, 0)
  dom.window.close()
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
