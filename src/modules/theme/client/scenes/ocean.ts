/** 「大海蓝鲸」 scene: the approved deep-ocean whale art as a quiet backdrop.
 *
 *  The artwork ships as a local .webp that the build inlines as a data URI, so the
 *  scene never touches the network and paints no <img> element — only a background
 *  layer, a soft glow and a readability scrim. `options.compact` paints the
 *  sparser card preview.
 */
import artUrl from '../assets/ocean-art.webp'

function element(doc, tag, className) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  return node
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

  const root = element(doc, 'div', 'sk-theme-scene sk-scene--ocean')
  root.dataset.skScene = 'ocean'
  if (compact) root.dataset.skCompact = 'true'
  root.setAttribute('aria-hidden', 'true')
  root.style.setProperty('--sk-ocean-art-image', `url("${artUrl}")`)

  root.append(
    element(doc, 'div', 'sk-ocean-art'),
    element(doc, 'div', 'sk-ocean-glow'),
    element(doc, 'div', 'sk-ocean-scrim'),
  )

  return root
}
