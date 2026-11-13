/** Palette marker + hero scene mounting for the two animated themes.
 *
 * The plugin config owns the palette; the native Light/Dark/System preference
 * stays independent (the theme center edits it through `ctx.theme`). Scenes are
 * mounted only inside the main, empty conversation hero content, so loading or
 * active conversations and sidebar-embedded chats never show the art.
 */
import { findScopedForm } from '../../../client/config.js'

export const PALETTES = Object.freeze(['native', 'codex', 'ocean', 'hope'])

export const PALETTE_ATTR = 'data-sk-palette'
export const SCENE_CLASS = 'sk-theme-scene'
export const HERO_SELECTOR =
  '[data-slot="main.conversation"] > [data-phase="hero"] > [data-conversation-content][data-content-phase="hero"]'

const BUILDERS = new Map()

/** Scene builders are registered by the client entry (kept out of this module to
 * avoid a cycle: panels import palette helpers, entries import scene modules). */
export function registerPaletteScene(palette, factory) {
  if (typeof factory !== 'function') throw new TypeError('scene factory must be a function')
  BUILDERS.set(palette, factory)
  return () => {
    if (BUILDERS.get(palette) === factory) BUILDERS.delete(palette)
  }
}

export function paletteSceneFactory(palette) {
  return BUILDERS.get(palette)
}

/** Build one scene element (`compact` renders the card thumbnail variant). */
export function createPaletteScene(palette, options = {}) {
  const factory = BUILDERS.get(palette)
  return factory ? factory({ compact: options.compact === true }) : null
}

function snapshotOf(form) {
  try { return form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot }
  catch { return undefined }
}

/** Read the persisted palette, falling back to the shipped look. */
export function readPalette(form) {
  const snapshot = snapshotOf(form)
  const value = snapshot && typeof snapshot === 'object' && 'value' in snapshot ? snapshot.value : snapshot
  const palette = value?.palette
  return PALETTES.includes(palette) ? palette : 'native'
}

/** Apply an explicit style marker; only `codex` enables the Codex shell. */
export function applyPalette(palette, root = globalThis.document?.documentElement) {
  if (!root?.setAttribute) return
  root.setAttribute(PALETTE_ATTR, PALETTES.includes(palette) ? palette : 'native')
}

function scenesIn(scope) {
  return scope ? [...scope.children].filter((child) => child.classList?.contains(SCENE_CLASS)) : []
}

/** Replace any previous scene in `hero` with the one for `palette`. */
export function mountPaletteScene(hero, palette, options = {}) {
  if (!hero) return null
  for (const scene of scenesIn(hero)) scene.remove()
  const scene = createPaletteScene(palette, options)
  if (!scene) return null
  const first = hero.firstElementChild
  hero.insertBefore(scene, first ?? null)
  return scene
}

export function clearPaletteScenes(scope = globalThis.document) {
  if (!scope?.querySelectorAll) return
  for (const scene of scope.querySelectorAll(`.${SCENE_CLASS}`)) scene.remove()
}

/** One wall-clock refresh for hero + settings scenes, paused while hidden. */
export function installSceneClock(updateScene, options = {}) {
  const doc = options.document ?? globalThis.document
  const clock = options.clock ?? globalThis
  const now = options.now ?? (() => new Date())
  let disposed = false
  const refresh = () => {
    if (disposed || doc?.hidden) return
    const date = now()
    for (const scene of doc?.querySelectorAll?.('.sk-scene--hope') ?? []) updateScene(scene, date)
  }
  const timer = clock.setInterval(refresh, 60_000)
  doc?.addEventListener?.('visibilitychange', refresh)
  refresh()
  return () => {
    disposed = true
    clock.clearInterval(timer)
    doc?.removeEventListener?.('visibilitychange', refresh)
  }
}

/**
 * Own the palette marker and the hero scene for the client lifetime.
 * Returns the teardown used by `ctx.effect`.
 */
export function installPalette(ctx, options = {}) {
  const doc = options.document ?? globalThis.document
  const root = options.root ?? doc?.documentElement
  const form = options.form ?? findScopedForm(ctx, 'theme').form
  const read = () => (options.readPalette ?? readPalette)(form)
  const Observer = options.MutationObserver ?? globalThis.MutationObserver

  let queued = false
  let active = true
  let mountedHero = null
  const render = () => {
    if (!active) return
    const palette = read()
    applyPalette(palette, root)
    const hero = doc?.querySelector?.(options.heroSelector ?? HERO_SELECTOR) ?? null
    if (mountedHero !== hero) {
      for (const scene of scenesIn(mountedHero)) scene.remove()
      mountedHero = hero
    }
    // Settings thumbnails own their scenes; only clean up the main hero we mounted.
    if (!hero) return
    const wanted = paletteSceneFactory(palette)
    if (!wanted) {
      for (const scene of scenesIn(hero)) scene.remove()
      return
    }
    const current = scenesIn(hero).find((scene) => scene.dataset?.skScene === palette)
    if (current) {
      for (const scene of scenesIn(hero)) if (scene !== current) scene.remove()
      return
    }
    mountPaletteScene(hero, palette)
  }
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; render() })
  }

  let observer
  if (doc?.body && typeof Observer === 'function') {
    observer = new Observer(schedule)
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-phase', 'data-content-phase'],
    })
  }
  const off = typeof form?.subscribe === 'function' ? form.subscribe(schedule) : undefined
  render()

  return () => {
    active = false
    off?.()
    observer?.disconnect()
    root?.removeAttribute?.(PALETTE_ATTR)
    for (const scene of scenesIn(mountedHero)) scene.remove()
    mountedHero = null
  }
}
