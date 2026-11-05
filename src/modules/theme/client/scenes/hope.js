/** Local-time sky cycle with sunrise, sunset, mountain lake and a star-filled night.
 * The scene retains no timers; the palette owns one shared wall clock.
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

/** Fine shafts fan from the sun without filling the reading area with light. */
function createRays(doc, uid, compact) {
  const svg = svgElement(doc, 'svg')
  svg.setAttribute('class', 'sk-hope-rays')
  svg.setAttribute('viewBox', '0 0 1000 640')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const gradientId = `sk-hope-ray-${uid}`
  const defs = svgElement(doc, 'defs')
  const gradient = svgElement(doc, 'radialGradient')
  gradient.setAttribute('id', gradientId)
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse')
  gradient.setAttribute('cx', '720')
  gradient.setAttribute('cy', '493')
  gradient.setAttribute('r', '430')
  for (const [offset, className, color, opacity] of [
    ['0%', 'sk-hope-ray-stop-core', '#f2cfa6', '0.55'],
    ['46%', 'sk-hope-ray-stop-mid', '#dea47f', '0.28'],
    ['100%', 'sk-hope-ray-stop-edge', '#cb8261', '0'],
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
  const centerX = 720
  const centerY = 493
  const point = (degrees, distance) => {
    const radians = (degrees * Math.PI) / 180
    return [centerX + Math.sin(radians) * distance, centerY - Math.cos(radians) * distance]
  }
  const round = (value) => value.toFixed(1)

  for (let index = 0; index < count; index += 1) {
    const spreadAlong = index / (count - 1)
    const angle = (spreadAlong * 2 - 1) * 76
    const halfWidth = 0.2 + random() * 0.5
    const inner = 92 + random() * 28
    const outer = 240 + random() * 190
    const [ax, ay] = point(angle - halfWidth, inner)
    const [bx, by] = point(angle + halfWidth, inner)
    const [dx, dy] = point(angle + halfWidth, outer)
    const [ex, ey] = point(angle - halfWidth, outer)

    const wedge = svgElement(doc, 'path')
    wedge.setAttribute('class', 'sk-hope-beam')
    wedge.setAttribute('d', `M ${round(ax)} ${round(ay)} L ${round(ex)} ${round(ey)} L ${round(dx)} ${round(dy)} L ${round(bx)} ${round(by)} Z`)
    wedge.setAttribute('fill', `url(#${gradientId})`)
    const falloff = 1 - Math.abs(spreadAlong * 2 - 1) * 0.35
    wedge.setAttribute('opacity', ((0.18 + random() * 0.2) * falloff).toFixed(2))
    beams.append(wedge)
  }

  svg.append(defs, beams)
  return svg
}

/** A defined solar disc with a quiet halo, clipped by the foreground in CSS. */
function createSun(doc) {
  const sun = element(doc, 'div', 'sk-hope-sun')
  sun.append(element(doc, 'span', 'sk-hope-sun-halo'), element(doc, 'span', 'sk-hope-sun-core'))
  return sun
}

/** Horizon glow band and the fine line the sun is rising from. */
function createHorizon(doc) {
  const horizon = element(doc, 'div', 'sk-hope-horizon')
  horizon.append(element(doc, 'span', 'sk-hope-horizon-glow'), element(doc, 'span', 'sk-hope-horizon-line'))
  return horizon
}

/** Small particles rise near the sun, away from the central reading area. */
function createEmbers(doc, random, compact) {
  const embers = element(doc, 'div', 'sk-hope-embers')
  const count = compact ? 6 : 20
  for (let index = 0; index < count; index += 1) {
    const ember = element(doc, 'span', 'sk-hope-ember')
    const size = (compact ? 1 : 1.2) + random() * 1.4
    const rise = (compact ? 35 : 70) + random() * (compact ? 45 : 100)
    const drift = (random() - 0.5) * (compact ? 16 : 30)
    placeVar(ember, '--sk-hope-ember-x', `${(48 + random() * 46).toFixed(2)}%`)
    placeVar(ember, '--sk-hope-ember-y', `${(14 + random() * 12).toFixed(2)}%`)
    placeVar(ember, '--sk-hope-ember-size', `${size.toFixed(2)}px`)
    placeVar(ember, '--sk-hope-ember-rise', `${rise.toFixed(0)}px`)
    placeVar(ember, '--sk-hope-ember-drift', `${drift.toFixed(1)}px`)
    placeVar(ember, '--sk-hope-ember-peak', `${(0.2 + random() * 0.2).toFixed(2)}`)
    place(ember, {
      animationDuration: `${(14 + random() * 12).toFixed(2)}s`,
      animationDelay: `${(-random() * 24).toFixed(2)}s`,
    })
    embers.append(ember)
  }
  return embers
}

/** Local civil time controls the scene; the palette owns the shared refresh timer.
 *  No listener, timer or animation frame is retained by an individual scene.
 *  Keeping the legacy hope id preserves existing saved theme choices.
 */
const SKY_STOPS = [
  [0, ['#050b22', '#101b43', '#243355'], 1],
  [5, ['#11152f', '#593755', '#bc6d62'], 0.85],
  [6.5, ['#535e9c', '#ee9a8a', '#ffd6a1'], 0.08],
  [9, ['#4389c4', '#90cce7', '#e2f0e8'], 0],
  [12, ['#246bb2', '#75bbdc', '#d2eced'], 0],
  [16.5, ['#4a76ab', '#b4bad1', '#ffe2ad'], 0],
  [18.5, ['#302d66', '#ca647d', '#ffb36c'], 0.12],
  [20, ['#101630', '#34325d', '#805476'], 0.85],
  [22, ['#050b22', '#101b43', '#243355'], 1],
  [24, ['#050b22', '#101b43', '#243355'], 1],
]

/** Update a detached or mounted scene, including after sleep or timezone changes. */
export function updateHopeSceneTime(root, date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  const index = SKY_STOPS.findIndex((stop) => stop[0] > hour)
  const before = SKY_STOPS[index - 1]
  const after = SKY_STOPS[index]
  const fraction = (hour - before[0]) / (after[0] - before[0])
  const smooth = fraction * fraction * (3 - 2 * fraction)
  const mix = (a, b) => {
    const channel = (color, offset) => Number.parseInt(color.slice(offset, offset + 2), 16)
    return `rgb(${[1, 3, 5].map((offset) => Math.round(channel(a, offset) * (1 - smooth) + channel(b, offset) * smooth)).join(' ')})`
  }
  before[1].forEach((color, position) => {
    root.style.setProperty(`--sk-hope-time-${['top', 'mid', 'low'][position]}`, mix(color, after[1][position]))
  })
  const night = before[2] * (1 - smooth) + after[2] * smooth
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI))
  root.dataset.skTimePhase = hour < 5 || hour >= 20 ? 'night' : hour < 8 ? 'dawn' : hour < 17 ? 'day' : 'dusk'
  root.style.setProperty('--sk-hope-night', night.toFixed(3))
  root.style.setProperty('--sk-hope-daylight', (1 - night).toFixed(3))
  root.style.setProperty('--sk-hope-solar-x', `${(54 + ((hour - 6) / 12) * 35).toFixed(2)}%`)
  root.style.setProperty('--sk-hope-solar-y', `${(74 - daylight * 47).toFixed(2)}%`)
  root.style.setProperty('--sk-hope-solar-opacity', hour >= 5.5 && hour < 19.5 ? '1' : '0')
  return root
}

