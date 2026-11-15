/** Cyberpunk street scene: a hooded street kid under neon, rain and a future skyline.
 *
 *  The scene is a pure decoration layer. It never fetches or mounts a UI
 *  framework: cyberpunk.css owns the motion and colors, while this module paints
 *  the layers and inline SVG silhouettes. `options.compact` paints the sparser
 *  card preview. No clock: the neon night stays put and flickers on its own.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Deterministic scatter seeds keep the same palette painting the same street. */
const CITY_SEED = 0x71c2b8
const RAIN_SEED = 0x4e08d2

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

function svgRect(doc, className, x, y, width, height) {
  const rect = svgElement(doc, 'rect')
  rect.setAttribute('class', className)
  rect.setAttribute('x', x)
  rect.setAttribute('y', y)
  rect.setAttribute('width', width)
  rect.setAttribute('height', height)
  return rect
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

/** A night skyline: dark blocks with lit window grids, seeded and stable. */
function createCity(doc, compact) {
  const wrap = element(doc, 'div', 'sk-cyberpunk-city')
  const svg = svgElement(doc, 'svg')
  svg.setAttribute('class', 'sk-cyberpunk-city-svg')
  svg.setAttribute('viewBox', '0 0 1000 640')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const random = createRandom(CITY_SEED)
  const count = compact ? 5 : 9
  let x = -30
  for (let index = 0; index < count; index += 1) {
    const width = 72 + random() * 88
    const height = 150 + random() * 250
    const top = 620 - height
    svg.append(svgRect(doc, 'sk-cyberpunk-building', x.toFixed(1), top.toFixed(1), width.toFixed(1), (height + 40).toFixed(1)))
    svg.append(svgRect(doc, 'sk-cyberpunk-building-cap', x.toFixed(1), top.toFixed(1), width.toFixed(1), '3'))

    const cols = 3 + Math.floor(random() * 3)
    const rows = Math.max(2, Math.floor(height / 36))
    const colStep = (width - 26) / cols
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (random() > 0.5) continue
        const lit = random() > 0.72
        svg.append(svgRect(
          doc,
          lit ? 'sk-cyberpunk-window sk-cyberpunk-window--lit' : 'sk-cyberpunk-window',
          (x + 13 + col * colStep).toFixed(1),
          (top + 18 + row * 34).toFixed(1),
          '8',
          '13',
        ))
      }
    }
    x += width + 8 + random() * 24
  }

  wrap.append(svg)
  return wrap
}

/** Neon signage: glowing bars and blocks pinned across the skyline. */
function createSigns(doc, compact) {
  const signs = element(doc, 'div', 'sk-cyberpunk-signs')
  const specs = [
    { className: 'sk-cyberpunk-sign sk-cyberpunk-sign--tower', left: 11, top: 24 },
    { className: 'sk-cyberpunk-sign sk-cyberpunk-sign--bar', left: 27, top: 33 },
    { className: 'sk-cyberpunk-sign sk-cyberpunk-sign--block', left: 44, top: 26 },
    { className: 'sk-cyberpunk-sign sk-cyberpunk-sign--ring', left: 58, top: 31 },
    { className: 'sk-cyberpunk-sign sk-cyberpunk-sign--bar', left: 72, top: 22 },
    { className: 'sk-cyberpunk-sign sk-cyberpunk-sign--tower', left: 86, top: 36 },
  ]
  for (const [index, spec] of specs.entries()) {
    if (compact && index % 2 === 1) continue
    const sign = element(doc, 'span', spec.className)
    place(sign, { left: `${spec.left}%`, top: `${spec.top}%` })
    signs.append(sign)
  }
  return signs
}

/** Fine neon rain falls across the street, away from the reading area. */
function createRain(doc, random, compact) {
  const rain = element(doc, 'div', 'sk-cyberpunk-rain')
  const count = compact ? 10 : 26
  for (let index = 0; index < count; index += 1) {
    const drop = element(doc, 'span', 'sk-cyberpunk-drop')
    placeVar(drop, '--sk-cyberpunk-drop-x', `${(random() * 100).toFixed(2)}%`)
    placeVar(drop, '--sk-cyberpunk-drop-h', `${(10 + random() * 18).toFixed(0)}px`)
    placeVar(drop, '--sk-cyberpunk-drop-peak', `${(0.18 + random() * 0.3).toFixed(2)}`)
    place(drop, {
      animationDuration: `${(1.6 + random() * 1.8).toFixed(2)}s`,
      animationDelay: `${(-random() * 4).toFixed(2)}s`,
    })
    rain.append(drop)
  }
  return rain
}

