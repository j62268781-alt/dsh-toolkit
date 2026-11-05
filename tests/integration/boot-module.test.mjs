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
  assert.match(secondHtml, /data-sk-duration="2900"/)
  assert.match(secondHtml, /data-sk-theme="dark"/)
  assert.match(secondHtml, /data-sk-wordmark="false"/)
  assert.match(secondHtml, /data-sk-skip="false"/)
  assert.match(second.find((item) => item.kind === 'style').text, /sk-ocean-ripple/)
  assert.equal(reads.durationMs, 0)
  assert.ok(Object.entries(reads).filter(([field]) => field !== 'durationMs').every(([, count]) => count === 2))
})

test('persisted keys map to the three requested scenes without config markup injection', () => {
  const draw = createBootScene(sourceAssets, { animation: 'draw' })
  const water = createBootScene(sourceAssets, { animation: 'water' })
  const abyss = createBootScene(sourceAssets, { animation: 'abyss' })
  assert.match(draw.html, /sk-boot__trace/)
  assert.doesNotMatch(draw.html, /sk-boot-ocean|portal|depth|impact/)
  assert.match(water.html, /sk-boot-ocean__arc-x/)
  assert.match(water.html, /sk-boot-ocean__arc-y/)
  assert.match(water.html, /sk-boot-ocean__arc-rot/)
  assert.match(water.html, /sk-boot-ocean__shock/)
  assert.doesNotMatch(water.html, /sk-boot-ocean__whale-track|portal/)
  assert.match(abyss.html, /sk-boot-ocean__whale-track/)
  assert.match(abyss.html, /sk-boot-ocean__whale-lift/)
  assert.match(abyss.html, /sk-boot-ocean__whale-tilt/)
  assert.doesNotMatch(abyss.html, /sk-boot-ocean__arc-x|portal|depth/)
  const hostile = createBootScene(sourceAssets, { animation: '" onload="x', durationMs: 999999, theme: '<script>', showWordmark: false, allowSkip: false })
  assert.match(hostile.html, /data-sk-animation="draw"/)
  assert.match(hostile.html, /data-sk-duration="2400"/)
  assert.match(hostile.html, /data-sk-theme="auto"/)
  assert.match(hostile.html, /data-sk-wordmark="false"/)
  assert.doesNotMatch(hostile.html, /onload=/)
  assert.match(createBootScene(sourceAssets, { animation: 'aurora' }).html, /data-sk-animation="draw"/)
})

test('preview is inline and script-free with iframe-local theme selection', () => {
  for (const theme of ['auto', 'light', 'dark']) {
    const html = createPreviewDocument(sourceAssets, { animation: 'abyss', theme })
    assert.doesNotMatch(html, /<script\b/i)
    assert.match(html, /\.sk-boot-ocean__whale/)
    assert.match(html, /<svg\b/)
    if (theme === 'auto') assert.match(html, /@media \(prefers-color-scheme:\s*dark\)/)
    if (theme === 'dark') assert.match(html, /<body data-ds-dark-theme>/)
    if (theme === 'light') assert.match(html, /<body data-ds-light-theme>/)
  }
})