function createNightSky(doc, compact) {
  const sky = element(doc, 'div', 'sk-hope-night')
  const random = createRandom(0x82ac4e)
  sky.append(element(doc, 'div', 'sk-hope-galaxy'), element(doc, 'div', 'sk-hope-moon'))
  for (let index = 0; index < (compact ? 32 : 100); index++) {
    const star = element(doc, 'span', 'sk-hope-star')
    const size = index % 13 === 0 ? 2.5 : 0.7 + random() * 1.2
    place(star, {
      left: `${(2 + random() * 96).toFixed(2)}%`,
      top: `${(2 + random() * 73).toFixed(2)}%`,
      width: `${size.toFixed(2)}px`, height: `${size.toFixed(2)}px`,
      animationDelay: `${(-random() * 8).toFixed(2)}s`,
      animationDuration: `${(5 + random() * 7).toFixed(2)}s`,
    })
    sky.append(star)
  }
  return sky
}

function createLandscape(doc) {
  const landscape = element(doc, 'div', 'sk-hope-landscape')
  for (const depth of ['far', 'mid', 'near']) landscape.append(element(doc, 'div', `sk-hope-ridge sk-hope-ridge--${depth}`))
  landscape.append(element(doc, 'div', 'sk-hope-water'), element(doc, 'div', 'sk-hope-reflection'))
  return landscape
}

/**
 * Paint the local-time 「昼夜流光」 scene.
 * @param {{ compact?: boolean, now?: Date }} [options] compact paints the reduced card preview.
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
    createNightSky(doc, compact),
    element(doc, 'div', 'sk-hope-clouds'),
    createRays(doc, uid, compact),
    createHorizon(doc),
    createSun(doc),
    createLandscape(doc),
    createEmbers(doc, random, compact),
    element(doc, 'div', 'sk-hope-scrim'),
  )

  return updateHopeSceneTime(root, options.now)
}
