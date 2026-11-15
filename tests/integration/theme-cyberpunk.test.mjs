/** The "cyberpunk" palette scene: the Night City key art as a still, self-contained
 *  backdrop plus CSS that stays inside the palette scope. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createCyberpunkScene } from '../../src/modules/theme/client/scenes/cyberpunk.ts'

const [sceneSource, cssSource] = await Promise.all([
  readFile(new URL('../../src/modules/theme/client/scenes/cyberpunk.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../src/modules/theme/client/styles/cyberpunk.css', import.meta.url), 'utf8'),
])

const PALETTE_SCOPE = 'html[data-sk-palette="cyberpunk"]'
const PREVIEW_SCOPE = '[data-preview-palette="cyberpunk"]'
const SCENE_SCOPE = '.sk-scene--cyberpunk'
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

const LAYER_ORDER = [
  'sk-cyberpunk-art',
  'sk-cyberpunk-glow',
  'sk-cyberpunk-scrim',
]

const CLASS_TOKEN = /^sk-(?:theme-scene|scene--cyberpunk|cyberpunk-[a-z0-9-]+)$/
const HASHED_CLASS = /^_[A-Za-z0-9]{5,}_/

function installDocument(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const originals = new Map()
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    dom.window.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return dom.window.document
}

/* ── a tiny CSS reader: enough to inspect this stylesheet without a dependency ── */

function readBlockEnd(css, open) {
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') depth -= 1
    if (depth === 0 && css[index] === '}') return index
  }
  throw new Error('unbalanced CSS block')
}

function parseStylesheet(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const keyframes = []
  const mediaQueries = []
  const atRules = []
  walk(0, css.length, '')
  return { rules, keyframes, mediaQueries, atRules }

  function walk(from, to, media) {
    let index = from
    while (index < to) {
      const open = css.indexOf('{', index)
      if (open === -1 || open >= to) return
      const prelude = css.slice(index, open).trim()
      const close = readBlockEnd(css, open)
      const body = css.slice(open + 1, close)
      if (prelude.startsWith('@keyframes')) {
        keyframes.push({ name: prelude.slice('@keyframes'.length).trim(), body, media })
      } else if (prelude.startsWith('@media')) {
        mediaQueries.push(prelude)
        walk(open + 1, close, prelude)
      } else if (prelude.startsWith('@')) {
        atRules.push({ prelude, body, media })
      } else {
        rules.push({ selector: prelude, body, media })
      }
      index = close + 1
    }
  }
}

const stylesheet = parseStylesheet(cssSource)

function declarations(body) {
  const map = new Map()
  for (const chunk of body.split(';')) {
    const text = chunk.trim()
    if (!text) continue
    const colon = text.indexOf(':')
    if (colon === -1) continue
    map.set(text.slice(0, colon).trim().toLowerCase(), text.slice(colon + 1).trim())
  }
  return map
}

function selectorList(selector) {
  const selectors = []
  let depth = 0
  let start = 0
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]
    if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (character === ',' && depth === 0) {
      selectors.push(selector.slice(start, index).trim())
      start = index + 1
    }
  }
  selectors.push(selector.slice(start).trim())
  return selectors.filter(Boolean)
}

function classTokens(selector) {
  return (selector.match(/\.[A-Za-z0-9_-]+/g) ?? []).map((token) => token.slice(1))
}

function ruleSelectors(rule) {
  return selectorList(rule.selector)
}

function sceneTokenSets() {
  const light = stylesheet.rules.find((rule) => rule.selector.trim() === SCENE_SCOPE)
  const dark = stylesheet.rules.find((rule) => ruleSelectors(rule).some((selector) => (
    selector.startsWith('body[data-ds-dark-theme]') && classTokens(selector).includes('sk-scene--cyberpunk')
  )))
  assert.ok(light, 'missing default scene tokens')
  assert.ok(dark, 'missing dark scene tokens')
  const tokens = (rule) => new Map([...declarations(rule.body)].filter(([name]) => name.startsWith('--sk-cyberpunk-')))
  return { light: tokens(light), dark: tokens(dark) }
}

function renderedClasses(scene) {
  const classes = new Set(scene.classList)
  for (const node of scene.querySelectorAll('[class]')) {
    for (const token of node.classList) classes.add(token)
  }
  return classes
}

