/** Settings motion preserves native modal lifetime and animates only a disposable exit copy. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createSettingsMotion } from '../../src/modules/theme/client/settings-motion.ts'

const FRAMES = [
  { transform: 'translateY(100%)', opacity: 0 },
  { transform: 'translateY(0)', opacity: 1 },
]

function page(t, { reducedMotion = false } = {}) {
  const dom = new JSDOM(`<html><body>
    <button id="settings-trigger">Open settings</button>
    <div id="settings-overlay" class="_AnXs9G_overlay extra" role="presentation">
      <section id="settings-panel" data-shortcut-modal="settings" role="dialog" aria-modal="true">
        <label id="search-label" for="settings-search">Search settings</label>
        <input id="settings-search" aria-labelledby="search-label" value="Appearance">
        <button id="settings-close" type="button">Close</button>
        <a id="settings-link" href="#appearance">Appearance</a>
      </section>
    </div>
  </body></html>`)
  const originals = new Map()
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const animations = []
  const mediaQueries = []
  dom.window.matchMedia = (query) => {
    mediaQueries.push(query)
    return { matches: reducedMotion, media: query }
  }
  dom.window.Element.prototype.animate = function (keyframes, options) {
    const animation = {
      target: this,
      keyframes,
      options,
      cancelCount: 0,
      onfinish: null,
      oncancel: null,
      finish() { this.onfinish?.({ target: this }) },
      cancel() {
        this.cancelCount += 1
        this.oncancel?.({ target: this })
      },
    }
    animations.push(animation)
    return animation
  }
  const document = dom.window.document
  const overlay = document.querySelector('._AnXs9G_overlay')
  const panel = document.querySelector('[data-shortcut-modal="settings"]')
  const trigger = document.querySelector('#settings-trigger')
  const input = document.querySelector('#settings-search')
  const motion = createSettingsMotion()
  t.after(() => {
    motion.dispose()
    dom.window.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return {
    document, overlay, panel, trigger, input, motion, animations, mediaQueries,
    copies: () => [...document.querySelectorAll('[data-sk-settings-exit]')],
    setReducedMotion(value) { reducedMotion = value },
    nativeClose() {
      overlay.remove()
      trigger.focus()
      motion.leave(panel)
    },
  }
}

test('settings enter animates the closest overlay without moving native DOM or focus', (t) => {
  const { document, overlay, panel, input, motion, animations } = page(t)
  const parent = panel.parentNode
  const overlayParent = overlay.parentNode
  input.focus()

  motion.enter(panel)

  assert.equal(animations.length, 1)
  assert.equal(animations[0].target, overlay)
  assert.deepEqual(animations[0].keyframes, FRAMES)
  assert.equal(animations[0].options.duration, 280)
  assert.equal(panel.parentNode, parent)
  assert.equal(overlay.parentNode, overlayParent)
  assert.equal(document.activeElement, input)
  assert.equal(document.querySelectorAll('[data-shortcut-modal="settings"]').length, 1)
})

test('settings leave runs after native removal and keeps restored native focus immediate', (t) => {
  const { document, overlay, panel, trigger, input, motion, animations, copies, nativeClose } = page(t)
  const parent = panel.parentNode
  input.focus()
  motion.enter(panel)
  const opening = animations[0]

  nativeClose()

  assert.equal(overlay.isConnected, false, 'the native overlay remains removed while exit is running')
  assert.equal(panel.isConnected, false)
  assert.equal(panel.parentNode, parent, 'native elements are never reparented into the visual layer')
  assert.equal(document.activeElement, trigger, 'the animation never takes focus from the restored target')
  assert.equal(opening.cancelCount, 1)
  assert.equal(copies().length, 1)
  const closing = animations[1]
  assert.equal(closing.target, copies()[0])
  assert.notEqual(closing.target, overlay)
  assert.deepEqual(closing.keyframes, [...FRAMES].reverse())
  assert.equal(closing.options.duration, 180)
  assert.equal(closing.target.parentNode, document.body)
  assert.equal(closing.target.textContent, overlay.textContent, 'the copy retains the visible content')
})

test('settings exit copy is inert and hidden with no native modal markers, IDs, or roles', (t) => {
  const { document, overlay, panel, input, copies, nativeClose } = page(t)
  const nativeIds = [...overlay.querySelectorAll('[id]')].map((node) => node.id)
  const closeButton = panel.querySelector('button')
  let nativeClicks = 0
  closeButton.addEventListener('click', () => { nativeClicks += 1 })

  nativeClose()

  const [copy] = copies()
  assert.ok(copy)
  assert.equal(copy.inert, true)
  assert.equal(copy.getAttribute('aria-hidden'), 'true')
  assert.equal(copy.style.pointerEvents, 'none')
  for (const selector of ['[id]', '[data-shortcut-modal]', '[role]', '[aria-modal]']) {
    assert.equal(copy.matches(selector), false, `the copy root must not match ${selector}`)
    assert.equal(copy.querySelector(selector), null, `the copy descendants must not match ${selector}`)
  }
  assert.equal(document.querySelector('[data-shortcut-modal]'), null, 'native shortcut discovery sees no modal')
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(new Set([...document.querySelectorAll('[id]')].map((node) => node.id)).size,
    document.querySelectorAll('[id]').length, 'the visual layer introduces no duplicate IDs')
  assert.equal(overlay.id, 'settings-overlay', 'sanitization leaves the detached native DOM intact')
  assert.deepEqual([...overlay.querySelectorAll('[id]')].map((node) => node.id), nativeIds)
  assert.equal(panel.getAttribute('data-shortcut-modal'), 'settings')
  assert.equal(panel.getAttribute('role'), 'dialog')
  assert.equal(input.id, 'settings-search')
  copy.querySelector('button').click()
  assert.equal(nativeClicks, 0, 'cloned controls have no native event listeners')
})

for (const completion of ['finish', 'cancel']) {
  test(`settings exit ${completion} removes its copy without disturbing native focus`, (t) => {
    const { document, trigger, motion, animations, copies, nativeClose } = page(t)
    nativeClose()
    const [copy] = copies()
    const [closing] = animations

    closing[completion]()

    assert.equal(copy.isConnected, false)
    assert.equal(copies().length, 0)
    assert.equal(document.activeElement, trigger)
    const cancelCount = closing.cancelCount
    closing.finish()
    motion.dispose()
    assert.equal(copies().length, 0, 'repeated completion is harmless')
    assert.equal(closing.cancelCount, cancelCount, 'completed exits are no longer tracked for disposal')
  })
}

test('settings reduced motion skips entrance, exit animations, and visual copies', (t) => {
  const { document, panel, trigger, motion, animations, mediaQueries, copies, nativeClose } = page(t, { reducedMotion: true })
  motion.enter(panel)
  nativeClose()

  assert.equal(animations.length, 0)
  assert.equal(copies().length, 0)
  assert.equal(panel.isConnected, false)
  assert.equal(document.activeElement, trigger)
  assert.ok(mediaQueries.length >= 2)
  assert.ok(mediaQueries.every((query) => query === '(prefers-reduced-motion: reduce)'))
})

test('settings leave respects a reduced-motion preference changed after entering', (t) => {
  const { panel, motion, animations, setReducedMotion, copies, nativeClose } = page(t)
  motion.enter(panel)
  setReducedMotion(true)

  nativeClose()

  assert.equal(animations.length, 1)
  assert.equal(animations[0].cancelCount, 1)
  assert.equal(copies().length, 0)
})

test('settings dispose cancels an active entrance without removing the native modal or focus', (t) => {
  const { document, panel, input, motion, animations } = page(t)
  input.focus()
  motion.enter(panel)

  motion.dispose()
  motion.dispose()

  assert.equal(animations[0].cancelCount, 1)
  assert.equal(panel.isConnected, true)
  assert.equal(document.activeElement, input)
})

test('settings dispose cancels an unfinished exit and removes its visual copy', (t) => {
  const { document, trigger, motion, animations, copies, nativeClose } = page(t)
  nativeClose()
  const [copy] = copies()

  motion.dispose()
  motion.dispose()

  assert.equal(animations[0].cancelCount, 1)
  assert.equal(copy.isConnected, false)
  assert.equal(copies().length, 0)
  assert.equal(document.activeElement, trigger)
  animations[0].finish()
  assert.equal(copies().length, 0, 'a late completion cannot restore a disposed copy')
})

test('settings reopening cancels an unfinished exit and preserves the new native panel and focus', (t) => {
  const { document, overlay, panel, input, motion, animations, copies, nativeClose } = page(t)
  nativeClose()
  const [copy] = copies()
  const [closing] = animations
  document.body.append(overlay)
  input.focus()

  motion.enter(panel)

  assert.equal(closing.cancelCount, 1)
  assert.equal(copy.isConnected, false)
  assert.equal(copies().length, 0)
  assert.equal(animations.length, 2)
  assert.equal(animations[1].target, overlay)
  assert.equal(animations[1].options.duration, 280)
  assert.equal(panel.isConnected, true)
  assert.equal(document.activeElement, input)
  closing.finish()
  assert.equal(panel.isConnected, true, 'late exit completion cannot remove the reopened modal')
  assert.equal(document.activeElement, input)
})

test('settings reopening still removes pending exit copies when reduced motion becomes enabled', (t) => {
  const { document, overlay, panel, motion, animations, copies, setReducedMotion, nativeClose } = page(t)
  nativeClose()
  setReducedMotion(true)
  document.body.append(overlay)

  motion.enter(panel)

  assert.equal(copies().length, 0)
  assert.equal(animations.length, 1, 'reopening does not start an animation with reduced motion')
  assert.equal(animations[0].cancelCount, 1)
  assert.equal(panel.isConnected, true)
})
