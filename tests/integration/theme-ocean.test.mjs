/** The "ocean" palette scene: a self-contained decorative layer plus CSS that stays inside the palette scope. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createOceanScene } from '../../src/modules/theme/client/scenes/ocean.js'

const [sceneSource, cssSource] = await Promise.all([
  readFile(new URL('../../src/modules/theme/client/scenes/ocean.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/modules/theme/client/styles/ocean.css', import.meta.url), 'utf8'),
])

const PALETTE_SCOPE = 'html[data-sk-palette="ocean"]'
const LIGHT_TOKENS_SELECTOR = `${PALETTE_SCOPE} .sk-scene--ocean`
const DARK_TOKENS_SELECTOR = `${PALETTE_SCOPE} body[data-ds-dark-theme] .sk-scene--ocean`
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

const LAYER_ORDER = [
  'sk-ocean-sky',
  'sk-ocean-beams',
  'sk-ocean-stars',
  'sk-ocean-whale',
  'sk-ocean-waves',
  'sk-ocean-splash',
  'sk-ocean-bubbles',
  'sk-ocean-scrim',
]

const WHALE_STOP_CLASSES = [
  'sk-ocean-body-low',
  'sk-ocean-body-mid',
  'sk-ocean-body-top',
  'sk-ocean-fin-low',
  'sk-ocean-fin-top',
]

const CLASS_TOKEN = /^sk-(?:theme-scene|scene--ocean|ocean-[a-z0-9-]+)$/
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
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
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
  return selector.split(',').map((part) => part.trim()).filter(Boolean)
}

function classTokens(selector) {
  return (selector.match(/\.[A-Za-z0-9_-]+/g) ?? []).map((token) => token.slice(1))
}

function ruleSelectors(rule) {
  return selectorList(rule.selector)
}

function classesWithProperty(predicate, property) {
  const classes = new Set()
  for (const rule of stylesheet.rules) {
    if (!predicate(ruleSelectors(rule)) || !declarations(rule.body).has(property)) continue
    for (const selector of ruleSelectors(rule)) {
      for (const token of classTokens(selector)) classes.add(token)
    }
  }
  return classes
}

function customProperties(body) {
  return new Set(body.match(/--sk-ocean-[a-z0-9-]+/g) ?? [])
}

function renderedClasses(scene) {
  const classes = new Set(scene.classList)
  for (const node of scene.querySelectorAll('[class]')) {
    for (const token of node.classList) classes.add(token)
  }
  return classes
}

/* ── the scene element contract ──────────────────────────────────────── */

test('createOceanScene paints the shared theme-scene contract', (t) => {
  installDocument(t)
  const scene = createOceanScene()

  assert.equal(scene.tagName, 'DIV')
  assert.ok(scene.classList.contains('sk-theme-scene'), 'the host positions the layer via sk-theme-scene')
  assert.ok(scene.classList.contains('sk-scene--ocean'), 'the palette skin is part of the root class list')
  assert.equal(scene.dataset.skScene, 'ocean')
  assert.equal(scene.getAttribute('aria-hidden'), 'true')
  assert.equal(scene.hasAttribute('data-sk-compact'), false, 'the hero scene is not a card preview')
  assert.equal(scene.childElementCount, LAYER_ORDER.length)
})

test('createOceanScene refuses to run without a DOM document', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.throws(() => createOceanScene(), /needs a DOM document/)
})

test('layers stack bottom-up with the sea above the whale and the splash on top of it', (t) => {
  const document = installDocument(t)
  document.body.append(createOceanScene())
  const scene = document.querySelector('.sk-scene--ocean')
  const layers = [...scene.children].map((node) => node.className)

  assert.deepEqual(layers, LAYER_ORDER)
  assert.ok(layers.indexOf('sk-ocean-whale') < layers.indexOf('sk-ocean-waves'), 'waves overlap the tail')
  assert.ok(layers.indexOf('sk-ocean-waves') < layers.indexOf('sk-ocean-splash'), 'rings sit on the surface')
  assert.ok(layers.indexOf('sk-ocean-splash') < layers.indexOf('sk-ocean-scrim'), 'the scrim is the last paint')
})

test('the scene is inert: no focus targets, no interactive or embedded content', (t) => {
  const document = installDocument(t)
  const scene = createOceanScene()
  document.body.append(scene)

  assert.equal(scene.querySelectorAll('a, button, input, textarea, select, [tabindex], [contenteditable]').length, 0)
  assert.equal(scene.querySelectorAll('img, iframe, video, audio, object, embed, link, script').length, 0)
  assert.equal(scene.querySelectorAll('[href], [src]').length, 0)
  const ids = [...scene.querySelectorAll('[id]')]
  assert.equal(ids.length, 2, 'only the SVG gradients carry ids')
  for (const node of ids) assert.ok(node.closest('.sk-ocean-whale-svg'), 'ids stay inside the whale SVG')
})