test('ocean trajectories and wave profiles retain the design demos instead of approximation artwork', async () => {
  const rendered = new JSDOM(createPreviewDocument(sourceAssets, { animation: 'water' }))
  const keyframes = (document) => new Map([...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
    .filter((rule) => rule.name && rule.cssRules)
    .map((rule) => [rule.name, [...rule.cssRules].map((frame) => frame.cssText).join('')]))
  const actual = keyframes(rendered.window.document)
  for (const [file, animation, names] of [
    ['demo-morph.html', 'water', ['arc-x', 'arc-y', 'arc-rot', 'lock-shake', 'wordmark-in', 'shock', 'flash', 'drop', 'foam', 'ripple']],
    ['demo.html', 'abyss', ['whale-x', 'whale-y', 'whale-tilt', 'brand-in']],
  ]) {
    const source = new JSDOM(await readFile(new URL(`../../docs/boot/${file}`, import.meta.url), 'utf8'))
    const expected = keyframes(source.window.document)
    for (const name of names) assert.equal(actual.get(`sk-ocean-${name}`), expected.get(name), `${file}: ${name}`)
    const scene = new JSDOM(createBootScene(sourceAssets, { animation }).html)
    for (const layer of ['back', 'mid', 'front']) {
      const original = source.window.document.querySelector(`.sea__wave--${layer}`)
      const wave = scene.window.document.querySelector(`.sk-boot-ocean__sea-wave--${layer}`)
      assert.equal(wave.getAttribute('viewBox'), original.getAttribute('viewBox'))
      assert.equal(wave.querySelector('path').getAttribute('d'), original.querySelector('path').getAttribute('d'))
    }
    assert.equal(scene.window.document.querySelector('.sk-boot-ocean__mark path,.sk-boot-ocean__whale path').getAttribute('d'),
      source.window.document.querySelector('.mark path,.whale path').getAttribute('d'))
    scene.window.close()
    source.window.close()
  }
  rendered.window.close()
})

test('preview and runtime share finite particles at original speed, ignoring legacy duration settings', () => {
  for (const [animation, count, rippleCount, timeline] of [['water', 20, 3, 2900], ['abyss', 52, 9, 4500]]) {
    for (const durationMs of [undefined, 1, 1700, 2400, 8000, 999999, 'invalid']) {
      const config = { animation, durationMs, theme: 'dark', showWordmark: false, allowSkip: false }
      const runtime = createBootScene(sourceAssets, config)
      const preview = createBootScene(sourceAssets, config, { preview: true })
      assert.deepEqual(preview, { html: runtime.html, css: runtime.css })
      assert.equal(runtime.html, createBootScene(sourceAssets, { ...config, durationMs: undefined }).html)
      const doc = new JSDOM(createPreviewDocument(sourceAssets, config))
      const root = doc.window.document.querySelector('.sk-boot')
      assert.ok(createPreviewDocument(sourceAssets, config).includes(runtime.html))
      assert.equal(root.getAttribute('data-sk-wordmark'), 'false')
      assert.equal(root.getAttribute('data-sk-duration'), String(timeline))
      assert.equal(root.style.getPropertyValue('--sk-boot-time-scale'), '')
      assert.equal(root.querySelectorAll('.sk-boot-ocean__drop').length, count)
      assert.equal(root.querySelectorAll('.sk-boot-ocean__ripple').length, rippleCount)
      for (const node of root.querySelectorAll('.sk-boot-ocean__drop,.sk-boot-ocean__foam,.sk-boot-ocean__ripple,.sk-boot-ocean__shock')) {
        const delay = Number.parseFloat(node.style.getPropertyValue('--delay'))
        const duration = node.classList.contains('sk-boot-ocean__drop') ? Number.parseFloat(node.style.getPropertyValue('--dur'))
          : node.classList.contains('sk-boot-ocean__foam') ? 880 : node.classList.contains('sk-boot-ocean__ripple') ? 1500 : 1100
        assert.ok(delay + duration <= timeline + .005, `${animation}: particle tail exceeds animation duration`)
      }
      assert.ok((animation === 'water' ? 1500 : 2800) <= timeline)
      assert.equal(root.querySelectorAll('script,canvas,img,video').length, 0)
      doc.window.close()
    }
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
  assert.match(frame.getAttribute('srcdoc'), /@media \(prefers-color-scheme:\s*dark\)/)
  assert.ok(document.querySelector('.boot-preview-section').compareDocumentPosition(document.querySelector('.boot-options')) & app.dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(document.querySelectorAll('.boot-controls').length, 2)
  assert.equal(document.querySelectorAll('.boot-mode').length, 3)
  assert.equal(document.querySelectorAll('.boot-mode[aria-pressed="true"]').length, 1)
  assert.equal(document.querySelectorAll('input[type="range"],.boot-duration').length, 0)
  assert.doesNotMatch(app.text(), /最短展示|展示时间|展示时长/)
  assert.match(frame.srcdoc, /data-sk-duration="2400"/)

  const choose = async (label) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(label))
    assert.ok(button)
    await act(async () => button.click())
  }
  // An unsaved display draft must survive the volatile animation write.
  await act(async () => document.querySelector('[role="switch"][aria-label="显示文字标识"]').click())
  assert.deepEqual(writes, [])
  await choose('跃浪成标')
  assert.deepEqual(writes, [['animation', 'water']])
  assert.equal(value().animation, 'water')
  assert.equal(value().showWordmark, true)
  assert.equal(document.querySelector('[aria-label="显示文字标识"]').getAttribute('aria-checked'), 'false')
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-animation="water"/)
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-duration="2900"/)
  assert.match(document.querySelector('.boot-preview').srcdoc, /data-sk-wordmark="false"/)
  assert.match(app.text(), /已使用跃浪成标/)
  await choose('保存设置')
  assert.deepEqual(writes, [['animation', 'water'], ['showWordmark', false]])
  assert.equal(value().showWordmark, false)
  assert.match(app.text(), /设置已保存/)
  const previousFrame = document.querySelector('.boot-preview')
  await choose('重新播放')
  assert.notEqual(document.querySelector('.boot-preview'), previousFrame)
  await choose('跃浪成标')
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
  assert.doesNotMatch(app.text(), /已使用鲸跃归海/)
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
  assert.match(document.querySelector('.boot-mode[aria-pressed="true"]').textContent, /鲸跃归海/)
})

