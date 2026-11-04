/**
 * The Codex settings shell must bind to structure, not to build-specific CSS
 * module hashes, and its Windows titlebar band must stay clear of the native
 * caption buttons. These tests pin the selectors used against the installed
 * app's real markup (checked 2026-11-04 against app.asar, hash `_AnXs9G_`).
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { installSettingsNav } from '../../src/modules/theme/client/settings-nav.js'
import { createSettingsMotion } from '../../src/modules/theme/client/settings-motion.js'

const THEME_CLIENT = fileURLToPath(new URL('../../src/modules/theme/client/', import.meta.url))

function page(t, html) {
  const dom = new JSDOM(html)
  const original = new Map()
  const cleanup = []
  const slotListeners = new Set()
  const localeListeners = new Set()
  const entries = [{ options: { id: 'account', order: 0, label: '账号与余额' } }]
  const ctx = {
    slots: {
      entries(name) { return name === 'settings.section' ? entries : [] },
      subscribe(name, listener) {
        if (name !== 'settings.section') return () => {}
        slotListeners.add(listener)
        return () => slotListeners.delete(listener)
      },
    },
    locale: { subscribe(listener) { localeListeners.add(listener); return () => localeListeners.delete(listener) } },
  }
  const values = {
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
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
    window: dom.window,
    document: dom.window.document,
    ctx,
    onCleanup(dispose) { cleanup.push(dispose) },
    async flush() {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

/** The installed app's dialog, including its current CSS module prefix. */
const WINDOWS_HTML = `<html data-windows-titlebar><body>
  <div class="_AnXs9G_overlay" role="presentation">
    <div class="_AnXs9G_mask" aria-hidden="true"></div>
    <div class="_AnXs9G_panel" data-shortcut-modal="settings" role="dialog" aria-modal="true"
         aria-labelledby="settings-title" tabindex="-1">
      <nav class="_AnXs9G_nav">
        <div class="_AnXs9G_navTitle" id="settings-title">设置</div>
        <div class="_AnXs9G_navList">
          <button class="_AnXs9G_navCell _AnXs9G_active" aria-current="page">账号与余额</button>
          <button class="_AnXs9G_navCell">Skills &amp; MCP</button>
        </div>
      </nav>
      <div class="_AnXs9G_content">
        <div class="_AnXs9G_header"><button class="_AnXs9G_close" aria-label="关闭">×</button></div>
        <div class="_AnXs9G_options"><section>账号</section></div>
      </div>
    </div>
  </div>
</body></html>`

const SHELL = ':is([role="presentation"]:has(> [data-shortcut-modal="settings"]), [data-sk-settings-overlay])'

test('settings shell binds to the current native dialog by structure and keeps Windows band clear', async (t) => {
  const { document, ctx, flush, onCleanup } = page(t, WINDOWS_HTML)
  const overlay = document.querySelector('[role="presentation"]')
  const panel = document.querySelector('[data-shortcut-modal="settings"]')
  const nav = panel.querySelector('nav')
  const dispose = installSettingsNav(ctx)
  onCleanup(dispose)
  await flush()

  assert.equal(document.querySelector(SHELL), overlay, 'the installed dialog is the settings overlay')
  assert.equal(overlay.querySelector(':scope > [aria-hidden="true"]'), overlay.querySelector('._AnXs9G_mask'))
  assert.ok(overlay.hasAttribute('data-sk-settings-overlay'), 'the shell marker is installed on the portal root')
  assert.ok(panel.hasAttribute('data-sk-settings-toolbar'))
  assert.equal(nav.firstElementChild, nav.querySelector('[data-sk-setnav]'), 'navigation block still precedes native rows')
  assert.equal(panel.querySelector('.sk-setnav__back').parentElement, panel)
  // Content column keeps matching the suffix-based native selectors.
  assert.equal(panel.querySelector('._AnXs9G_content').matches('[class*="_content"]'), true)
  assert.ok(document.querySelector('._AnXs9G_header').matches('[class*="_header"]'))

  // A future build renaming its hash must still work: only structure is used.
  const renamed = document.createElement('div')
  renamed.innerHTML = WINDOWS_HTML.slice(WINDOWS_HTML.indexOf('<div class="_AnXs9G_overlay"'))
  renamed.querySelectorAll('[class]').forEach((node) => node.setAttribute('class', node.className.replaceAll('_AnXs9G_', '_qZ42_')))

  dispose()
  assert.equal(document.querySelector('[data-sk-settings-overlay]'), null, 'teardown clears the shell marker')
  assert.equal(document.querySelector('[data-sk-settings-toolbar]'), null)
  document.body.replaceChildren(renamed.firstElementChild)
  await flush()

  const installAgain = installSettingsNav(ctx)
  onCleanup(installAgain)
  await flush()
  assert.ok(document.querySelector('[data-sk-settings-overlay]'), 'renamed module hashes do not affect the shell')
  installAgain()
})

