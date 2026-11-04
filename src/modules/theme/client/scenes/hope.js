/** Hope-red scene: a DOM-only「朝阳与余烬」backdrop for the hope palette.
 *
 *  The scene is a pure decoration layer. It never fetches, never mounts a UI
 *  framework and keeps no state: the visual life of the layers lives in hope.css, while this
 *  module paints the layer tree (inline SVG light shafts included) and scatters
 *  the rising embers. `options.compact` paints the sparser copy used by the theme
 *  card thumbnail; the same function paints the real hero backdrop.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Deterministic scatter seeds keep the same palette painting the same dawn. */
const RAY_SEED = 0x6a17d3
const EMBER_SEED = 0x39c4a7

let sceneCount = 0

function element(doc, tag, className) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  return node
}

function svgElement(doc, tag) {
  return doc.createElementNS(SVG_NS, tag)
}

/** Place inline geometry without relying on custom properties (jsdom-safe). */
function place(node, styles) {
  for (const [property, value] of Object.entries(styles)) node.style[property] = value
  return node
}

/** Particle variation lives in custom properties so one keyframe serves them all. */
function placeVar(node, name, value) {
  node.style.setProperty(name, value)
  return node
}

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * Radial light shafts fanning up from the horizon. Drawn as one inline SVG so the
 * beams stay crisp at any hero size; a single CSS group transform animates them.
 */
function createRays(doc, uid, compact) {
  const svg = svgElement(doc, 'svg')
  svg.setAttribute('class', 'sk-hope-rays')
  svg.setAttribute('viewBox', '0 0 1000 640')
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const gradientId = `sk-hope-ray-${uid}`
  const defs = svgElement(doc, 'defs')
  const gradient = svgElement(doc, 'radialGradient')
  gradient.setAttribute('id', gradientId)
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse')
  gradient.setAttribute('cx', '500')
  gradient.setAttribute('cy', '512')
  gradient.setAttribute('r', '560')
  for (const [offset, className, color, opacity] of [
    ['0%', 'sk-hope-ray-stop-core', '#fff1d4', '0.95'],
    ['46%', 'sk-hope-ray-stop-mid', '#ffb878', '0.55'],
    ['100%', 'sk-hope-ray-stop-edge', '#b83a28', '0'],
  ]) {
    const stop = svgElement(doc, 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('class', className)
    stop.setAttribute('stop-color', color)
    stop.setAttribute('stop-opacity', opacity)
    gradient.append(stop)
  }
  defs.append(gradient)

  const beams = svgElement(doc, 'g')
  beams.setAttribute('class', 'sk-hope-beams')

  const random = createRandom(RAY_SEED)
  const count = compact ? 12 : 23
  const centerX = 500
  const centerY = 512
  const point = (degrees, distance) => {
    const radians = (degrees * Math.PI) / 180
    return [centerX + Math.sin(radians) * distance, centerY - Math.cos(radians) * distance]
  }
  const round = (value) => value.toFixed(1)

  for (let index = 0; index < count; index += 1) {
    const spreadAlong = count === 1 ? 0.5 : index / (count - 1)
    const angle = (spreadAlong * 2 - 1) * 84
    const wide = index % 5 === 0
    const halfWidth = (wide ? 2.1 : 0.55) + random() * (wide ? 1.1 : 0.85)
    const inner = 26 + random() * 44
    const outer = 380 + random() * 300
    const [ax, ay] = point(angle - halfWidth, inner)
    const [bx, by] = point(angle + halfWidth, inner)
    const [dx, dy] = point(angle + halfWidth, outer)
    const [ex, ey] = point(angle - halfWidth, outer)

    const wedge = svgElement(doc, 'path')
    wedge.setAttribute('class', 'sk-hope-beam')
    wedge.setAttribute('d', `M ${round(ax)} ${round(ay)} L ${round(ex)} ${round(ey)} L ${round(dx)} ${round(dy)} L ${round(bx)} ${round(by)} Z`)
    wedge.setAttribute('fill', `url(#${gradientId})`)
    const falloff = 1 - Math.abs(spreadAlong * 2 - 1) * 0.35
    wedge.setAttribute('opacity', ((0.34 + random() * 0.52) * falloff).toFixed(2))
    beams.append(wedge)
  }

  svg.append(defs, beams)
  return svg
}

/** Soft sun sitting on the horizon line: a wide halo plus a small bright core. */
function createSun(doc) {
  const sun = element(doc, 'div', 'sk-hope-sun')
  sun.append(element(doc, 'span', 'sk-hope-sun-halo'), element(doc, 'span', 'sk-hope-sun-core'))
  return sun
}

/** Horizon glow band and the thin bright line the sun is rising from. */
function createHorizon(doc) {
  const horizon = element(doc, 'div', 'sk-hope-horizon')
  horizon.append(element(doc, 'span', 'sk-hope-horizon-glow'), element(doc, 'span', 'sk-hope-horizon-line'))
  return horizon
}

/** Embers drifting up from the horizon; each keeps its own duration and delay. */
function createEmbers(doc, random, compact) {
  const embers = element(doc, 'div', 'sk-hope-embers')
  const count = compact ? 6 : 20
  for (let index = 0; index < count; index += 1) {
    const ember = element(doc, 'span', 'sk-hope-ember')
    const size = (compact ? 1.6 : 2) + random() * (compact ? 1.8 : 2.6)
    const rise = (compact ? 55 : 110) + random() * (compact ? 70 : 150)
    const drift = (random() - 0.5) * (compact ? 26 : 46)
    placeVar(ember, '--sk-hope-ember-x', `${(6 + random() * 88).toFixed(2)}%`)
    placeVar(ember, '--sk-hope-ember-y', `${(6 + random() * 22).toFixed(2)}%`)
    placeVar(ember, '--sk-hope-ember-size', `${size.toFixed(2)}px`)
    placeVar(ember, '--sk-hope-ember-rise', `${rise.toFixed(0)}px`)
    placeVar(ember, '--sk-hope-ember-drift', `${drift.toFixed(1)}px`)
    placeVar(ember, '--sk-hope-ember-peak', `${(0.42 + random() * 0.4).toFixed(2)}`)
    place(ember, {
      animationDuration: `${(10 + random() * 9).toFixed(2)}s`,
      animationDelay: `${(-random() * 18).toFixed(2)}s`,
    })
    embers.append(ember)
  }
  return embers
}

/**
 * Paint the hope-red scene.
 * @param {{ compact?: boolean }} [options] compact paints the reduced card preview.
 * @returns {HTMLElement} the decorative scene root.
 */
export function createHopeScene(options = {}) {
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('createHopeScene needs a DOM document')
  }
  const compact = options.compact === true
  const uid = ++sceneCount
  const random = createRandom(EMBER_SEED)

  const root = element(doc, 'div', 'sk-theme-scene sk-scene--hope')
  root.dataset.skScene = 'hope'
  if (compact) root.dataset.skCompact = 'true'
  root.setAttribute('aria-hidden', 'true')

  root.append(
    element(doc, 'div', 'sk-hope-sky'),
    element(doc, 'div', 'sk-hope-dawn'),
    createRays(doc, uid, compact),
    createHorizon(doc),
    createSun(doc),
    createEmbers(doc, random, compact),
    element(doc, 'div', 'sk-hope-scrim'),
  )

  return root
}