test('ocean scenes own their light/dark palette and the draw lockup stays motionless', () => {
  for (const animation of ['draw', 'water', 'abyss']) {
    for (const theme of ['light', 'dark']) {
      const dom = new JSDOM(createPreviewDocument(sourceAssets, { animation, theme }))
      const root = dom.window.document.querySelector('.sk-boot')
      const style = dom.window.getComputedStyle(root)
      if (animation === 'draw') {
        assert.equal(style.getPropertyValue('--dsh-boot-bg'), theme === 'light' ? '#f4fbfa' : '#101a1d')
        assert.equal(dom.window.document.querySelectorAll('[class*="ocean"]').length, 0)
        assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.sk-boot__lockup')).animation, '')
      } else {
        assert.equal(style.getPropertyValue('--sk-ocean-sea-deep'), theme === 'light' ? '#d2e9f3' : '#02080f')
        assert.equal(style.getPropertyValue('--sk-ocean-whale'), theme === 'light' ? '#143953' : '#eef7ff')
      }
      dom.window.close()
    }
  }
  assert.doesNotMatch(sourceAssets.css, /sk-boot-impact|sk-depth|sk-water-reflect|sk-ocean-drop-shadow|sea-sk-ocean-shine/)
})

test('reduced motion hides flight, particles and flashes while keeping the final brand readable', () => {
  const dom = new JSDOM(createPreviewDocument(sourceAssets, { animation: 'abyss', theme: 'dark' }))
  const styles = [...dom.window.document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
  const reduced = styles.filter((rule) => rule.conditionText === '(prefers-reduced-motion: reduce)').flatMap((rule) => [...rule.cssRules])
  const stop = reduced.find((rule) => rule.selectorText?.includes('.sk-boot *'))
  assert.equal(stop.style.getPropertyValue('animation'), 'none')
  assert.equal(stop.style.getPropertyPriority('animation'), 'important')
  const visible = reduced.find((rule) => rule.selectorText?.includes('.sk-boot .sk-boot__fill'))
  assert.equal(visible.style.getPropertyValue('opacity'), '1')
  assert.ok(visible.selectorText.includes('.sk-boot-ocean__wordmark'))
  const hidden = reduced.find((rule) => rule.selectorText?.includes('.sk-boot-ocean__fx'))
  assert.equal(hidden.style.getPropertyValue('display'), 'none')
  assert.ok(hidden.selectorText.includes('.sk-boot-ocean__flash'))
  assert.ok(hidden.selectorText.includes('.sk-boot-ocean__whale-track'))
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

function runBoot(t, config) {
  const scene = createBootScene(sourceAssets, config)
  const dom = new JSDOM(`<html><body><div data-dsh-boot>Host loading</div>${scene.html}</body></html>`, { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  const { window } = dom
  const root = window.document.querySelector('[data-sk-boot]')
  let now = 0
  let id = 0
  const timers = new Map()
  const observers = new Set()
  const keys = new Set()
  window.performance.now = () => now
  window.setTimeout = (callback, delay) => { const key = ++id; timers.set(key, { callback, at: now + delay }); return key }
  window.clearTimeout = (key) => timers.delete(key)
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback }
    observe() { observers.add(this) }
    disconnect() { observers.delete(this) }
  }
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  window.addEventListener = (type, callback, ...args) => { if (type === 'keydown') keys.add(callback); add(type, callback, ...args) }
  window.removeEventListener = (type, callback, ...args) => { if (type === 'keydown') keys.delete(callback); remove(type, callback, ...args) }
  window.eval(scene.script)
  return {
    window, root, timers, observers, keys,
    mutate() { for (const observer of [...observers]) observer.callback([]) },
    mount() { window.document.body.insertAdjacentHTML('beforeend', '<aside data-slot="sidebar"></aside>'); this.mutate() },
    advance(target) {
      for (let safety = 0; safety < 1000; safety++) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) { now = target; return }
        now = next[1].at
        timers.delete(next[0])
        next[1].callback()
      }
      assert.fail('boot timers did not settle')
    },
  }
}

test('runtime waits for each animation duration and real host, then clears observers, listeners and timers', (t) => {
  for (const [animation, duration] of [['draw', 2400], ['water', 2900], ['abyss', 4500]]) {
    const app = runBoot(t, { animation, durationMs: 1700 })
    app.advance(200)
    app.mount()
    app.advance(300)
    app.mutate()
    assert.equal(app.timers.size, 2, 'repeated mutations must not multiply finish timers')
    app.advance(duration)
    assert.equal(app.root.hasAttribute('data-sk-leaving'), false)
    app.advance(duration + 10)
    assert.equal(app.root.hasAttribute('data-sk-ready'), true)
    assert.equal(app.root.hasAttribute('data-sk-leaving'), true)
    assert.equal(app.observers.size, 0)
    assert.equal(app.keys.size, 0)
    assert.equal(app.timers.size, 1, 'only the bounded fade removal remains')
    app.advance(duration + 350)
    assert.equal(app.root.isConnected, false)
    assert.equal(app.timers.size, 0)
    app.advance(11000)
    assert.equal(app.window.document.documentElement.hasAttribute('data-sk-boot-bailed'), false)
  }
  const late = runBoot(t, { animation: 'abyss', durationMs: 1700 })
  late.advance(5000)
  assert.equal(late.root.hasAttribute('data-sk-leaving'), false, 'elapsed animation is not host readiness')
  late.mount()
  assert.equal(late.root.hasAttribute('data-sk-ready'), true)
  late.advance(5340)
  assert.equal(late.timers.size, 0)
})

test('runtime respects disabled skip, allows explicit skips, and restores host loading on timeout', (t) => {
  const locked = runBoot(t, { animation: 'water', allowSkip: false })
  locked.root.dispatchEvent(new locked.window.Event('pointerdown'))
  locked.window.dispatchEvent(new locked.window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(locked.root.hasAttribute('data-sk-leaving'), false)
  locked.advance(10000)
  assert.equal(locked.window.document.documentElement.hasAttribute('data-sk-boot-bailed'), true)
  assert.equal(locked.root.hasAttribute('data-sk-ready'), false)
  assert.equal(locked.observers.size, 0)
  locked.advance(10340)
  assert.equal(locked.root.isConnected, false)
  assert.equal(locked.timers.size, 0)
  assert.ok(locked.window.document.querySelector('[data-dsh-boot]'))
  for (const method of ['pointerdown', 'Escape', ' ', 'Enter']) {
    const app = runBoot(t, { animation: 'abyss', allowSkip: true })
    app.advance(100)
    if (method === 'pointerdown') app.root.dispatchEvent(new app.window.Event(method))
    else app.window.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: method }))
    assert.equal(app.root.hasAttribute('data-sk-leaving'), true)
    assert.equal(app.keys.size, 0)
    assert.equal(app.observers.size, 0)
    app.advance(440)
    assert.equal(app.root.isConnected, false)
    assert.equal(app.timers.size, 0)
  }
})

test.after(async () => { await rm(panelBundle, { force: true }) })