test('a nested nav wrapper is not mistaken for the native navigation', async (t) => {
  const { document, ctx, flush } = page(t, `<html><body>
    <div role="presentation">
      <div data-shortcut-modal="settings" role="dialog">
        <div class="wrapper"><nav><button class="_x_navCell">nested</button></nav></div>
      </div>
    </div>
  </body></html>`)
  const dispose = installSettingsNav(ctx)
  await flush()
  assert.equal(document.querySelector('[data-sk-setnav]'), null, 'only a direct nav child is the settings navigation')
  assert.equal(document.querySelector('[data-sk-settings-toolbar]'), null)
  dispose()
})

test('settings header action is discovered without matching a module hash', async (t) => {
  const { document, ctx, flush } = page(t, `<html><body>
    <div role="presentation">
      <div data-shortcut-modal="settings" role="dialog">
        <nav><div class="_x_navList"></div></nav>
        <div class="_y_content"><div class="_z_header"><div class="_w_actions">
          <div class="anything"><button>打开配置文件</button></div>
        </div></div></div>
      </div>
    </div>
  </body></html>`)
  const dispose = installSettingsNav(ctx)
  await flush()
  assert.equal(document.querySelector('.sk-setnav__more').hidden, false, 'the action button is projected into the titlebar')
  assert.ok(document.querySelector('.anything').hasAttribute('data-sk-config-original'))
  dispose()
  assert.equal(document.querySelector('.anything').hasAttribute('data-sk-config-original'), false,
    'the native action is restored on teardown')
})

test('settings exit copy keeps the shell marker after native markers are stripped', async (t) => {
  const { window, document } = page(t, WINDOWS_HTML)
  const overlay = document.querySelector('[role="presentation"]')
  const panel = document.querySelector('[data-shortcut-modal="settings"]')
  const animations = []
  const fake = () => ({ cancel() {}, finished: new Promise(() => {}), onfinish: null, oncancel: null })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  const proto = window.Element.prototype
  const base = proto.animate
  proto.animate = function (...args) {
    const animation = base ? base.apply(this, args) : fake()
    animations.push({ node: this, animation })
    return animation
  }
  overlay.animate = function () { const animation = fake(); animations.push({ node: this, animation }); return animation }
  t.after(() => { proto.animate = base })
  const motion = createSettingsMotion()

  motion.enter(panel)
  assert.equal(animations[0]?.node, overlay, 'entrance animates the portal root')

  // The native dialog is removed before React runs its exit path.
  overlay.remove()
  motion.leave(panel)
  const copy = document.querySelector('[data-sk-settings-exit]')
  assert.ok(copy, 'an inert copy animates out')
  assert.equal(copy.matches(SHELL), true, 'the copy still matches the settings shell')
  assert.ok(copy.querySelector('[data-sk-settings-snapshot]'), 'the panel copy keeps its shell snapshot marker')
  assert.equal(copy.querySelector('[data-shortcut-modal="settings"]'), null, 'native modal markers are stripped')
  assert.equal(copy.getAttribute('role'), null)
  motion.dispose()
  assert.equal(document.querySelector('[data-sk-settings-exit]'), null, 'dispose removes a pending copy')
})

test('theme shell CSS uses structural selectors and reserves the Windows caption band', async () => {
  const css = await readFile(join(THEME_CLIENT, 'styles/settings-shell.css'), 'utf8')
  assert.match(css, /\[role="presentation"\]:has\(> \[data-shortcut-modal="settings"\]\)/)
  assert.match(css, /\[data-shortcut-modal="settings"\]/)
  assert.match(css, /\[aria-hidden="true"\]/)
  assert.match(css, /--sk-settings-band-h:\s*max\(32px, var\(--cx-band-h, 0px\), var\(--dsh-frame-chrome-top, var\(--dsh-frame-top-clearance, 0px\)\)\)/)
  assert.match(css, /html\[data-windows-titlebar\]\s*\{\s*--sk-wco-width:\s*138px;/)
  assert.match(css, /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.sk-setnav__more\s*\{[^}]*right:\s*calc\(var\(--sk-wco-width\) \+ 12px\)/)
  assert.match(css, /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.sk-setnav__actions\s*\{[^}]*top:\s*calc\(var\(--sk-settings-band-h\) \+ 4px\)/)

  // Build hashes are never stable across releases; no theme source may select on them.
  const offenders = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(path); continue }
      if (!/\.(css|js|jsx|mjs)$/.test(entry.name)) continue
      const text = await readFile(path, 'utf8')
      if (/class\*="_[A-Za-z0-9]{5,}_/.test(text)) offenders.push(path)
    }
  }
  await walk(THEME_CLIENT)
  assert.deepEqual(offenders, [], 'theme sources must not select CSS module hashes')
})
