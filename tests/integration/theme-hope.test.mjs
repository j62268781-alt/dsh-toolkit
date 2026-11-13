import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, test } from 'node:test'
import { JSDOM } from 'jsdom'

import { createHopeScene, updateHopeSceneTime } from '../../src/modules/theme/client/scenes/hope.ts'

const SCENE_URL = new URL('../../src/modules/theme/client/scenes/hope.ts', import.meta.url)
const CSS_URL = new URL('../../src/modules/theme/client/styles/hope.css', import.meta.url)
const SCOPE = 'html[data-sk-palette="hope"]'
const PREVIEW_SCOPE = '[data-preview-palette="hope"]'
const SCENE_SCOPE = '.sk-scene--hope'

const sceneSource = await readFile(SCENE_URL, 'utf8')
const sceneCss = await readFile(CSS_URL, 'utf8')

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const { document } = dom.window
let scene

before(() => {
  globalThis.document = document
})

after(() => {
  delete globalThis.document
  dom.window.close()
})

/** Small CSS reader: top-level rules, @keyframes and @media blocks (media recursed). */
function parseCss(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const keyframes = []
  const media = []
  let index = 0
  while (index < text.length) {
    const open = text.indexOf('{', index)
    if (open === -1) break
    const prelude = text.slice(index, open).trim()
    let depth = 1
    let cursor = open + 1
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === '{') depth += 1
      else if (text[cursor] === '}') depth -= 1
      cursor += 1
    }
    const body = text.slice(open + 1, cursor - 1)
    if (!prelude) {
      // Stray block; keep scanning.
    } else if (prelude.startsWith('@keyframes')) {
      keyframes.push({ name: prelude.slice('@keyframes'.length).trim(), body })
    } else if (prelude.startsWith('@media')) {
      media.push({ query: prelude.slice('@media'.length).trim(), css: body })
      const nested = parseCss(body)
      rules.push(...nested.rules)
      keyframes.push(...nested.keyframes)
      media.push(...nested.media)
    } else if (prelude.startsWith('@')) {
      media.push({ query: prelude, css: body })
    } else {
      rules.push({ selector: prelude, body })
    }
    index = cursor
  }
  return { rules, keyframes, media }
}

function selectorsOf(rule) {
  const selectors = []
  const text = rule.selector
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (character === ',' && depth === 0) {
      selectors.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  selectors.push(text.slice(start).trim())
  return selectors.filter(Boolean)
}

function declarationsOf(body) {
  const declarations = []
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const property = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (property) declarations.push({ property, value })
  }
  return declarations
}

function tokensOf(body) {
  const tokens = new Map()
  for (const { property, value } of declarationsOf(body)) {
    if (property.startsWith('--sk-hope-')) tokens.set(property, value)
  }
  return tokens
}

function sceneTokenSets() {
  const light = parsed.rules.find((rule) => rule.selector.trim() === SCENE_SCOPE)
  const dark = parsed.rules.find((rule) => selectorsOf(rule).some((selector) => (
    selector.startsWith('body[data-ds-dark-theme]') && selector.includes(SCENE_SCOPE)
  )))
  assert.ok(light, 'missing default scene tokens')
  assert.ok(dark, 'missing dark scene tokens')
  return { light: tokensOf(light.body), dark: tokensOf(dark.body) }
}

const parsed = parseCss(sceneCss)
const CLASS_TOKEN = /^(sk-theme-scene|sk-scene--hope|sk-hope-[a-z0-9-]+)$/

