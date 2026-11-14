/** Ocean whale scene: a DOM-only marine backdrop for the ocean palette.
 *
 *  The scene is a pure decoration layer. It never fetches or mounts a UI
 *  framework: ocean.css owns the motion and colors, while this module paints the
 *  layers and inline SVG whale. `options.compact` paints the sparser card preview.
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

/** A blue whale: tapered body and flukes, pale throat pleats and a small dorsal fin. */
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
      ['0%', 'sk-ocean-body-top', '#35718a'],
      ['48%', 'sk-ocean-body-mid', '#5791a8'],
      ['100%', 'sk-ocean-body-low', '#8bb7c4'],
    ]),
    createGradient(doc, finId, [
      ['0%', 'sk-ocean-fin-top', '#2b6079'],
      ['100%', 'sk-ocean-fin-low', '#4f859c'],
    ]),
  )

  const body = svgPath(
    doc,
    'sk-ocean-whale-body',
    'M 28 102 C 27 91 44 83 71 80 C 117 73 167 77 206 91 ' +
      'C 225 98 241 101 253 98 C 263 87 275 79 293 76 ' +
      'C 289 89 281 102 267 111 C 281 117 290 127 294 141 ' +
      'C 275 139 259 129 249 118 C 235 120 224 127 208 134 ' +
      'C 168 151 117 157 75 150 C 48 146 31 134 28 119 C 27 113 27 107 28 102 Z',
    { fill: `url(#${bodyId})` },
  )

  const belly = svgPath(
    doc,
    'sk-ocean-whale-belly',
    'M 31 121 C 61 142 116 146 169 137 C 197 132 224 119 245 115 ' +
      'C 224 128 212 133 198 138 C 158 155 109 158 75 150 C 52 146 36 135 31 121 Z',
  )

  const pleats = svgPath(
    doc,
    'sk-ocean-whale-pleats',
    'M 42 127 C 69 142 104 145 142 140 M 44 132 C 70 146 106 149 139 144 ' +
      'M 50 139 C 76 151 103 152 129 148',
    { fill: 'none', 'stroke-width': '0.9', 'stroke-linecap': 'round' },
  )

  const fin = svgPath(
    doc,
    'sk-ocean-whale-fin',
    'M 116 132 C 126 144 140 158 157 166 C 163 169 166 168 163 163 ' +
      'C 151 148 141 138 129 130 Z',
    { fill: `url(#${finId})` },
  )

  const dorsal = svgPath(
    doc,
    'sk-ocean-whale-dorsal',
    'M 196 87 C 202 79 208 78 212 79 C 209 83 210 88 214 93 Z',
    { fill: `url(#${finId})` },
  )

  const highlight = svgPath(
    doc,
    'sk-ocean-whale-highlight',
    'M 47 91 C 91 81 151 84 194 97',
    { fill: 'none', 'stroke-width': '1.2', 'stroke-linecap': 'round' },
  )

  const mouth = svgPath(doc, 'sk-ocean-whale-mouth', 'M 30 116 C 48 122 71 124 95 120', {
    fill: 'none',
    'stroke-width': '1.3',
    'stroke-linecap': 'round',
    opacity: '0.6',
  })

  const eye = svgElement(doc, 'circle')
  eye.setAttribute('class', 'sk-ocean-whale-eye')
  eye.setAttribute('cx', '67')
  eye.setAttribute('cy', '112')
  eye.setAttribute('r', '2')

  const eyeGlint = svgElement(doc, 'circle')
  eyeGlint.setAttribute('class', 'sk-ocean-whale-eye-glint')
  eyeGlint.setAttribute('cx', '66.5')
  eyeGlint.setAttribute('cy', '111.4')
  eyeGlint.setAttribute('r', '0.6')

  const spout = svgPath(
    doc,
    'sk-ocean-whale-spout',
    'M 64 80 C 65 64 62 53 56 43 M 65 68 C 69 57 75 51 83 49',
    { fill: 'none', 'stroke-width': '1.5', 'stroke-linecap': 'round' },
  )

  // Fine anatomical folds and mottled skin read as volume even in a small card.
  const detail = svgElement(doc, 'g')
  detail.setAttribute('class', 'sk-ocean-whale-detail')
  for (let index = 0; index < 9; index++) {
    detail.append(svgPath(doc, 'sk-ocean-whale-fold',
      `M ${37 + index * 3} ${121 + index * 2.2} Q ${82 + index * 3} ${149 + index} ${156 + index * 4} ${136 + index * 0.4}`,
      { fill: 'none', 'stroke-width': '0.45' }))
  }
  const random = createRandom(0x43be72)
  for (let index = 0; index < 38; index++) {
    const spot = svgElement(doc, 'ellipse')
    spot.setAttribute('class', 'sk-ocean-whale-mottle')
    spot.setAttribute('cx', (48 + random() * 152).toFixed(1))
    spot.setAttribute('cy', (98 + random() * 29).toFixed(1))
    spot.setAttribute('rx', (0.5 + random() * 1.6).toFixed(1))
    spot.setAttribute('ry', (0.3 + random() * 0.65).toFixed(1))
    detail.append(spot)
  }
  const caustic = svgPath(doc, 'sk-ocean-whale-caustic',
    'M 45 100 Q 70 88 93 98 T 143 95 T 192 105 M 61 108 Q 90 99 114 108 T 165 104 T 213 113',
    { fill: 'none', 'stroke-width': '1.2' })
  svg.append(defs, dorsal, body, belly, pleats, detail, highlight, caustic, fin, mouth, eye, eyeGlint, spout)
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
    'M 0 100 C 240 64 480 64 720 100 S 1200 136 1440 100',
    'M 0 128 C 220 160 500 160 720 128 S 1220 96 1440 128',
    'M 0 162 C 240 140 480 140 720 162 S 1200 184 1440 162',
  ]
  shapes.forEach((shape, index) => {
    const layer = element(doc, 'div', `sk-ocean-wave sk-ocean-wave--${index + 1}`)
    const svg = svgElement(doc, 'svg')
    svg.setAttribute('class', 'sk-ocean-wave-svg')
    // Both repeats must fit inside the SVG viewport for the 50% drift to loop.
    svg.setAttribute('viewBox', '0 0 2880 220')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('focusable', 'false')
    for (const offset of [0, 1440]) {
      const path = svgPath(doc, 'sk-ocean-wave-path', `${shape} L 1440 220 L 0 220 Z`)
      const crest = svgPath(doc, 'sk-ocean-wave-crest', shape)
      if (offset) {
        path.setAttribute('transform', `translate(${offset} 0)`)
        crest.setAttribute('transform', `translate(${offset} 0)`)
      }
      svg.append(path, crest)
    }
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
export function createOceanScene(options: { compact?: boolean } = {}) {
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
    element(doc, 'div', 'sk-ocean-surface'),
    createBeams(doc, compact ? 2 : 3),
    createStars(doc, random, compact ? 6 : 22),
    element(doc, 'div', 'sk-ocean-distant-whale'),
    createWhale(doc, uid),
    element(doc, 'div', 'sk-ocean-caustics'),
    createWaves(doc),
    createSplash(doc, { compact }),
    createBubbles(doc, bubbleRandom, compact ? 3 : 10),
    element(doc, 'div', 'sk-ocean-scrim'),
  )

  return root
}
