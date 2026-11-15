/** 「赛博朋克2077」 scene: the Night City key art as a still, cinematic backdrop.
 *
 *  The artwork ships as a local .webp that the build inlines as a data URI, so the
 *  scene never touches the network and paints no <img> element — only a background
 *  layer, a warm dusk glow and a readability scrim. `options.compact` paints the
 *  sparser card preview. No clock: the dusk skyline stays put and breathes on its own.
 */
import artUrl from '../assets/cyberpunk-art.webp'

function element(doc, tag, className) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  return node
}

/**
 * Paint the cyberpunk scene.
 * @param {{ compact?: boolean }} [options] compact paints the reduced card preview.
 * @returns {HTMLElement} the decorative scene root.
 */
export function createCyberpunkScene(options: { compact?: boolean } = {}) {
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== 'function') {
    throw new Error('createCyberpunkScene needs a DOM document')
  }
  const compact = options.compact === true

  const root = element(doc, 'div', 'sk-theme-scene sk-scene--cyberpunk')
  root.dataset.skScene = 'cyberpunk'
  if (compact) root.dataset.skCompact = 'true'
  root.setAttribute('aria-hidden', 'true')
  root.style.setProperty('--sk-cyberpunk-art-image', `url("${artUrl}")`)

  root.append(
    element(doc, 'div', 'sk-cyberpunk-art'),
    element(doc, 'div', 'sk-cyberpunk-glow'),
    element(doc, 'div', 'sk-cyberpunk-scrim'),
  )

  return root
}