/* ── the scene element contract ──────────────────────────────────────── */

test('cyberpunk retains native DSH geometry and needs no Codex tokens', () => {
  assert.doesNotMatch(cssSource, /--cx-/)
  assert.doesNotMatch(cssSource, /--dsw-radius-[\w-]+\s*:/)
})

test('createCyberpunkScene paints the shared theme-scene contract', (t) => {
  installDocument(t)
  const scene = createCyberpunkScene()

  assert.equal(scene.tagName, 'DIV')
  assert.ok(scene.classList.contains('sk-theme-scene'), 'the host positions the layer via sk-theme-scene')
  assert.ok(scene.classList.contains('sk-scene--cyberpunk'), 'the palette skin is part of the root class list')
  assert.equal(scene.dataset.skScene, 'cyberpunk')
  assert.equal(scene.getAttribute('aria-hidden'), 'true')
  assert.equal(scene.hasAttribute('data-sk-compact'), false, 'the hero scene is not a card preview')
  assert.equal(scene.childElementCount, LAYER_ORDER.length)
})

test('createCyberpunkScene refuses to run without a DOM document', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.throws(() => createCyberpunkScene(), /needs a DOM document/)
})

test('layers stack bottom-up: artwork, glow, then the scrim on top', (t) => {
  const document = installDocument(t)
  document.body.append(createCyberpunkScene())
  const scene = document.querySelector('.sk-scene--cyberpunk')
  const layers = [...scene.children].map((node) => node.className)

  assert.deepEqual(layers, LAYER_ORDER)
  assert.equal(layers[0], 'sk-cyberpunk-art')
  assert.equal(layers[layers.length - 1], 'sk-cyberpunk-scrim', 'the scrim is the last paint')
})

test('the scene is inert: no focus targets, no interactive or embedded content', (t) => {
  const document = installDocument(t)
  const scene = createCyberpunkScene()
  document.body.append(scene)

  assert.equal(scene.querySelectorAll('a, button, input, textarea, select, [tabindex], [contenteditable]').length, 0)
  assert.equal(scene.querySelectorAll('img, iframe, video, audio, object, embed, link, script').length, 0)
  assert.equal(scene.querySelectorAll('[href], [src]').length, 0)
  assert.equal(scene.querySelectorAll('[id]').length, 0, 'no id collisions across mounted scenes')
})