test('the hero scene paints the full particle budget', (t) => {
  installDocument(t)
  const scene = createOceanScene()

  assert.equal(scene.querySelectorAll('.sk-ocean-wave').length, 3)
  assert.equal(scene.querySelectorAll('.sk-ocean-splash-ring').length, 3)
  assert.equal(scene.querySelectorAll('.sk-ocean-beam').length, 3)
  assert.equal(scene.querySelectorAll('.sk-ocean-star').length, 22)
  assert.equal(scene.querySelectorAll('.sk-ocean-bubble').length, 10)
})

test('the compact card preview paints fewer particles and marks itself', (t) => {
  installDocument(t)
  const scene = createOceanScene({ compact: true })

  assert.equal(scene.dataset.skCompact, 'true')
  assert.ok(scene.classList.contains('sk-theme-scene'))
  assert.ok(scene.classList.contains('sk-scene--ocean'))
  assert.equal(scene.getAttribute('aria-hidden'), 'true')
  assert.deepEqual([...scene.children].map((node) => node.className), LAYER_ORDER)
  assert.equal(scene.querySelectorAll('.sk-ocean-splash-ring').length, 2)
  assert.equal(scene.querySelectorAll('.sk-ocean-beam').length, 2)
  assert.equal(scene.querySelectorAll('.sk-ocean-star').length, 6)
  assert.equal(scene.querySelectorAll('.sk-ocean-bubble').length, 3)
  assert.equal(scene.querySelectorAll('.sk-ocean-wave').length, 3)
})

test('the whale is inline SVG with per-instance gradient ids and no external paint', (t) => {
  installDocument(t)
  const first = createOceanScene()
  const second = createOceanScene()
  const svg = first.querySelector('.sk-ocean-whale-svg')

  assert.ok(svg, 'the whale layer carries an SVG drawing')
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg')
  assert.equal(svg.getAttribute('viewBox'), '0 0 320 220')
  const body = svg.querySelector('.sk-ocean-whale-body')
  assert.match(body.getAttribute('d'), /^M /, 'the whale body is a hand-authored path')
  assert.equal(svg.querySelectorAll('image, use, foreignObject, pattern').length, 0)

  const idsOf = (root) => [...root.querySelectorAll('[id]')].map((node) => node.id)
  const firstIds = idsOf(first)
  const secondIds = idsOf(second)
  assert.equal(firstIds.length, 2, 'one body gradient and one fin gradient')
  assert.equal(new Set(firstIds).size, firstIds.length)
  for (const id of firstIds) assert.match(id, /^sk-ocean-(body|fin)-\d+$/)
  assert.equal(firstIds.filter((id) => secondIds.includes(id)).length, 0, 'a second instance never reuses ids')

  const references = [...svg.querySelectorAll('[fill^="url(#"]')]
    .map((node) => node.getAttribute('fill').slice('url(#'.length, -1))
  assert.ok(references.length >= 2)
  for (const id of references) assert.ok(firstIds.includes(id), `dangling gradient reference: ${id}`)
})