/** Wet asphalt carries the neon back as soft reflection streaks. */
function createStreet(doc) {
  const street = element(doc, 'div', 'sk-cyberpunk-street')
  street.append(element(doc, 'span', 'sk-cyberpunk-street-sheen'))
  return street
}

/** The street kid: jacket, popped collar and a glowing visor. */
function createRider(doc) {
  const wrap = element(doc, 'div', 'sk-cyberpunk-rider')
  const svg = svgElement(doc, 'svg')
  svg.setAttribute('class', 'sk-cyberpunk-rider-svg')
  svg.setAttribute('viewBox', '0 0 320 480')
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  svg.append(
    // Wind-pushed hair.
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 132 84 Q 120 52 148 36 Q 162 22 182 32 Q 204 28 210 50 Q 216 66 204 80 Q 192 58 172 52 Q 148 46 138 66 Z'),
    // Head.
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 148 62 Q 172 54 186 72 Q 196 92 182 108 Q 162 120 146 108 Q 132 92 138 74 Q 142 64 148 62 Z'),
    // Popped collar, left and right.
    svgPath(doc, 'sk-cyberpunk-rider-collar', 'M 138 112 L 118 92 L 142 104 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-collar', 'M 188 110 L 212 88 L 194 104 Z'),
    // Jacket: broad shoulders, tapered waist, flared hem.
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 134 106 Q 112 118 106 152 L 100 216 Q 98 240 118 248 L 202 248 Q 222 240 220 216 L 214 152 Q 208 118 186 106 Q 168 98 150 102 Z'),
    // Hanging left arm, right arm bent to the hip.
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 110 132 Q 92 158 86 196 Q 82 214 94 220 Q 106 222 112 208 Q 118 176 124 150 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 210 132 Q 228 156 232 188 Q 234 206 222 210 Q 210 210 208 196 Q 204 168 198 148 Z'),
    // Legs and boots.
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 118 244 Q 112 292 108 336 Q 104 372 112 392 L 138 392 Q 142 360 146 322 Q 150 282 154 248 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-fill',
      'M 172 248 Q 180 292 188 336 Q 194 372 190 392 L 216 392 Q 222 370 216 332 Q 206 288 200 246 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-fill', 'M 106 386 L 142 386 L 146 410 L 98 410 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-fill', 'M 186 386 L 222 386 L 228 410 L 182 410 Z'),
    // Glowing visor, belt and jacket seam.
    svgPath(doc, 'sk-cyberpunk-rider-visor', 'M 140 84 L 190 78 L 192 92 L 142 96 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-belt', 'M 112 212 L 210 212 L 210 223 L 112 223 Z'),
    svgPath(doc, 'sk-cyberpunk-rider-seam', 'M 160 112 L 160 210', { fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round' }),
  )

  wrap.append(svg)
  return wrap
}

/** Hover traffic drags thin light trails across the mid-air lanes. */
function createLights(doc, compact) {
  const lights = element(doc, 'div', 'sk-cyberpunk-lights')
  const specs = [
    { top: 34, width: 22, duration: 17, delay: 0 },
    { top: 44, width: 15, duration: 23, delay: -9 },
    { top: 28, width: 18, duration: 29, delay: -17 },
  ]
  for (const [index, spec] of specs.entries()) {
    if (compact && index > 0) break
    const trail = element(doc, 'span', 'sk-cyberpunk-trail')
    placeVar(trail, '--sk-cyberpunk-trail-top', `${spec.top}%`)
    placeVar(trail, '--sk-cyberpunk-trail-w', `${spec.width}%`)
    place(trail, {
      animationDuration: `${spec.duration}s`,
      animationDelay: `${spec.delay}s`,
    })
    lights.append(trail)
  }
  return lights
}

/**
 * Paint the 「赛博朋克2077」 street scene.
 * @param options compact paints the reduced card preview.
 * @returns the decorative scene root.
 */
export function createCyberpunkScene(options: { compact?: boolean } = {}) {
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('createCyberpunkScene needs a DOM document')
  }
  const compact = options.compact === true
  const random = createRandom(RAIN_SEED)

  const root = element(doc, 'div', 'sk-theme-scene sk-scene--cyberpunk')
  root.dataset.skScene = 'cyberpunk'
  if (compact) root.dataset.skCompact = 'true'
  root.setAttribute('aria-hidden', 'true')

  root.append(
    element(doc, 'div', 'sk-cyberpunk-sky'),
    element(doc, 'div', 'sk-cyberpunk-glow'),
    createCity(doc, compact),
    createSigns(doc, compact),
    createRain(doc, random, compact),
    createStreet(doc),
    createRider(doc),
    createLights(doc, compact),
    element(doc, 'div', 'sk-cyberpunk-scan'),
    element(doc, 'div', 'sk-cyberpunk-scrim'),
  )

  return root
}
