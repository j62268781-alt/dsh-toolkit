import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, test } from 'node:test'
import { JSDOM } from 'jsdom'

import { createCyberpunkScene } from '../../src/modules/theme/client/scenes/cyberpunk.ts'

const SCENE_URL = new URL('../../src/modules/theme/client/scenes/cyberpunk.ts', import.meta.url)
const CSS_URL = new URL('../../src/modules/theme/client/styles/cyberpunk.css', import.meta.url)
const SCOPE = 'html[data-sk-palette="cyberpunk"]'
const PREVIEW_SCOPE = '[data-preview-palette="cyberpunk"]'
const SCENE_SCOPE = '.sk-scene--cyberpunk'

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
    if (property.startsWith('--sk-cyberpunk-')) tokens.set(property, value)
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
const CLASS_TOKEN = /^(sk-theme-scene|sk-scene--cyberpunk|sk-cyberpunk-[a-z0-9-]+)$/
const LAYER_ORDER = [
  'sk-cyberpunk-sky',
  'sk-cyberpunk-glow',
  'sk-cyberpunk-city',
  'sk-cyberpunk-signs',
  'sk-cyberpunk-rain',
  'sk-cyberpunk-street',
  'sk-cyberpunk-rider',
  'sk-cyberpunk-lights',
  'sk-cyberpunk-scan',
  'sk-cyberpunk-scrim',
]

