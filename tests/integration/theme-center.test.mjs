/**
 * Theme center contract: the palette is plugin config (codex/ocean/sunset/cyberpunk), the
 * native Light/Dark/System preference stays untouched, and animated scenes are
 * mounted only inside the main empty-conversation hero.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { Config, PALETTES, readThemeConfig } from '../../src/modules/theme/host/config.ts'
import {
  HERO_SELECTOR,
  PALETTE_ATTR,
  SCENE_LIFT_VAR,
  applyPalette,
  clearPaletteScenes,
  createPaletteScene,
  installPalette,
  installSceneClock,
  mountPaletteScene,
  readPalette,
  registerPaletteScene,
} from '../../src/modules/theme/client/palette.ts'

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

test('one scene clock refreshes every mounted time scene and disposes cleanly', () => {
  const calls = []
  const scenes = [{ id: 'hero' }, { id: 'preview' }, { id: 'card' }]
  const listeners = new Map()
  const date = new Date('2026-11-05T06:30:00')
  let tick
  let cleared
  const doc = {
    hidden: false,
    querySelectorAll: selector => selector === '.sk-scene--sunset' ? scenes : [],
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name) },
  }
  const clock = {
    setInterval(callback, ms) { assert.equal(ms, 60_000); tick = callback; return 42 },
    clearInterval: handle => { cleared = handle },
  }
  const stop = installSceneClock((scene, now) => calls.push([scene.id, now]), { document: doc, clock, now: () => date })
  assert.deepEqual(calls.map(([id]) => id), ['hero', 'preview', 'card'])
  assert.ok(calls.every(([, now]) => now === date))
  doc.hidden = true
  tick()
  assert.equal(calls.length, 3)
  doc.hidden = false
  listeners.get('visibilitychange')()
  assert.equal(calls.length, 6)
  stop()
  tick()
  assert.equal(calls.length, 6)
  assert.equal(cleared, 42)
  assert.equal(listeners.size, 0)
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 15))

test('theme host config keeps the palette a volatile, clamped enum', () => {
  assert.deepEqual([...PALETTES], ['native', 'codex', 'ocean', 'sunset', 'cyberpunk'])
  const parsed = Config({})
  const field = parsed.palette
  assert.equal(typeof field?.get, 'function')
  assert.equal(readThemeConfig(parsed).palette, 'native')
  assert.equal(readThemeConfig(Config({ palette: 'sunset' })).palette, 'sunset')
  assert.throws(() => Config({ palette: 'nope' }), /palette/)
  assert.equal(readThemeConfig({ palette: { get: () => 'bogus' } }).palette, 'native')
  assert.equal(readThemeConfig({ palette: { get: () => 'ocean' } }).palette, 'ocean')
  assert.equal(readThemeConfig(undefined).palette, 'native')
  // A volatile leaf exposes a write hook symbol so the Host entry is reused.
  const symbols = Object.getOwnPropertySymbols(field)
  assert.ok(symbols.length > 0)
})

test('readPalette accepts snapshots and clamps unknown values', () => {
  assert.equal(readPalette(fakeForm('ocean')), 'ocean')
  assert.equal(readPalette({ getSnapshot: () => ({ value: { palette: 'sunset' } }) }), 'sunset')
  assert.equal(readPalette({ getSnapshot: () => ({ palette: 'nope' }) }), 'native')
  assert.equal(readPalette(null), 'native')
})

test('applyPalette marks every style explicitly and clamps invalid values', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const root = dom.window.document.documentElement
  applyPalette('ocean', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'ocean')
  applyPalette('sunset', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'sunset')
  applyPalette('codex', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'codex')
  applyPalette('native', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'native')
  applyPalette('invalid', root)
  assert.equal(root.getAttribute(PALETTE_ATTR), 'native')
  dom.window.close()
})

test('mountPaletteScene inserts first and swaps builders', (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  registerPaletteScene('sunset', sceneBuilder('sunset'))
  const hero = document.querySelector(HERO_SELECTOR)
  assert.ok(hero)

  const ocean = mountPaletteScene(hero, 'ocean')
  assert.equal(hero.firstElementChild, ocean)
  assert.equal(hero.querySelectorAll('.sk-theme-scene').length, 1)

  const swapped = mountPaletteScene(hero, 'sunset', { compact: true })
  assert.equal(hero.querySelectorAll('.sk-theme-scene').length, 1)
  assert.equal(swapped.dataset.skScene, 'sunset')
  assert.equal(swapped.dataset.compact, 'yes')
  assert.equal(createPaletteScene('codex'), null)
  clearPaletteScenes(document)
  assert.equal(hero.querySelectorAll('.sk-theme-scene').length, 0)
})

test('the hero scene is lifted by the blank header row above it', async (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  const hero = document.querySelector(HERO_SELECTOR)
  assert.ok(hero)
  const column = hero.parentElement

  // jsdom measures everything as 0; the host really leaves a 30px header row above the hero.
  assert.equal(mountPaletteScene(hero, 'ocean').style.getPropertyValue(SCENE_LIFT_VAR), '0px')
  hero.getBoundingClientRect = () => ({ top: 30 })
  column.getBoundingClientRect = () => ({ top: 0 })
  const lifted = mountPaletteScene(hero, 'ocean')
  assert.equal(lifted.style.getPropertyValue(SCENE_LIFT_VAR), '30px')

  // A scene that already exists is re-measured when the layout moves under it.
  column.getBoundingClientRect = () => ({ top: 10 })
  const form = fakeForm('ocean')
  const view = new EventTarget()
  const dispose = installPalette({}, { form, document, root: document.documentElement, view })
  assert.equal(lifted.style.getPropertyValue(SCENE_LIFT_VAR), '20px')

  // Resizing fires no attribute mutation, so the resize listener is what keeps a narrower
  // window (where the host trades the blank row for a titled one) from going stale.
  column.getBoundingClientRect = () => ({ top: 0 })
  hero.getBoundingClientRect = () => ({ top: 42 })
  view.dispatchEvent(new Event('resize'))
  await flush()
  assert.equal(lifted.style.getPropertyValue(SCENE_LIFT_VAR), '42px')
  dispose()
})

test('installPalette mounts scenes only in the main empty-conversation hero', async (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  registerPaletteScene('sunset', sceneBuilder('sunset'))
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

  form.write('sunset')
  await flush()
  assert.equal(mainHero.querySelectorAll('.sk-theme-scene').length, 1)
  assert.equal(mainHero.querySelector('.sk-theme-scene').dataset.skScene, 'sunset')
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 1)

  form.write('codex')
  await flush()
  assert.equal(document.querySelectorAll('.sk-theme-scene').length, 0)
  assert.equal(document.documentElement.getAttribute(PALETTE_ATTR), 'codex')

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

test('hero lifecycle preserves settings preview scenes through active chats and teardown', async (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  registerPaletteScene('sunset', sceneBuilder('sunset'))
  const previews = document.createElement('section')
  previews.className = 'sk-theme-page'
  const previewScene = createPaletteScene('sunset', { compact: true })
  previews.append(previewScene)
  document.body.append(previews)
  const hero = document.querySelector(HERO_SELECTOR)
  const form = fakeForm('ocean')
  const dispose = installPalette({}, { form, document })
  await flush()
  assert.equal(previewScene.isConnected, true)
  assert.equal(hero.querySelector('.sk-theme-scene')?.dataset.skScene, 'ocean')

  hero.closest('[data-phase]').setAttribute('data-phase', 'active')
  hero.setAttribute('data-content-phase', 'active')
  await flush()
  assert.equal(hero.querySelector('.sk-theme-scene'), null)
  assert.equal(previewScene.isConnected, true)

  // A later settings render while no hero exists must retain its own scenes.
  const anotherPreview = createPaletteScene('ocean', { compact: true })
  previews.append(anotherPreview)
  await flush()
  assert.equal(anotherPreview.isConnected, true)

  hero.closest('[data-phase]').setAttribute('data-phase', 'hero')
  hero.setAttribute('data-content-phase', 'hero')
  await flush()
  form.write('sunset') // Queued render must not run after disposal.
  dispose()
  await flush()
  assert.equal(hero.querySelector('.sk-theme-scene'), null)
  assert.equal(previews.querySelectorAll('.sk-theme-scene').length, 2)
  assert.equal(document.documentElement.hasAttribute(PALETTE_ATTR), false)
})

test('theme center CSS and selector keep the hero scoping and visual states', async () => {
  const css = await readFile(`${ROOT}src/modules/theme/client/styles/theme-center.css`, 'utf8')
  const palette = await readFile(`${ROOT}src/modules/theme/client/palette.ts`, 'utf8')
  const panel = await readFile(`${ROOT}src/modules/theme/client/settings-theme.tsx`, 'utf8')

  assert.match(palette, /\[data-slot="main\.conversation"\] > \[data-phase="hero"\] > \[data-conversation-content\]\[data-content-phase="hero"\]/)
  assert.match(panel, /OptionCard/)
  assert.doesNotMatch(css, /\.sk-theme-card\s*\{/)
  assert.match(css, /sk-theme-preview-window/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /z-index: -1/)
  assert.match(css, /top: calc\(-1 \* var\(--sk-hero-lift, 0px\)\)/)
  assert.match(css, /\[data-slot="conversation\.header"\] > header/)
  assert.match(css, /\[data-slot="conversation\.header"\] > header button \{/)
  assert.match(css, /color: var\(--sk-hero-fg\)/)
  assert.match(css, /drop-shadow\(0 0 1\.5px var\(--sk-hero-halo, rgb\(0 0 0 \/ 0\.4\)\)\)/)
  // Windows paints the caption buttons from the Desktop preload's hidden probe span.
  assert.match(css, /body > span\[style\*="--dsw-specific-sidebar-fill"\]/)
  assert.match(css, /color: var\(--sk-caption-fg\) !important/)
  assert.match(palette, /SCENE_LIFT_VAR/)
  assert.match(css, /html\[data-sk-palette="ocean"\]/)
  assert.match(css, /html\[data-sk-palette="sunset"\]/)
  assert.match(css, /html\[data-sk-palette="cyberpunk"\]/)
  assert.doesNotMatch(css, /class\*="_[A-Za-z0-9]{5,}_/)
  assert.match(panel, /aria-label="颜色模式"/)
  assert.match(panel, /aria-label="主题风格"/)
  assert.match(panel, /浅色/)
  assert.match(panel, /深色/)
  assert.match(panel, /跟随系统/)
  assert.match(panel, /大海蓝鲸/)
  assert.match(panel, /夕阳红/)
  assert.match(panel, /赛博朋克2077/)
  assert.doesNotMatch(panel, /敬请期待/)
})

// 宿主把 --dsw-alias-* / --dsw-specific-* 声明在 body 上（design-platform.css），
// 自定义属性按最近祖先继承：同一名字写在 html 上会被 body 遮蔽，主题包当时就是
// 这样丢了侧栏、标题条、气泡与状态条的底色。这条断言把「必须写在 body」钉住。
const HOST_SURFACE_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-input-major',
  '--dsw-specific-selector',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-markdown-code-block',
]

test('pack colours for host-owned surfaces are declared on body, never on html', async () => {
  for (const pack of ['ocean', 'sunset', 'cyberpunk']) {
    const css = await readFile(`${ROOT}src/modules/theme/client/styles/${pack}.css`, 'utf8')
    for (const token of HOST_SURFACE_TOKENS) {
      const declarations = [...css.matchAll(new RegExp(`${token}\\s*:`, 'g'))]
      assert.ok(declarations.length > 0, `${pack} declares ${token}`)
      for (const { index } of declarations) {
        const selector = blockSelector(css, index)
        assert.match(selector, /\bbody\b/, `${pack}: ${token} must sit on a body rule (got "${selector}")`)
      }
    }
  }
})

test('every pack hands the hero header row a foreground that reads on its own sky', async () => {
  for (const pack of ['ocean', 'sunset', 'cyberpunk']) {
    const css = await readFile(`${ROOT}src/modules/theme/client/styles/${pack}.css`, 'utf8')
    const foreground = [...css.matchAll(/--sk-hero-fg\s*:\s*([^;]+);/g)]
    assert.equal(foreground.length, 2, `${pack} declares one hero foreground per brightness`)
    for (const { index } of foreground) {
      const selector = blockSelector(css, index)
      assert.match(selector, /\bbody\b/, `${pack}: --sk-hero-fg must sit on a body rule (got "${selector}")`)
    }
    // The header row is outside the scene element, so the token has to reach it by inheritance.
    assert.notEqual(foreground[0][1].trim(), foreground[1][1].trim(), `${pack}: the dark sky needs its own tone`)

    const halo = [...css.matchAll(/--sk-hero-halo\s*:\s*([^;]+);/g)]
    assert.ok(halo.length >= 1, `${pack} keeps the glyph legible on a bright patch of its art`)
    for (const { index } of halo) {
      const selector = blockSelector(css, index)
      assert.match(selector, /\bbody\b/, `${pack}: --sk-hero-halo must sit on a body rule (got "${selector}")`)
    }
  }
})

// Windows 自己画标题栏右侧那三个按钮，颜色由 Desktop preload 探测一个隐藏 span 得来，
// 探测的是 --dsw-specific-sidebar-fill 与宿主的 label-primary。主题包只能给一个色调：
// 若某个包漏了 --sk-caption-fg，按钮会退回宿主近黑色，与浅色侧栏/深色侧栏都不搭。
test('every pack tints the native caption glyphs to its own strip', async () => {
  for (const pack of ['ocean', 'sunset', 'cyberpunk']) {
    const css = await readFile(`${ROOT}src/modules/theme/client/styles/${pack}.css`, 'utf8')
    const caption = [...css.matchAll(/--sk-caption-fg\s*:\s*([^;]+);/g)]
    assert.equal(caption.length, 2, `${pack} declares one caption tone per brightness`)
    for (const { index } of caption) {
      const selector = blockSelector(css, index)
      assert.match(selector, /\bbody\b/, `${pack}: --sk-caption-fg must sit on a body rule (got "${selector}")`)
    }
    assert.notEqual(caption[0][1].trim(), caption[1][1].trim(), `${pack}: the dark strip needs its own tone`)
  }
})

test('a palette switch asks the Desktop shell to re-read the caption colours', async (t) => {
  const { document } = heroPage(t)
  registerPaletteScene('ocean', sceneBuilder('ocean'))
  const form = fakeForm('ocean')
  const dispose = installPalette({}, { form, document, root: document.documentElement })
  const tick = () => document.body.style.getPropertyValue('--sk-palette-tick')

  // The preload only re-probes on a body style (or dark-mode) change, and none happens when
  // the palette just rewrites html[data-sk-palette] — so the first paint nudges it once.
  const first = tick()
  assert.notEqual(first, '')

  form.write('sunset')
  await flush()
  const second = tick()
  assert.notEqual(second, first)

  // Re-rendering the same palette must not keep touching the host DOM.
  form.write('sunset')
  await flush()
  assert.equal(tick(), second)
  dispose()
})

/** 从一条声明回溯到包住它的那条规则的头部；往后跳过的 `}` 说明是在外层块里。 */
function blockSelector(css, index) {
  let cursor = index
  let depth = 0
  while (cursor >= 0) {
    const char = css[cursor]
    if (char === '}') depth += 1
    else if (char === '{') {
      if (depth === 0) break
      depth -= 1
    }
    cursor -= 1
  }
  const head = Math.max(css.lastIndexOf('{', cursor - 1), css.lastIndexOf('}', cursor - 1)) + 1
  return css.slice(head, cursor).trim()
}