test('scene source fetches nothing, imports nothing, and never touches React', () => {
  assert.doesNotMatch(sceneSource, /\bfetch\s*\(/)
  assert.doesNotMatch(sceneSource, /\bXMLHttpRequest\b/)
  assert.doesNotMatch(sceneSource, /\bimport\s*\(/, 'no dynamic imports')
  assert.doesNotMatch(sceneSource, /from\s+['"]react/)
  assert.doesNotMatch(sceneSource, /React\.|__dshReact/)
  assert.doesNotMatch(
    sceneSource,
    /https?:\/\/(?!www\.w3\.org\/2000\/svg)/,
    'the only URL in the scene source is the SVG namespace',
  )
  assert.doesNotMatch(cssSource, /@import/i)
  assert.doesNotMatch(cssSource, /url\(\s*['"]?https?:/i)
  assert.doesNotMatch(sceneSource + cssSource, /77Pn0W/)
})

test('neither the markup nor the stylesheet leaks bundled or hashed class names', (t) => {
  installDocument(t)
  const scene = createOceanScene()
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

test('every stylesheet rule stays inside the ocean palette scope', () => {
  assert.equal(stylesheet.atRules.length, 0, 'only plain rules, @media and @keyframes are used')
  assert.ok(stylesheet.rules.length >= 20)
  for (const rule of stylesheet.rules) {
    assert.ok(ruleSelectors(rule).length > 0)
    for (const selector of ruleSelectors(rule)) {
      assert.ok(selector.startsWith(PALETTE_SCOPE), `unscoped selector: ${selector}`)
    }
    if (rule.media) assert.ok(rule.media.includes(REDUCED_MOTION), `unexpected media query: ${rule.media}`)
  }
  assert.doesNotMatch(cssSource, /\.sk-theme-scene/, 'the base layer geometry belongs to theme-center.css')
})

test('every keyframe is sk-ocean- prefixed and the references are a closed set', () => {
  const names = stylesheet.keyframes.map((frame) => frame.name)
  assert.ok(names.length >= 3, 'the scene animates more than one layer')
  assert.equal(new Set(names).size, names.length)
  for (const name of names) assert.match(name, /^sk-ocean-[a-z0-9-]+$/)
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
      for (const token of value.match(/sk-ocean-[a-z0-9-]+/g) ?? []) referenced.add(token)
    }
  }
  for (const name of referenced) assert.ok(names.includes(name), `missing @keyframes: ${name}`)
  for (const name of names) assert.ok(referenced.has(name), `unused @keyframes: ${name}`)
})

test('light and dark palettes declare the same token set', () => {
  const findTokens = (selector) => {
    const rule = stylesheet.rules.find((candidate) => {
      const selectors = ruleSelectors(candidate)
      return selectors.length === 1 && selectors[0] === selector
    })
    assert.ok(rule, `missing token block: ${selector}`)
    return customProperties(rule.body)
  }

  const light = findTokens(LIGHT_TOKENS_SELECTOR)
  const dark = findTokens(DARK_TOKENS_SELECTOR)
  assert.ok(light.size >= 15, 'the palette is token driven')
  assert.deepEqual([...dark].sort(), [...light].sort(), 'every light token has a dark twin')

  for (const name of light) {
    assert.match(cssSource, new RegExp(`var\\(${name}\\)`), `unused custom property: ${name}`)
  }
})

test('both themes override the whale gradient stops and the ink', () => {
  // Composite selectors also name the layers above the stops; only the stop
  // classes themselves are expected to be repainted here.
  const stopClasses = (classes) => [...classes].filter((token) => /^sk-ocean-(?:body|fin)-(?:top|mid|low)$/.test(token))
  const lightStops = stopClasses(classesWithProperty((selectors) => selectors.every((selector) => !selector.includes('data-ds-dark-theme')), 'stop-color'))
  const darkStops = stopClasses(classesWithProperty((selectors) => selectors.every((selector) => selector.includes('data-ds-dark-theme')), 'stop-color'))

  assert.deepEqual([...lightStops].sort(), WHALE_STOP_CLASSES)
  assert.deepEqual([...darkStops].sort(), WHALE_STOP_CLASSES)
  assert.match(cssSource, /body\[data-ds-dark-theme\]/)
})

test('reduced motion freezes every animation and parks the whale in a static pose', () => {
  const frozen = stylesheet.rules.filter((rule) => rule.media.includes(REDUCED_MOTION))
  assert.ok(frozen.length >= 3, 'the reduce block covers the scene, the splash and the whale')

  const animated = frozen.filter((rule) => declarations(rule.body).get('animation')?.includes('none'))
  assert.ok(animated.length >= 1)
  const covered = animated.flatMap((rule) => ruleSelectors(rule))
  for (const selector of [LIGHT_TOKENS_SELECTOR, `${PALETTE_SCOPE} .sk-scene--ocean *`, `${PALETTE_SCOPE} .sk-scene--ocean *::before`, `${PALETTE_SCOPE} .sk-scene--ocean *::after`]) {
    assert.ok(covered.includes(selector), `reduced motion must stop: ${selector}`)
  }
  for (const rule of animated) {
    assert.match(declarations(rule.body).get('animation'), /none\s*!important/)
    assert.match(declarations(rule.body).get('transition'), /none\s*!important/)
  }

  const splash = frozen.find((rule) => ruleSelectors(rule).some((selector) => selector.endsWith('.sk-ocean-splash')))
  assert.ok(splash, 'the splash rings keep a static footprint under reduced motion')
  assert.match(declarations(splash.body).get('opacity'), /^0?\.\d+$/)

  const whale = frozen.find((rule) => ruleSelectors(rule).some((selector) => selector.endsWith('.sk-ocean-whale')))
  assert.ok(whale, 'the whale keeps its breach angle under reduced motion')
  assert.match(declarations(whale.body).get('transform'), /rotate\(-?\d+deg\)/)
})

test('every class the stylesheet paints is rendered by the scene', (t) => {
  installDocument(t)
  const scene = createOceanScene()
  const rendered = renderedClasses(scene)
  const painted = new Set()
  for (const rule of stylesheet.rules) {
    for (const selector of ruleSelectors(rule)) {
      for (const token of classTokens(selector)) painted.add(token)
    }
  }

  for (const token of painted) assert.ok(rendered.has(token), `CSS paints a class the scene never renders: ${token}`)
})

test('two scenes stay independent when appended side by side', (t) => {
  const document = installDocument(t)
  const hero = createOceanScene()
  const card = createOceanScene({ compact: true })
  document.body.append(hero, card)

  assert.equal(document.querySelectorAll('.sk-scene--ocean').length, 2)
  assert.equal(hero.querySelectorAll('.sk-ocean-star').length, 22)
  assert.equal(card.querySelectorAll('.sk-ocean-star').length, 6)
  const classNames = (root) => [...root.children].map((node) => node.className)
  assert.deepEqual(classNames(hero), classNames(card), 'both sizes share the same layer stack')
})
