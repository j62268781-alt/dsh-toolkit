/**
 * Theme center contract: the palette is plugin config (codex/ocean/hope), the
 * native Light/Dark/System preference stays untouched, and animated scenes are
 * mounted only inside the main empty-conversation hero.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { Config, PALETTES, readThemeConfig } from '../../src/modules/theme/host/config.js'
import {
  HERO_SELECTOR,
  PALETTE_ATTR,
  applyPalette,
  clearPaletteScenes,
  createPaletteScene,
  installPalette,
  mountPaletteScene,
  readPalette,
  registerPaletteScene,
} from '../../src/modules/theme/client/palette.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function fakeForm(palette = 'codex') {
  let snapshot = { palette }
  const listeners = new Set()
  return {
    writable: true,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    write(next) {
      snapshot = { palette: next }
      for (const listener of listeners) listener(snapshot)
    },
  }
}

function sceneBuilder(palette) {
  return ({ compact = false } = {}) => {
    const el = globalThis.document.createElement('div')
    el.className = `sk-theme-scene sk-scene--${palette}`
    el.dataset.skScene = palette
    el.dataset.compact = compact ? 'yes' : 'no'
    return el
  }
}

function heroPage(t) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div data-slot="main.conversation">
      <div data-phase="hero">
        <div data-conversation-content data-content-phase="hero"><p>empty</p></div>
      </div>
    </div>
    <div data-slot="main.conversation">
      <div data-phase="active">
        <div data-conversation-content data-content-phase="active"><p>chat</p></div>
      </div>
    </div>
    <div data-slot="rightbar">
      <div data-phase="hero">
        <div data-conversation-content data-content-phase="hero"><p>side</p></div>
      </div>
    </div>
  </body></html>`)
  const original = new Map()
  for (const name of ['window', 'document', 'MutationObserver', 'Element', 'Node']) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] })
  }
  t.after(() => {
    dom.window.close()
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return { window: dom.window, document: dom.window.document }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 15))

test('theme host config keeps the palette a volatile, clamped enum', () => {
  assert.deepEqual([...PALETTES], ['codex', 'ocean', 'hope'])
  const parsed = Config({})
  const field = parsed.palette
  assert.equal(typeof field?.get, 'function')
  assert.equal(readThemeConfig(parsed).palette, 'codex')
  assert.equal(readThemeConfig(Config({ palette: 'hope' })).palette, 'hope')
  assert.throws(() => Config({ palette: 'nope' }), /palette/)
  assert.equal(readThemeConfig({ palette: { get: () => 'bogus' } }).palette, 'codex')
  assert.equal(readThemeConfig({ palette: { get: () => 'ocean' } }).palette, 'ocean')
  assert.equal(readThemeConfig(undefined).palette, 'codex')
  // A volatile leaf exposes a write hook symbol so the Host entry is reused.
  const symbols = Object.getOwnPropertySymbols(field)
  assert.ok(symbols.length > 0)
})

test('readPalette accepts snapshots and clamps unknown values', () => {
  assert.equal(readPalette(fakeForm('ocean')), 'ocean')
  assert.equal(readPalette({ getSnapshot: () => ({ value: { palette: 'hope' } }) }), 'hope')
  assert.equal(readPalette({ getSnapshot: () => ({ palette: 'nope' }) }), 'codex')
  assert.equal(readPalette(null), 'codex')
})

test('applyPalette marks only animated palettes', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const root = dom.window.document.documentElement
  applyPalette('ocean', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'ocean')
  applyPalette('hope', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'hope')
  applyPalette('codex', root)
  assert.equal(root.hasAttribute(PALETTE_ATTR), false)
  dom.window.close()
})

test('mountPaletteScene inserts first and swaps builders', (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  registerPaletteScene('hope', sceneBuilder('hope'))
  const hero = document.querySelector(HERO_SELECTOR)
  assert.ok(hero)

  const ocean = mountPaletteScene(hero, 'ocean')
  assert.equal(hero.firstElementChild, ocean)
  assert.equal(hero.querySelectorAll('.sk-theme-scene').length, 1)

  const hope = mountPaletteScene(hero, 'hope', { compact: true })
  assert.equal(hero.querySelectorAll('.sk-theme-scene').length, 1)
  assert.equal(hope.dataset.skScene, 'hope')
  assert.equal(hope.dataset.compact, 'yes')
  assert.equal(createPaletteScene('codex'), null)
  clearPaletteScenes(document)
  assert.equal(hero.querySelectorAll('.sk-theme-scene').length, 0)
})

test('installPalette mounts scenes only in the main empty-conversation hero', async (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  registerPaletteScene('hope', sceneBuilder('hope'))
  const form = fakeForm('ocean')
  const dispose = installPalette({}, { form, document, root: document.documentElement })

  const mainHero = document.querySelector(
    '[data-slot="main.conversation"] > [data-phase="hero"] > [data-conversation-content][data-content-phase="hero"]',
  )
  const activeHero = document.querySelector('[data-phase="active"] [data-content-phase="active"]')
  const sideHero = document.querySelector('[data-slot="rightbar"] [data-content-phase="hero"]')
  await flush()

  assert.equal(document.documentElement.getAttribute(PALETTE_ATTR), 'ocean')
  assert.equal(mainHero.querySelectorAll('.sk-theme-scene').length, 1)
  assert.equal(activeHero.querySelectorAll('.sk-theme-scene').length, 0)
  assert.equal(sideHero.querySelectorAll('.sk-theme-scene').length, 0)

  form.write('hope')
  await flush()
  assert.equal(mainHero.querySelectorAll('.sk-theme-scene').length, 1)
  assert.equal(mainHero.querySelector('.sk-theme-scene').dataset.skScene, 'hope')
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 1)

  form.write('codex')
  await flush()
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 0)
  assert.equal(document.documentElement.hasAttribute(PALETTE_ATTR), false)

  form.write('ocean')
  await flush()
  const again = document.createElement('span')
  again.className = 'sk-theme-scene'
  // A stray/duplicated scene from a re-render is reconciled back to one.
  mainHero.append(again)
  await flush()
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 1)

  // Leaving the empty hero (conversation becomes active) removes the art.
  mainHero.closest('[data-phase]').setAttribute('data-phase', 'active')
  mainHero.setAttribute('data-content-phase', 'active')
  await flush()
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 0)

  dispose()
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 0)
  assert.equal(document.documentElement.hasAttribute(PALETTE_ATTR), false)
})

test('theme center CSS and selector keep the hero scoping and visual states', async () => {
  const css = await readFile(`${ROOT}src/modules/theme/client/styles/theme-center.css`, 'utf8')
  const palette = await readFile(`${ROOT}src/modules/theme/client/palette.js`, 'utf8')
  const panel = await readFile(`${ROOT}src/modules/theme/client/settings-theme.jsx`, 'utf8')

  assert.match(palette, /\[data-slot="main\.conversation"\] > \[data-phase="hero"\] > \[data-conversation-content\]\[data-content-phase="hero"\]/)
  assert.match(css, /\.sk-theme-card\.is-selected \.sk-theme-card__art/)
  assert.match(css, /sk-theme-preview-window/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /z-index: -1/)
  assert.match(css, /html\[data-sk-palette="ocean"\]/)
  assert.match(css, /html\[data-sk-palette="hope"\]/)
  assert.doesNotMatch(css, /class\*="_[A-Za-z0-9]{5,}_/)
  assert.match(panel, /全部主题/)
  assert.match(panel, /浅色/)
  assert.match(panel, /深色/)
  assert.match(panel, /跟随系统/)
  assert.match(panel, /大海蓝鲸/)
  assert.match(panel, /希望红/)
  assert.match(panel, /敬请期待/)
})