describe('hope scene', () => {
  test('retains native DSH geometry and needs no Codex tokens', () => {
    assert.doesNotMatch(sceneCss, /--cx-/)
    assert.doesNotMatch(sceneCss, /--dsw-radius-[\w-]+\s*:/)
  })

  test('local time selects dawn, day, dusk and a fully starry night', () => {
    for (const [hour, phase] of [[6, 'dawn'], [12, 'day'], [18, 'dusk'], [23, 'night'], [0, 'night']]) {
      const timed = createHopeScene({ now: new Date(2026, 10, 5, hour) })
      assert.equal(timed.dataset.skTimePhase, phase)
      const night = Number(timed.style.getPropertyValue('--sk-hope-night'))
      assert.ok(night >= 0 && night <= 1)
      if (phase === 'night') {
        assert.equal(night, 1)
        assert.equal(timed.style.getPropertyValue('--sk-hope-solar-opacity'), '0')
      }
      if (phase === 'day') assert.equal(night, 0)
    }
  })

  test('refresh moves the sun and sky in place after sleep without changing sibling scenes', () => {
    const morning = new Date(2026, 10, 5, 6)
    const noon = new Date(2026, 10, 5, 12)
    const timed = createHopeScene({ now: morning })
    const sibling = createHopeScene({ compact: true, now: morning })
    const siblingStyle = sibling.style.cssText
    const sun = timed.querySelector('.sk-hope-sun')
    const oldX = Number.parseFloat(timed.style.getPropertyValue('--sk-hope-solar-x'))
    const oldY = Number.parseFloat(timed.style.getPropertyValue('--sk-hope-solar-y'))
    const oldSky = timed.style.getPropertyValue('--sk-hope-time-top')
    assert.equal(updateHopeSceneTime(timed, noon), timed)
    assert.equal(timed.querySelector('.sk-hope-sun'), sun)
    assert.ok(Number.parseFloat(timed.style.getPropertyValue('--sk-hope-solar-x')) > oldX)
    assert.ok(Number.parseFloat(timed.style.getPropertyValue('--sk-hope-solar-y')) < oldY)
    assert.notEqual(timed.style.getPropertyValue('--sk-hope-time-top'), oldSky)
    assert.equal(sibling.style.cssText, siblingStyle)
    assert.equal(sibling.dataset.skTimePhase, 'dawn')
  })

  test('midnight wraps continuously and card night stars use a reduced budget', () => {
    const timed = createHopeScene({ now: new Date(2026, 10, 5, 23, 59, 59) })
    const sky = timed.style.getPropertyValue('--sk-hope-time-top')
    updateHopeSceneTime(timed, new Date(2026, 10, 6, 0, 0, 0))
    assert.equal(timed.style.getPropertyValue('--sk-hope-time-top'), sky)
    assert.equal(timed.style.getPropertyValue('--sk-hope-night'), '1.000')
    assert.equal(timed.querySelectorAll('.sk-hope-star').length, 100)
    const compact = createHopeScene({ compact: true, now: new Date(2026, 10, 6, 0) })
    assert.equal(compact.querySelectorAll('.sk-hope-star').length, 32)
    assert.ok(compact.querySelector('.sk-hope-moon'))
    assert.equal(compact.querySelectorAll('.sk-hope-ridge').length, 3)
  })

  test('exports a decorative element matching the palette contract', () => {
    scene = createHopeScene()
    assert.ok(scene instanceof dom.window.HTMLElement)
    assert.equal(scene.tagName, 'DIV')
    assert.ok(scene.classList.contains('sk-theme-scene'))
    assert.ok(scene.classList.contains('sk-scene--hope'))
    assert.equal(scene.dataset.skScene, 'hope')
    assert.equal(scene.getAttribute('aria-hidden'), 'true')
    assert.equal(scene.querySelectorAll('[aria-hidden="false"]').length, 0)
    assert.equal(scene.dataset.skCompact, undefined)
    // The factory only builds a detached tree; palette.js mounts it.
    assert.equal(document.body.childElementCount, 0)
  })

  test('paints the dawn layer stack: sky, rays, horizon, sun, embers, scrim', () => {
    const sky = scene.querySelector('.sk-hope-sky')
    const dawn = scene.querySelector('.sk-hope-dawn')
    const rays = scene.querySelector('.sk-hope-rays')
    const horizon = scene.querySelector('.sk-hope-horizon')
    const sun = scene.querySelector('.sk-hope-sun')
    const embers = scene.querySelector('.sk-hope-embers')
    const scrim = scene.querySelector('.sk-hope-scrim')

    for (const layer of [sky, dawn, rays, horizon, sun, embers, scrim]) {
      assert.ok(layer, 'expected every dawn layer to exist')
    }
    assert.equal(scene.firstElementChild, sky)
    assert.equal(scene.lastElementChild, scrim)
    // Layer order: embers above the sun, scrim above everything.
    const children = [...scene.children]
    assert.deepEqual(
      children.map((child) => child.getAttribute('class')),
      [
        'sk-hope-sky',
        'sk-hope-dawn',
        'sk-hope-night',
        'sk-hope-clouds',
        'sk-hope-rays',
        'sk-hope-horizon',
        'sk-hope-sun',
        'sk-hope-landscape',
        'sk-hope-embers',
        'sk-hope-scrim',
      ],
    )
  })

  test('draws the radial beams as inline SVG with a unique gradient id', () => {
    const rays = scene.querySelector('.sk-hope-rays')
    assert.ok(rays instanceof dom.window.SVGElement)
    assert.equal(rays.tagName.toLowerCase(), 'svg')
    assert.equal(rays.getAttribute('viewBox'), '0 0 1000 640')
    assert.equal(rays.getAttribute('preserveAspectRatio'), 'none')
    assert.equal(rays.getAttribute('aria-hidden'), 'true')
    assert.equal(rays.getAttribute('focusable'), 'false')

    const gradient = rays.querySelector('radialGradient')
    assert.ok(gradient)
    assert.ok(gradient.id.startsWith('sk-hope-ray-'))
    assert.equal(rays.querySelectorAll('stop').length, 3)

    const beams = rays.querySelectorAll('.sk-hope-beam')
    assert.equal(beams.length, 23)
    for (const beam of beams) {
      assert.equal(beam.tagName.toLowerCase(), 'path')
      assert.match(beam.getAttribute('d'), /^M [\d.]+ [\d.]+ L /)
      assert.match(beam.getAttribute('fill'), /^url\(#sk-hope-ray-\d+\)$/)
      assert.ok(Number(beam.getAttribute('opacity')) > 0)
    }

    const other = createHopeScene()
    const otherGradient = other.querySelector('radialGradient')
    assert.notEqual(otherGradient.id, gradient.id)
  })

  test('builds the sun, horizon and embers from plain DOM nodes', () => {
    const sun = scene.querySelector('.sk-hope-sun')
    assert.ok(sun.querySelector('.sk-hope-sun-halo'))
    assert.ok(sun.querySelector('.sk-hope-sun-core'))

    const horizon = scene.querySelector('.sk-hope-horizon')
    assert.ok(horizon.querySelector('.sk-hope-horizon-glow'))
    assert.ok(horizon.querySelector('.sk-hope-horizon-line'))

    const embers = [...scene.querySelectorAll('.sk-hope-ember')]
    assert.equal(embers.length, 20)
    for (const ember of embers) {
      assert.ok(Number.parseFloat(ember.style.getPropertyValue('--sk-hope-ember-size')) > 0)
      assert.ok(Number.parseFloat(ember.style.getPropertyValue('--sk-hope-ember-rise')) > 0)
      assert.ok(ember.style.animationDuration.endsWith('s'))
      assert.ok(ember.style.animationDelay.endsWith('s'))
    }
  })

  test('compact paints the sparser card preview with the same structure', () => {
    const card = createHopeScene({ compact: true })
    assert.equal(card.dataset.skCompact, 'true')
    assert.ok(card.classList.contains('sk-scene--hope'))
    assert.ok(card.querySelector('.sk-hope-sun'))
    assert.ok(card.querySelector('.sk-hope-scrim'))

    assert.equal(card.querySelectorAll('.sk-hope-beam').length, 12)
    assert.ok(card.querySelectorAll('.sk-hope-beam').length < scene.querySelectorAll('.sk-hope-beam').length)
    assert.equal(card.querySelectorAll('.sk-hope-ember').length, 6)
    assert.ok(card.querySelectorAll('.sk-hope-ember').length < scene.querySelectorAll('.sk-hope-ember').length)
    assert.equal(card.children.length, scene.children.length)

    // Deterministic scatter: the same seed paints the same embers on every mount.
    const cardStyles = [...card.querySelectorAll('.sk-hope-ember')].map((ember) => ember.style.cssText)
    const again = createHopeScene({ compact: true })
    assert.deepEqual(
      [...again.querySelectorAll('.sk-hope-ember')].map((ember) => ember.style.cssText),
      cardStyles,
    )
  })

  test('stays self-contained: no external assets, no scripts, no React', () => {
    assert.equal(scene.querySelectorAll('a, button, input, textarea, select, [tabindex], [contenteditable]').length, 0)
    assert.equal(scene.querySelectorAll('img, script, link, iframe, object, embed, video, audio, canvas').length, 0)
    for (const node of [scene, ...scene.querySelectorAll('*')]) {
      for (const attribute of node.attributes) {
        if (/^(src|href|srcset|xlink:href)$/i.test(attribute.name)) {
          assert.doesNotMatch(attribute.value, /^https?:/i, `unexpected external ${attribute.name}`)
        }
      }
    }
    assert.doesNotMatch(scene.outerHTML, /https?:/i)

    assert.doesNotMatch(sceneSource, /\bfetch\s*\(/)
    assert.doesNotMatch(sceneSource, /\bXMLHttpRequest\b/)
    assert.doesNotMatch(sceneSource, /\bReact\b/)
    assert.doesNotMatch(sceneSource, /\bimport\s*\(/)
    assert.doesNotMatch(sceneSource, /\bdocument\.write\b/)
    const urls = sceneSource.match(/https?:\/\/[^\s'"`]+/g) ?? []
    for (const url of urls) {
      assert.ok(url.startsWith('http://www.w3.org/2000/svg'), `unexpected asset URL ${url}`)
    }
  })

  test('every class name is a stable hand-written sk- token', () => {
    for (const node of [scene, ...scene.querySelectorAll('*')]) {
      const classes = node.getAttribute('class')
      if (!classes) continue
      for (const token of classes.split(/\s+/).filter(Boolean)) {
        assert.match(token, CLASS_TOKEN, `unhashed class expected, got ${token}`)
      }
    }
    assert.doesNotMatch(sceneCss, /\._[a-zA-Z0-9_-]+/)
  })
})

describe('hope stylesheet', () => {
  test('scene, selected-pack shell and local preview rules keep their own scopes', () => {
    assert.ok(parsed.rules.length >= 20, 'expected a full layer sheet')
    const scopes = new Set()
    for (const rule of parsed.rules) {
      for (const selector of selectorsOf(rule)) {
        const classes = (selector.match(/\.[A-Za-z0-9_-]+/g) ?? []).map((token) => token.slice(1))
        if (classes.some((token) => token === 'sk-scene--hope' || token.startsWith('sk-hope-'))) {
          scopes.add('scene')
          assert.ok(classes.includes('sk-scene--hope'), `artwork escapes its scene: ${selector}`)
          assert.doesNotMatch(selector, /data-sk-palette|data-preview-palette/, 'unselected scenes must still paint')
        } else if (selector.includes(PREVIEW_SCOPE)) {
          scopes.add('preview')
          assert.match(selector.slice(0, selector.indexOf(PREVIEW_SCOPE)), /^(?:\.[A-Za-z0-9_-]+)?$/, `preview scope must be local: ${selector}`)
          assert.doesNotMatch(selector, /data-sk-palette/)
        } else {
          scopes.add('shell')
          assert.ok(selector.startsWith(SCOPE), `unscoped shell selector: ${selector}`)
        }
      }
    }
    assert.deepEqual([...scopes].sort(), ['preview', 'scene', 'shell'])
    assert.doesNotMatch(sceneCss, /@import\b/)
    assert.doesNotMatch(sceneCss, /url\(\s*['"]?https?:/i)
  })

  test('declares prefixed, motion-only keyframes that every animation references', () => {
    assert.ok(parsed.keyframes.length >= 3)
    const defined = new Set(parsed.keyframes.map((keyframe) => keyframe.name))
    for (const keyframe of parsed.keyframes) {
      assert.match(keyframe.name, /^sk-hope-[a-z0-9-]+$/, `unprefixed keyframes ${keyframe.name}`)
      const stops = [...keyframe.body.matchAll(/{([^{}]*)}/g)]
      assert.ok(stops.length >= 2, `${keyframe.name} needs at least two stops`)
      for (const [, declarations] of stops) {
        for (const { property } of declarationsOf(declarations)) {
          assert.ok(property === 'transform' || property === 'opacity', `${keyframe.name} animates ${property}`)
        }
      }
    }

    const used = new Set()
    for (const rule of parsed.rules) {
      for (const { property, value } of declarationsOf(rule.body)) {
        if (property !== 'animation' && property !== 'animation-name') continue
        for (const name of value.match(/sk-hope-[a-z0-9-]+/g) ?? []) used.add(name)
      }
    }
    assert.ok(used.size >= 3, 'expected the sheet to drive the keyframes')
    for (const name of used) assert.ok(defined.has(name), `animation ${name} has no @keyframes`)
  })

  test('freezes every loop under prefers-reduced-motion: reduce', () => {
    const reduced = parsed.media.filter(({ query }) => /prefers-reduced-motion:\s*reduce/.test(query))
    assert.equal(reduced.length, 1)
    assert.match(reduced[0].css, /animation:\s*none\s*!important/)
    assert.match(reduced[0].css, /transition:\s*none\s*!important/)
    assert.match(reduced[0].css, /\.sk-scene--hope \*/)
  })

  test('ships matched light and dark token sets on the scene root', () => {
    const { light, dark } = sceneTokenSets()
    assert.ok(light.size >= 15, 'expected a complete light token set')
    assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort())
    // Light is warm and bright; dark turns deep red with golden edges.
    for (const name of ['--sk-hope-sky-top', '--sk-hope-sun-core', '--sk-hope-ember']) {
      assert.notEqual(light.get(name), dark.get(name), `${name} must adapt to dark mode`)
    }
  })

  test('scene tokens honor body and preview brightness in all 18 selected-style combinations', (t) => {
    const style = document.createElement('style')
    style.textContent = sceneCss
    document.head.append(style)
    t.after(() => {
      style.remove()
      document.body.replaceChildren()
      document.body.removeAttribute('data-ds-dark-theme')
      delete document.documentElement.dataset.skPalette
    })
    const tokens = sceneTokenSets()
    let combinations = 0

    for (const bodyDark of [false, true]) {
      document.body.toggleAttribute('data-ds-dark-theme', bodyDark)
      for (const previewMode of [null, 'light', 'dark']) {
        for (const selected of ['codex', 'ocean', 'hope']) {
          document.documentElement.dataset.skPalette = selected
          const preview = document.createElement('div')
          if (previewMode) {
            preview.dataset.previewMode = previewMode
            preview.dataset.previewPalette = 'hope'
          }
          const scene = createHopeScene({ compact: previewMode !== null })
          preview.append(scene)
          document.body.replaceChildren(preview)

          const expected = tokens[previewMode === 'dark' || (previewMode === null && bodyDark) ? 'dark' : 'light']
          const computed = dom.window.getComputedStyle(scene)
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

  test('keeps the card preview readable at thumbnail size', () => {
    const compactRules = parsed.rules.filter((rule) => rule.selector.includes('[data-sk-compact="true"]'))
    assert.ok(compactRules.length >= 3, 'expected compact overrides')
    const sunRule = compactRules.find((rule) => /\.sk-hope-sun\b/.test(rule.selector))
    assert.ok(sunRule)
    assert.match(sunRule.body, /width:\s*min\(/)
    assert.match(sunRule.body, /animation-duration:/)
    const raysRule = compactRules.find((rule) => /\.sk-hope-rays\b/.test(rule.selector))
    assert.ok(raysRule)
    assert.match(raysRule.body, /opacity:/)
  })
})
