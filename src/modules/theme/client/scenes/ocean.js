/** Ocean whale scene: a DOM-only "大海蓝鲸" backdrop for the ocean palette.
 *
 *  The scene is a pure decoration layer. It never fetches, never mounts React and
 *  owns no state: the visual life of the layers lives in ocean.css, while this
 *  module only paints the layer tree (inline SVG whale included) and scatters the
 *  particles. `options.compact` paints a sparser copy for the theme card preview.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Scatter seeds stay deterministic so the same palette always paints the same sky. */
const STAR_SEED = 0x51f3a7
const BUBBLE_SEED = 0x2c9e51

let sceneCount = 0

function element(doc, tag, className) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  return node
}

function svgElement(doc, tag) {
  return doc.createElementNS(SVG_NS, tag)
}

function svgPath(doc, className, d, attrs = {}) {
  const path = svgElement(doc, 'path')
  path.setAttribute('class', className)
  path.setAttribute('d', d)
  for (const [name, value] of Object.entries(attrs)) path.setAttribute(name, value)
  return path
}

/** Place inline geometry without relying on custom properties (jsdom-safe). */
function place(node, styles) {
  for (const [property, value] of Object.entries(styles)) node.style[property] = value
  return node
}

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function createGradient(doc, id, stops) {
  const gradient = svgElement(doc, 'linearGradient')
  gradient.setAttribute('id', id)
  gradient.setAttribute('x1', '0')
  gradient.setAttribute('y1', '0')
  gradient.setAttribute('x2', '0.18')
  gradient.setAttribute('y2', '1')
  for (const [offset, className, color] of stops) {
    const stop = svgElement(doc, 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('class', className)
    stop.setAttribute('stop-color', color)
    gradient.append(stop)
  }
  return gradient
}

/** The breaching whale: body, flukes, pectoral fin, dorsal fin, eye, mouth and spout. */
function createWhale(doc, uid) {
  const whale = element(doc, 'div', 'sk-ocean-whale')
  const svg = svgElement(doc, 'svg')
  svg.setAttribute('class', 'sk-ocean-whale-svg')
  svg.setAttribute('viewBox', '0 0 320 220')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('focusable', 'false')

  const bodyId = `sk-ocean-body-${uid}`
  const finId = `sk-ocean-fin-${uid}`
  const defs = svgElement(doc, 'defs')
  defs.append(
    createGradient(doc, bodyId, [
      ['0%', 'sk-ocean-body-top', '#0b2e4c'],
      ['48%', 'sk-ocean-body-mid', '#1a5885'],
      ['100%', 'sk-ocean-body-low', '#569bc2'],
    ]),
    createGradient(doc, finId, [
      ['0%', 'sk-ocean-fin-top', '#0a2740'],
      ['100%', 'sk-ocean-fin-low', '#1a5076'],
    ]),
  )

  const body = svgPath(doc, 'sk-ocean-whale-body', '', { fill: `url(#${bodyId})` })
  body.setAttribute(
    'd',
    'M 22 104 C 24 90 38 84 58 82 C 98 77 150 77 190 83 C 210 86 222 90 226 94 ' +
      'C 240 90 256 80 272 72 C 286 64 300 70 296 82 C 290 94 280 104 268 112 ' +
      'C 278 118 288 128 294 140 C 300 152 288 160 278 152 C 266 142 250 130 226 116 ' +
      'C 212 130 192 140 168 146 C 132 156 86 158 54 154 C 40 158 26 160 22 150 Z',
  )

  const fin = svgPath(
    doc,
    'sk-ocean-whale-fin',
    'M 100 152 C 108 164 122 178 140 186 C 143 176 136 162 124 153 ' +
      'C 114 146 106 146 100 152 Z',
    { fill: `url(#${finId})` },
  )

  const dorsal = svgPath(
    doc,
    'sk-ocean-whale-dorsal',
    'M 192 83 C 198 79 206 78 211 79 C 208 82 206 85 205 87 Z',
    { fill: `url(#${finId})` },
  )


  const mouth = svgPath(doc, 'sk-ocean-whale-mouth', 'M 23 146 C 40 138 64 133 88 132', {
    fill: 'none',
    stroke: 'var(--sk-ocean-whale-ink)',
    'stroke-width': '2.4',
    'stroke-linecap': 'round',
    opacity: '0.5',
  })

  const eye = svgElement(doc, 'circle')
  eye.setAttribute('class', 'sk-ocean-whale-eye')
  eye.setAttribute('cx', '72')
  eye.setAttribute('cy', '114')
  eye.setAttribute('r', '3.2')
  eye.setAttribute('fill', 'var(--sk-ocean-whale-ink)')

  const spout = svgPath(
    doc,
    'sk-ocean-whale-spout',
    'M 62 80 C 59 68 63 58 61 46 M 68 80 C 71 69 75 60 72 49',
    {
      fill: 'none',
      stroke: 'var(--sk-ocean-spout)',
      'stroke-width': '2.4',
      'stroke-linecap': 'round',
      opacity: '0.7',
    },
  )


  svg.append(defs, body, fin, dorsal, mouth, eye, spout)
  whale.append(svg)
  return whale
}

/** Expanding water rings where the whale breaks the surface. */
function createSplash(doc, { compact }) {
  const splash = element(doc, 'div', 'sk-ocean-splash')
  const rings = compact ? 2 : 3
  for (let index = 0; index < rings; index++) {
    const ring = element(doc, 'span', 'sk-ocean-splash-ring')
    ring.style.animationDelay = `${index * 2.1}s`
    splash.append(ring)
  }
  return splash
}

/** Three layered wave silhouettes; each layer repeats its path for a seamless drift. */
function createWaves(doc) {
  const waves = element(doc, 'div', 'sk-ocean-waves')
  const shapes = [
    'M 0 96 C 180 52 340 132 520 104 C 700 76 860 20 1040 42 C 1180 59 1300 96 1440 74 L 1440 220 L 0 220 Z',
    'M 0 132 C 160 104 300 148 470 136 C 660 122 780 78 960 92 C 1140 106 1290 152 1440 128 L 1440 220 L 0 220 Z',
    'M 0 158 C 140 138 300 176 470 166 C 660 154 820 128 1000 142 C 1180 156 1300 184 1440 174 L 1440 220 L 0 220 Z',
  ]
  shapes.forEach((shape, index) => {
    const layer = element(doc, 'div', `sk-ocean-wave sk-ocean-wave--${index + 1}`)
    const svg = svgElement(doc, 'svg')
    svg.setAttribute('class', 'sk-ocean-wave-svg')
    svg.setAttribute('viewBox', '0 0 1440 220')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('focusable', 'false')
    const path = svgPath(doc, 'sk-ocean-wave-path', shape)
    const echo = svgPath(doc, 'sk-ocean-wave-path', shape)
    echo.setAttribute('transform', 'translate(1440 0)')
    svg.append(path, echo)
    layer.append(svg)
    waves.append(layer)
  })
  return waves
}

function createStars(doc, random, count) {
  const stars = element(doc, 'div', 'sk-ocean-stars')
  for (let index = 0; index < count; index++) {
    const star = element(doc, 'span', 'sk-ocean-star')
    const size = 1.6 + random() * 2.2
    place(star, {
      left: `${(4 + random() * 92).toFixed(2)}%`,
      top: `${(4 + random() * 46).toFixed(2)}%`,
      width: `${size.toFixed(2)}px`,
      height: `${size.toFixed(2)}px`,
      animationDelay: `${(-random() * 9).toFixed(2)}s`,
      animationDuration: `${(5.5 + random() * 4.5).toFixed(2)}s`,
      opacity: `${(0.3 + random() * 0.55).toFixed(2)}`,
    })
    stars.append(star)
  }
  return stars
}

function createBubbles(doc, random, count) {
  const bubbles = element(doc, 'div', 'sk-ocean-bubbles')
  for (let index = 0; index < count; index++) {
    const bubble = element(doc, 'span', 'sk-ocean-bubble')
    const size = 2.5 + random() * 6
    place(bubble, {
      left: `${(8 + random() * 84).toFixed(2)}%`,
      bottom: `${(6 + random() * 26).toFixed(2)}%`,
      width: `${size.toFixed(2)}px`,
      height: `${size.toFixed(2)}px`,
      animationDelay: `${(-random() * 16).toFixed(2)}s`,
      animationDuration: `${(13 + random() * 9).toFixed(2)}s`,
    })
    bubbles.append(bubble)
  }
  return bubbles
}

function createBeams(doc, count) {
  const beams = element(doc, 'div', 'sk-ocean-beams')
  for (let index = 0; index < count; index++) {
    const beam = element(doc, 'span', `sk-ocean-beam sk-ocean-beam--${index + 1}`)
    beam.style.animationDelay = `${(-index * 3.4).toFixed(2)}s`
    beams.append(beam)
  }
  return beams
}

/**
 * Paint the ocean scene.
 * @param {{ compact?: boolean }} [options] compact paints the reduced card preview.
 * @returns {HTMLElement} the decorative scene root.
 */
export function createOceanScene(options = {}) {
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('createOceanScene needs a DOM document')
  }
  const compact = options.compact === true
  const random = createRandom(STAR_SEED)
  const bubbleRandom = createRandom(BUBBLE_SEED)
  const uid = ++sceneCount

  const root = element(doc, 'div', 'sk-theme-scene sk-scene--ocean')
  root.dataset.skScene = 'ocean'
  if (compact) root.dataset.skCompact = 'true'
  root.setAttribute('aria-hidden', 'true')

  const glow = element(doc, 'div', 'sk-ocean-sky')
  glow.append(element(doc, 'span', 'sk-ocean-sky-glow sk-ocean-sky-glow--left'))
  glow.append(element(doc, 'span', 'sk-ocean-sky-glow sk-ocean-sky-glow--right'))

  root.append(
    glow,
    createBeams(doc, compact ? 2 : 3),
    createStars(doc, random, compact ? 6 : 22),
    createWhale(doc, uid),
    createWaves(doc),
    createSplash(doc, { compact }),
    createBubbles(doc, bubbleRandom, compact ? 3 : 10),
    element(doc, 'div', 'sk-ocean-scrim'),
  )

  return root
}