test('paints the approved art as an inlined background, never an <img>', (t) => {
  installDocument(t)
  const scene = createCyberpunkScene()
  const art = scene.querySelector('.sk-cyberpunk-art')
  const image = scene.style.getPropertyValue('--sk-cyberpunk-art-image')

  assert.ok(art, 'expected the artwork layer')
  assert.match(image, /^url\("data:image\/webp;base64,/, 'the art resolves to a local data URI')
  assert.ok(image.length > 20_000, 'the inlined art should carry the real artwork, not a stub')
  assert.equal(scene.querySelectorAll('img').length, 0)
  assert.equal(scene.querySelectorAll('[src]').length, 0)
})

test('the compact card preview keeps the same structure and marks itself', (t) => {
  installDocument(t)
  const card = createCyberpunkScene({ compact: true })

  assert.equal(card.dataset.skCompact, 'true')
  assert.ok(card.classList.contains('sk-scene--cyberpunk'))
  assert.deepEqual([...card.children].map((node) => node.className), LAYER_ORDER)
  assert.match(card.style.getPropertyValue('--sk-cyberpunk-art-image'), /^url\("data:image\/webp;base64,/)
})

test('two scenes stay independent when appended side by side', (t) => {
  const document = installDocument(t)
  const hero = createCyberpunkScene()
  const card = createCyberpunkScene({ compact: true })
  document.body.append(hero, card)

  assert.equal(document.querySelectorAll('.sk-scene--cyberpunk').length, 2)
  assert.notEqual(hero.style.getPropertyValue('--sk-cyberpunk-art-image'), '')
  assert.notEqual(card.style.getPropertyValue('--sk-cyberpunk-art-image'), '')
  assert.notEqual(hero.dataset.skCompact, card.dataset.skCompact)
})

/* ── source hygiene ──────────────────────────────────────────────────── */

test('scene source fetches nothing, imports nothing but the bundled art, and ships no URL', () => {
  assert.doesNotMatch(sceneSource, /\bfetch\s*\(/)
  assert.doesNotMatch(sceneSource, /\bXMLHttpRequest\b/)
  assert.doesNotMatch(sceneSource, /\bimport\s*\(/, 'no dynamic imports')
  assert.doesNotMatch(sceneSource, /from\s+['"]react/)
  assert.doesNotMatch(sceneSource, /React\.|__dshReact/)
  assert.doesNotMatch(sceneSource, /\bdocument\.write\b/)
  assert.match(sceneSource, /from\s+'\.\.\/assets\/cyberpunk-art\.webp'/, 'the art is a local bundled asset')
  assert.doesNotMatch(
    sceneSource,
    /https?:\/\/(?!www\.w3\.org\/2000\/svg)/,
    'no remote URL in the scene source',
  )
  assert.doesNotMatch(cssSource, /@import/i)
  assert.doesNotMatch(cssSource, /url\(\s*['"]?https?:/i)
})

test('neither the markup nor the stylesheet leaks bundled or hashed class names', (t) => {
  installDocument(t)
  const scene = createCyberpunkScene()
  const classes = renderedClasses(scene)

  for (const token of classes) {
    assert.match(token, CLASS_TOKEN, `unexpected class name: ${token}`)
    assert.doesNotMatch(token, HASHED_CLASS)
  }
  for (const rule of stylesheet.rules) {
    for (const token of classTokens(rule.selector)) assert.doesNotMatch(token, HASHED_CLASS)
  }
  assert.doesNotMatch(cssSource, /\.[a-z]+__[A-Za-z0-9]/i, 'no CSS-module style names')
})

test('scene, selected-pack shell and local preview rules keep their own scopes', () => {
  assert.equal(stylesheet.atRules.length, 0, 'only plain rules, @media and @keyframes are used')
  assert.ok(stylesheet.rules.length >= 12)
  const scopes = new Set()
  for (const rule of stylesheet.rules) {
    assert.ok(ruleSelectors(rule).length > 0)
    for (const selector of ruleSelectors(rule)) {
      const classes = classTokens(selector)
      if (classes.some((token) => token === 'sk-scene--cyberpunk' || token.startsWith('sk-cyberpunk-'))) {
        scopes.add('scene')
        assert.ok(classes.includes('sk-scene--cyberpunk'), `artwork escapes its scene: ${selector}`)
        assert.doesNotMatch(selector, /data-sk-palette|data-preview-palette/, 'unselected scenes must still paint')
      } else if (selector.includes(PREVIEW_SCOPE)) {
        scopes.add('preview')
        assert.match(selector.slice(0, selector.indexOf(PREVIEW_SCOPE)), /^(?:\.[A-Za-z0-9_-]+)?$/, `preview scope must be local: ${selector}`)
        assert.doesNotMatch(selector, /data-sk-palette/)
      } else {
        scopes.add('shell')
        assert.ok(selector.startsWith(PALETTE_SCOPE), `unscoped shell selector: ${selector}`)
      }
    }
    if (rule.media) assert.ok(rule.media.includes(REDUCED_MOTION), `unexpected media query: ${rule.media}`)
  }
  assert.deepEqual([...scopes].sort(), ['preview', 'scene', 'shell'])
  assert.doesNotMatch(cssSource, /\.sk-theme-scene/, 'the base layer geometry belongs to theme-center.css')
})

test('every keyframe is sk-cyberpunk- prefixed and the references are a closed set', () => {
  const names = stylesheet.keyframes.map((frame) => frame.name)
  assert.ok(names.length >= 2, 'the art and the glow both breathe')
  assert.equal(new Set(names).size, names.length)
  for (const name of names) assert.match(name, /^sk-cyberpunk-[a-z0-9-]+$/, `unprefixed keyframes ${name}`)
  for (const frame of stylesheet.keyframes) {
    assert.equal(frame.media, '', 'keyframes are declared once at the top level')
    assert.ok(declarations(frame.body).size > 0)
  }

  const referenced = new Set()
  for (const rule of stylesheet.rules) {
    const body = declarations(rule.body)
    for (const property of ['animation', 'animation-name']) {
      const value = body.get(property)
      if (!value) continue
      for (const token of value.match(/sk-cyberpunk-[a-z0-9-]+/g) ?? []) referenced.add(token)
    }
  }
  for (const name of referenced) assert.ok(names.includes(name), `missing @keyframes: ${name}`)
  for (const name of names) assert.ok(referenced.has(name), `unused @keyframes: ${name}`)
})

test('light and dark palettes declare the same token set', () => {
  const { light, dark } = sceneTokenSets()
  assert.ok(light.size >= 5, 'the palette is token driven')
  assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort(), 'every light token has a dark twin')

  for (const name of light.keys()) {
    assert.match(cssSource, new RegExp(`var\\(${name}\\)`), `unused custom property: ${name}`)
  }
  // Brightness adaptation lives in the veil, the glow and the art dimmer.
  for (const name of ['--sk-cyberpunk-art-dim', '--sk-cyberpunk-glow', '--sk-cyberpunk-scrim', '--sk-cyberpunk-art-y']) {
    assert.notEqual(light.get(name), dark.get(name), `${name} must adapt to dark mode`)
  }
})

test('scene tokens honor body and preview brightness in all 18 selected-style combinations', (t) => {
  const document = installDocument(t)
  const style = document.createElement('style')
  style.textContent = cssSource
  document.head.append(style)
  const tokens = sceneTokenSets()
  let combinations = 0

  for (const bodyDark of [false, true]) {
    document.body.toggleAttribute('data-ds-dark-theme', bodyDark)
    for (const previewMode of [null, 'light', 'dark']) {
      for (const selected of ['codex', 'ocean', 'sunset']) {
        document.documentElement.dataset.skPalette = selected
        const preview = document.createElement('div')
        if (previewMode) {
          preview.dataset.previewMode = previewMode
          preview.dataset.previewPalette = 'cyberpunk'
        }
        const scene = createCyberpunkScene({ compact: previewMode !== null })
        preview.append(scene)
        document.body.replaceChildren(preview)

        const expected = tokens[previewMode === 'dark' || (previewMode === null && bodyDark) ? 'dark' : 'light']
        const computed = document.defaultView.getComputedStyle(scene)
        const context = `body=${bodyDark ? 'dark' : 'light'}, preview=${previewMode ?? 'none'}, selected=${selected}`
        for (const [name, value] of expected) {
          // CSSOM removes optional whitespace around the alpha separator.
          const actual = computed.getPropertyValue(name).trim().replace(/\s*\/\s*/g, '/')
          assert.equal(actual, value.replace(/\s*\/\s*/g, '/'), `${context}: ${name}`)
        }
        combinations += 1
      }
    }
  }
  assert.equal(combinations, 18)
})

test('reduced motion freezes every animation and parks the art in a static pose', () => {
  const frozen = stylesheet.rules.filter((rule) => rule.media.includes(REDUCED_MOTION))
  assert.ok(frozen.length >= 2, 'the reduce block covers the scene and the art layer')

  const animated = frozen.filter((rule) => declarations(rule.body).get('animation')?.includes('none'))
  assert.ok(animated.length >= 1)
  const covered = animated.flatMap((rule) => ruleSelectors(rule))
  for (const selector of [SCENE_SCOPE, `${SCENE_SCOPE} *`, `${SCENE_SCOPE} *::before`, `${SCENE_SCOPE} *::after`]) {
    assert.ok(covered.includes(selector), `reduced motion must stop: ${selector}`)
  }
  for (const rule of animated) {
    assert.match(declarations(rule.body).get('animation'), /none\s*!important/)
    assert.match(declarations(rule.body).get('transition'), /none\s*!important/)
  }

  const art = frozen.find((rule) => ruleSelectors(rule).some((selector) => selector.endsWith('.sk-cyberpunk-art')))
  assert.ok(art, 'the artwork keeps a static framing under reduced motion')
  assert.match(declarations(art.body).get('transform'), /scale\(/)
})

test('every class the scene rules paint is rendered by the scene', (t) => {
  installDocument(t)
  const scene = createCyberpunkScene()
  const rendered = renderedClasses(scene)
  const painted = new Set()
  for (const rule of stylesheet.rules) {
    for (const selector of ruleSelectors(rule)) {
      if (!classTokens(selector).includes('sk-scene--cyberpunk')) continue
      for (const token of classTokens(selector)) painted.add(token)
    }
  }

  for (const token of painted) assert.ok(rendered.has(token), `CSS paints a class the scene never renders: ${token}`)
})