describe('cyberpunk scene', () => {
  test('retains native DSH geometry and needs no Codex tokens', () => {
    assert.doesNotMatch(sceneCss, /--cx-/)
    assert.doesNotMatch(sceneCss, /--dsw-radius-[\w-]+\s*:/)
  })

  test('exports a decorative element matching the palette contract', () => {
    scene = createCyberpunkScene()
    assert.ok(scene instanceof dom.window.HTMLElement)
    assert.equal(scene.tagName, 'DIV')
    assert.ok(scene.classList.contains('sk-theme-scene'))
    assert.ok(scene.classList.contains('sk-scene--cyberpunk'))
    assert.equal(scene.dataset.skScene, 'cyberpunk')
    assert.equal(scene.getAttribute('aria-hidden'), 'true')
    assert.equal(scene.querySelectorAll('[aria-hidden="false"]').length, 0)
    assert.equal(scene.dataset.skCompact, undefined)
    assert.equal(document.body.childElementCount, 0)
  })

  test('paints the neon layer stack: sky, city, signs, rain, street, rider, scrim', () => {
    const children = [...scene.children]
    assert.deepEqual(children.map((child) => child.getAttribute('class')), LAYER_ORDER)
    assert.equal(scene.firstElementChild.getAttribute('class'), 'sk-cyberpunk-sky')
    assert.equal(scene.lastElementChild.getAttribute('class'), 'sk-cyberpunk-scrim')
  })

  test('builds a seeded skyline with lit windows and neon signage', () => {
    const city = scene.querySelector('.sk-cyberpunk-city-svg')
    assert.ok(city)
    assert.equal(city.getAttribute('viewBox'), '0 0 1000 640')
    assert.equal(city.querySelectorAll('.sk-cyberpunk-building').length, 9)
    assert.ok(city.querySelectorAll('.sk-cyberpunk-window').length > 20)
    assert.ok(city.querySelectorAll('.sk-cyberpunk-window--lit').length > 0)

    const signs = scene.querySelectorAll('.sk-cyberpunk-sign')
    assert.equal(signs.length, 6)
    for (const variant of ['tower', 'bar', 'block', 'ring']) {
      assert.ok(scene.querySelector(`.sk-cyberpunk-sign--${variant}`), `missing ${variant} sign`)
    }
  })

  test('draws the street kid with glowing visor, belt and collar', () => {
    const rider = scene.querySelector('.sk-cyberpunk-rider-svg')
    assert.ok(rider)
    assert.equal(rider.getAttribute('viewBox'), '0 0 320 480')
    assert.ok(rider.querySelectorAll('.sk-cyberpunk-rider-fill').length >= 9)
    assert.ok(rider.querySelector('.sk-cyberpunk-rider-visor'))
    assert.ok(rider.querySelector('.sk-cyberpunk-rider-belt'))
    assert.equal(rider.querySelectorAll('.sk-cyberpunk-rider-collar').length, 2)
    assert.ok(rider.querySelector('.sk-cyberpunk-rider-seam'))
  })

  test('paints the rain, trails and street sheen with a full particle budget', () => {
    assert.equal(scene.querySelectorAll('.sk-cyberpunk-drop').length, 26)
    for (const drop of scene.querySelectorAll('.sk-cyberpunk-drop')) {
      assert.ok(Number.parseFloat(drop.style.getPropertyValue('--sk-cyberpunk-drop-h')) > 0)
      assert.ok(drop.style.animationDuration.endsWith('s'))
    }
    assert.equal(scene.querySelectorAll('.sk-cyberpunk-trail').length, 3)
    assert.ok(scene.querySelector('.sk-cyberpunk-street-sheen'))
    assert.ok(scene.querySelector('.sk-cyberpunk-scan'))
  })

  test('compact paints the sparser card preview with the same structure', () => {
    const card = createCyberpunkScene({ compact: true })
    assert.equal(card.dataset.skCompact, 'true')
    assert.ok(card.classList.contains('sk-scene--cyberpunk'))
    assert.deepEqual([...card.children].map((child) => child.getAttribute('class')), LAYER_ORDER)

    assert.equal(card.querySelectorAll('.sk-cyberpunk-building').length, 5)
    assert.equal(card.querySelectorAll('.sk-cyberpunk-drop').length, 10)
    assert.equal(card.querySelectorAll('.sk-cyberpunk-sign').length, 3)
    assert.equal(card.querySelectorAll('.sk-cyberpunk-trail').length, 1)
    assert.ok(card.querySelectorAll('.sk-cyberpunk-drop').length < scene.querySelectorAll('.sk-cyberpunk-drop').length)

    const cardStyles = [...card.querySelectorAll('.sk-cyberpunk-drop')].map((drop) => drop.style.cssText)
    const again = createCyberpunkScene({ compact: true })
    assert.deepEqual(
      [...again.querySelectorAll('.sk-cyberpunk-drop')].map((drop) => drop.style.cssText),
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

describe('cyberpunk stylesheet', () => {
  test('scene, selected-pack shell and local preview rules keep their own scopes', () => {
    assert.ok(parsed.rules.length >= 20, 'expected a full layer sheet')
    const scopes = new Set()
    for (const rule of parsed.rules) {
      for (const selector of selectorsOf(rule)) {
        const classes = (selector.match(/\.[A-Za-z0-9_-]+/g) ?? []).map((token) => token.slice(1))
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
      assert.match(keyframe.name, /^sk-cyberpunk-[a-z0-9-]+$/, `unprefixed keyframes ${keyframe.name}`)
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
        for (const name of value.match(/sk-cyberpunk-[a-z0-9-]+/g) ?? []) used.add(name)
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
    assert.match(reduced[0].css, /\.sk-scene--cyberpunk \*/)
  })

  test('ships matched light and dark token sets on the scene root', () => {
    const { light, dark } = sceneTokenSets()
    assert.ok(light.size >= 15, 'expected a complete light token set')
    assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort())
    for (const name of ['--sk-cyberpunk-sky-top', '--sk-cyberpunk-scrim', '--sk-cyberpunk-rain']) {
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
        for (const selected of ['codex', 'ocean', 'sunset']) {
          document.documentElement.dataset.skPalette = selected
          const preview = document.createElement('div')
          if (previewMode) {
            preview.dataset.previewMode = previewMode
            preview.dataset.previewPalette = 'cyberpunk'
          }
          const mounted = createCyberpunkScene({ compact: previewMode !== null })
          preview.append(mounted)
          document.body.replaceChildren(preview)

          const expected = tokens[previewMode === 'dark' || (previewMode === null && bodyDark) ? 'dark' : 'light']
          const computed = dom.window.getComputedStyle(mounted)
          const context = `body=${bodyDark ? 'dark' : 'light'}, preview=${previewMode ?? 'none'}, selected=${selected}`
          for (const [name, value] of expected) {
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
    const riderRule = compactRules.find((rule) => /\.sk-cyberpunk-rider\b/.test(rule.selector))
    assert.ok(riderRule)
    assert.match(riderRule.body, /height:/)
    const scanRule = compactRules.find((rule) => /\.sk-cyberpunk-scan\b/.test(rule.selector))
    assert.ok(scanRule)
    assert.match(scanRule.body, /opacity:/)
  })
})
