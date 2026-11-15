/** 「夕阳红」 scene: the approved dusk artwork as a warm, quiet backdrop.
 *
 *  The artwork ships as a local .webp that the build inlines as a data URI, so the
 *  scene never touches the network and paints no <img> element — only a background
 *  layer, a clock-driven glow and a readability scrim. `options.compact` paints the
 *  sparser card preview. The palette's shared wall clock calls `updateSunsetSceneTime`
 *  so no scene owns a timer of its own.
 */
import artUrl from '../assets/sunset-art.webp'

function element(doc, tag, className) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  return node
}

/** Options accepted by `createSunsetScene`; `now` is pinned by tests. */
export interface SunsetSceneOptions {
  compact?: boolean
  now?: Date
}

/**
 * Update a detached or mounted scene: the local hour modulates the dusk light.
 * Golden hour (16:00-19:30) burns brightest; the night keeps a low ember glow.
 */
export function updateSunsetSceneTime(root, date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  const golden = Math.max(0, Math.cos(((hour - 17.5) / 6) * (Math.PI / 2)))
  root.dataset.skTimePhase = hour >= 16 && hour < 19.5 ? 'dusk' : hour < 5 || hour >= 21 ? 'night' : 'glow'
  root.style.setProperty('--sk-sunset-solar-x', `${(58 + Math.sin(((hour - 12) / 24) * 2 * Math.PI) * 10).toFixed(2)}%`)
  root.style.setProperty('--sk-sunset-glow-strength', (0.55 + golden * 0.45).toFixed(3))
  return root
}

/**
 * Paint the 「夕阳红」 dusk scene.
 * @param options compact paints the reduced card preview; `now` pins the clock.
 * @returns the decorative scene root.
 */
export function createSunsetScene(options: SunsetSceneOptions = {}) {
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('createSunsetScene needs a DOM document')
  }
  const compact = options.compact === true

  const root = element(doc, 'div', 'sk-theme-scene sk-scene--sunset')
  root.dataset.skScene = 'sunset'
  if (compact) root.dataset.skCompact = 'true'
  root.setAttribute('aria-hidden', 'true')
  root.style.setProperty('--sk-sunset-art-image', `url("${artUrl}")`)

  root.append(
    element(doc, 'div', 'sk-sunset-art'),
    element(doc, 'div', 'sk-sunset-glow'),
    element(doc, 'div', 'sk-sunset-scrim'),
  )

  return updateSunsetSceneTime(root, options.now)
}
