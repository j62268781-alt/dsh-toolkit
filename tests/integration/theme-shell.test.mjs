import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { installCodexShell } from '../../src/modules/theme/client/shell.ts'
import { installShellMarkers } from '../../src/modules/theme/client/platform.ts'
import { installBandHeight } from '../../src/modules/theme/client/band.ts'
import { installSidebarWidth, installWorkspaceCollapse } from '../../src/modules/theme/client/sidebar.ts'

const railBundle = await build({
  entryPoints: ['src/modules/theme/client/rail.ts'], bundle: true, platform: 'node',
  format: 'esm', loader: { '.svg': 'text' }, write: false, logLevel: 'silent',
})
const { installHomeRail, installRailTitles } = await import(`data:text/javascript;base64,${Buffer.from(railBundle.outputFiles[0].text).toString('base64')}`)

function page(t, palette = 'native', width = 1280) {
  const dom = new JSDOM(`<!doctype html><html data-platform="darwin" data-sk-palette="${palette}"><body>
    <div class="_frame_test" style="grid-template-columns:296px minmax(0, 1fr) 0px">
      <aside data-slot="sidebar"><div class="_root_test">
        <div class="_topStrip_test"><button class="_toggle_test">Toggle</button></div>
        <div class="_panelList_test"><button class="_panelRow_test" title="Original"><span class="_panelTitle_test">Tools</span></button></div>
      </div></aside>
      <main data-slot="main.conversation"><div class="_titleRow_test"></div></main>
      <div class="_handle_test" data-side="sidebar" style="left:296px" role="presentation"></div>
    </div></body></html>`)
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, writable: true, value: width })
  const previous = new Map()
  const frames = new Map()
  const cleanups = []
  let id = 0
  const globals = {
    window: dom.window, document: dom.window.document, Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame(run) { frames.set(++id, run); return id },
    cancelAnimationFrame(key) { frames.delete(key) },
  }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const document = dom.window.document
  document.querySelector('._titleRow_test').getBoundingClientRect = () => ({ bottom: 50 })
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup()
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return {
    document, frames, cleanup: (fn) => cleanups.push(fn),
    resize(next) {
      dom.window.innerWidth = next
      dom.window.dispatchEvent(new dom.window.Event('resize'))
    },
    async flush() {
      for (let turn = 0; turn < 12; turn++) {
        await Promise.resolve()
        const pending = [...frames.values()]
        frames.clear()
        for (const run of pending) run()
      }
      assert.equal(frames.size, 0, 'observers must settle after a palette change')
    },
  }
}

function context(document) {
  const listeners = new Set()
  let activePanelId = null
  return {
    listeners,
    setPanel(id) { activePanelId = id; for (const run of listeners) run() },
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId }),
        subscribe(run) { listeners.add(run); return () => listeners.delete(run) },
      },
      selectPanel(id) { activePanelId = id; for (const run of listeners) run() },
      toggleSidebar() { document.querySelector('._frame_test').toggleAttribute('data-sidebar-collapsed') },
    },
  }
}

const installers = [installRailTitles, installHomeRail, installBandHeight, installSidebarWidth, installWorkspaceCollapse]

test('native, ocean and hope retain native shell; Codex restores all owned DOM on exit and re-entry', async (t) => {
  const { document, flush, cleanup } = page(t)
  const ctx = context(document)
  const root = document.documentElement
  const frame = document.querySelector('._frame_test')
  const sidebar = document.querySelector('._root_test')
  const handle = document.querySelector('[data-side="sidebar"]')
  const row = document.querySelector('._panelRow_test')
  cleanup(installCodexShell(ctx, installers))
  const assertNative = () => {
    assert.match(frame.style.gridTemplateColumns, /^296px/)
    assert.equal(handle.style.left, '296px')
    assert.equal(handle.getAttribute('role'), 'presentation')
    assert.equal(handle.hasAttribute('tabindex'), false)
    assert.equal(frame.hasAttribute('data-sk-workspace-expanded'), false)
    assert.equal(sidebar.hasAttribute('data-sk-rail-only'), false)
    assert.equal(document.querySelector('.sk-home'), null)
    assert.equal(document.querySelector('.sk-collapse-hit'), null)
    assert.equal(row.title, 'Original')
    assert.equal(document.body.style.getPropertyValue('--cx-band-h'), '')
    assert.equal(ctx.listeners.size, 0)
  }
  for (const palette of ['native', 'ocean', 'hope']) {
    root.setAttribute('data-sk-palette', palette)
    await flush()
    assertNative()
  }
  for (const next of ['ocean', 'hope', 'native']) {
    root.setAttribute('data-sk-palette', 'codex')
    await flush()
    assert.match(frame.style.gridTemplateColumns, /^302px/)
    assert.equal(document.querySelectorAll('.sk-home').length, 1)
    assert.equal(document.querySelectorAll('.sk-collapse-hit').length, 1)
    assert.equal(row.title, 'Tools')
    assert.equal(document.body.style.getPropertyValue('--cx-band-h'), '50px')
    assert.equal(ctx.listeners.size, 2)
    document.querySelector('._toggle_test').click()
    await flush()
    assert.match(frame.style.gridTemplateColumns, /^52px/)
    assert.equal(sidebar.hasAttribute('data-sk-rail-only'), true)
    root.setAttribute('data-sk-palette', next)
    await flush()
    assertNative()
    // The native toggle must reach the host after leaving Codex.
    let nativeClicks = 0
    const toggle = document.querySelector('._toggle_test')
    const nativeClick = () => nativeClicks++
    toggle.addEventListener('click', nativeClick)
    toggle.click()
    assert.equal(nativeClicks, 1)
    toggle.removeEventListener('click', nativeClick)
  }
})

test('switching from a rail restores the latest host widths and native custom properties', async (t) => {
  const { document, flush, cleanup } = page(t, 'codex')
  const ctx = context(document)
  document.body.style.setProperty('--cx-band-h', '44px', 'important')
  const dispose = installCodexShell(ctx, installers)
  cleanup(dispose)
  ctx.setPanel('browser')
  await flush()
  const frame = document.querySelector('._frame_test')
  const handle = document.querySelector('[data-side="sidebar"]')
  assert.match(frame.style.gridTemplateColumns, /^52px/)
  frame.style.gridTemplateColumns = '360px minmax(0, 1fr) 200px'
  handle.style.left = '360px'
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^52px/)
  document.documentElement.setAttribute('data-sk-palette', 'hope')
  await flush()
  assert.equal(frame.style.gridTemplateColumns, '360px minmax(0, 1fr) 200px')
  assert.equal(handle.style.left, '360px')
  assert.equal(document.body.style.getPropertyValue('--cx-band-h'), '44px')
  assert.equal(document.body.style.getPropertyPriority('--cx-band-h'), 'important')
  assert.equal(ctx.listeners.size, 0)
})

test('unload before a pending palette mutation prevents Codex from reattaching', async (t) => {
  const { document, flush } = page(t)
  const ctx = context(document)
  const dispose = installCodexShell(ctx, installers)
  document.documentElement.setAttribute('data-sk-palette', 'codex')
  dispose()
  await flush()
  assert.equal(document.querySelector('.sk-home'), null)
  assert.equal(ctx.listeners.size, 0)
})

test('all palettes start at their own minimum while native palettes retain full layout and resizing', async (t) => {
  const { document, flush } = page(t)
  const ctx = context(document)
  const root = document.documentElement
  const frame = document.querySelector('._frame_test')
  const handle = document.querySelector('[data-side="sidebar"]')
  const dispose = installCodexShell(ctx, installers, {
    nativeInstallers: [(ctx) => installSidebarWidth(ctx, { native: true })],
  })
  t.after(dispose)
  const assertNativeLayout = () => {
    assert.equal(document.querySelector('.sk-home'), null)
    assert.equal(document.querySelector('.sk-collapse-hit'), null)
    assert.equal(frame.hasAttribute('data-sk-workspace-expanded'), false)
    assert.equal(document.querySelector('._root_test').hasAttribute('data-sk-rail-only'), false)
    assert.equal(document.querySelector('._panelRow_test').title, 'Original')
    assert.equal(document.body.style.getPropertyValue('--cx-band-h'), '')
  }
  assert.match(frame.style.gridTemplateColumns, /^296px/, 'native palettes mirror the host column instead of forcing a minimum')
  assert.equal(handle.style.left, '296px', 'the host keeps ownership of the handle position')
  assert.equal(handle.getAttribute('aria-valuemin'), '264')
  assert.equal(handle.getAttribute('aria-valuemax'), '420')
  assertNativeLayout()
  const pointer = (type, x) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    handle.dispatchEvent(event)
  }
  let hostDrag = null
  let hostWidth = 280
  const hostEvents = []
  const onHostPointer = (event) => {
    hostEvents.push(event.type)
    assert.equal(event.defaultPrevented, false, 'native drag reaches the host without cancellation')
    if (event.type === 'pointerdown') hostDrag = { x: event.clientX, width: hostWidth }
    else if (hostDrag) {
      hostWidth = Math.max(264, Math.min(420, hostDrag.width + event.clientX - hostDrag.x))
      frame.style.gridTemplateColumns = `${hostWidth}px minmax(0, 1fr) 200px`
      handle.style.left = `${hostWidth}px`
      if (event.type === 'pointerup') hostDrag = null
    }
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) handle.addEventListener(type, onHostPointer)
  pointer('pointerdown', 264)
  pointer('pointermove', 274)
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^290px/, 'native host drag updates the grid')
  pointer('pointerup', 334)
  await flush()
  assert.deepEqual(hostEvents, ['pointerdown', 'pointermove', 'pointerup'])
  assert.match(frame.style.gridTemplateColumns, /^350px/)
  // Once resized, native host width updates are authoritative.
  frame.style.gridTemplateColumns = '360px minmax(0, 1fr) 200px'
  handle.style.left = '360px'
  await flush()
  assert.equal(frame.style.gridTemplateColumns, '360px minmax(0, 1fr) 200px')
  assert.equal(handle.style.left, '360px')
  for (const palette of ['ocean', 'hope', 'native']) {
    root.setAttribute('data-sk-palette', palette)
    ctx.setPanel('browser')
    await flush()
    assert.match(frame.style.gridTemplateColumns, /^360px/, 'native-based palette changes retain a dragged width')
    assertNativeLayout()
  }
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.style.gridTemplateColumns = '0px minmax(0, 1fr) 200px'
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^0px/)
  frame.removeAttribute('data-sidebar-collapsed')
  frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 200px'
  handle.style.left = '280px'
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^280px/, 'native reopen accepts the host width after user resizing')
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  assert.match(frame.style.gridTemplateColumns, /^420px/)
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  assert.match(frame.style.gridTemplateColumns, /^264px/)
  ctx.setPanel(null)
  for (const palette of ['native', 'ocean', 'hope']) {
    root.setAttribute('data-sk-palette', 'codex')
    await flush()
    assert.match(frame.style.gridTemplateColumns, /^302px/, 'Codex minimum includes its 52px rail')
    assert.equal(handle.getAttribute('aria-valuemin'), '250')
    root.setAttribute('data-sk-palette', palette)
    await flush()
    // The host owns the column: its next layout pass writes the stored width back
    // and native palettes must follow it instead of snapping to the 264px minimum.
    frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 200px'
    handle.style.left = '280px'
    await flush()
    assert.match(frame.style.gridTemplateColumns, /^280px/, `${palette} follows the host column after leaving Codex`)
    assertNativeLayout()
  }
  dispose()
  await flush()
  assert.equal(frame.style.gridTemplateColumns, '280px minmax(0, 1fr) 200px')
  assert.equal(handle.style.left, '280px')
  assert.equal(handle.getAttribute('role'), 'presentation')
  assert.equal(handle.hasAttribute('tabindex'), false)
  let nativeDrags = 0
  handle.addEventListener('pointerdown', () => nativeDrags++)
  pointer('pointerdown', 280)
  assert.equal(nativeDrags, 1, 'unload returns drag events to the host')
})

test('native minimum follows late Windows desktop markers and a late-mounted frame', async (t) => {
  const { document, flush, cleanup } = page(t)
  const frame = document.querySelector('._frame_test')
  frame.remove()
  document.documentElement.removeAttribute('data-platform')
  cleanup(installSidebarWidth(context(document), { native: true }))
  document.body.append(frame)
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^296px/, 'ordinary Web layout remains untouched')
  document.documentElement.setAttribute('data-windows-titlebar', '')
  await flush()
  assert.match(frame.style.gridTemplateColumns, /^296px/, 'a late desktop marker adopts the host column as-is')
  assert.equal(document.querySelector('[data-side="sidebar"]').style.left, '296px')
  assert.equal(frame.hasAttribute('data-sk-workspace-expanded'), false)
})

function selectorList(text) {
  const result = []
  let start = 0
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if ('[('.includes(text[i])) depth++
    else if ('])'.includes(text[i])) depth--
    else if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1 }
  }
  result.push(text.slice(start).trim())
  return result
}

test('the Windows content radius is switched off for every palette, not just Codex', async () => {
  // The host spends `--dsh-windows-content-radius` on the center column and on a
  // fullscreen right panel. Codex zeroes it for its inset card; every other palette
  // would otherwise inherit the host's 16px and show a lone rounded corner.
  const css = await readFile(new URL('../../src/modules/theme/client/styles/corners.css', import.meta.url), 'utf8')
  assert.match(css, /html\[data-windows-titlebar\]\s*\[class\*="_frame"\]\s*\{[^}]*--dsh-windows-content-radius:\s*0px/)
  // It must reach the frame node itself: the host declares the variable there, so a
  // declaration on `body` would never be inherited by the frame.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /body\s*\{[^}]*--dsh-windows-content-radius/)
  const imports = await readFile(new URL('../../src/modules/theme/client/styles.css', import.meta.url), 'utf8')
  assert.match(imports, /@import "\.\/styles\/corners\.css"/, 'corners.css must be bundled with the theme')
})

test('a wide browser tab gets the Codex shell, a narrow one keeps the host layout', async (t) => {
  // The host serves this same client into a browser, where `data-platform` is never
  // set and the sidebar becomes a drawer below 768px. A wide tab still has a real
  // sidebar column to draw the rail in, so the shell applies there; narrower tabs
  // keep the host layout instead of having the shell grafted onto a drawer.
  const { document, flush, cleanup, resize } = page(t, 'codex', 1000)
  const ctx = context(document)
  const root = document.documentElement
  const frame = document.querySelector('._frame_test')
  root.removeAttribute('data-platform')
  cleanup(installShellMarkers())
  cleanup(installCodexShell(ctx, installers))
  await flush()
  const assertNative = () => {
    assert.match(frame.style.gridTemplateColumns, /^296px/)
    assert.equal(frame.hasAttribute('data-sk-workspace-expanded'), false)
    assert.equal(document.querySelector('.sk-home'), null)
    assert.equal(document.querySelector('.sk-collapse-hit'), null)
    assert.equal(document.body.style.getPropertyValue('--cx-band-h'), '')
    assert.equal(ctx.listeners.size, 0)
  }
  const assertShell = (band = '') => {
    assert.match(frame.style.gridTemplateColumns, /^302px/)
    assert.equal(document.querySelectorAll('.sk-home').length, 1)
    assert.equal(document.querySelectorAll('.sk-collapse-hit').length, 1)
    // The band is measured from the host title row on macOS; a browser tab has no
    // title row, so the 50px comes from the token floor in tokens.css instead.
    assert.equal(document.body.style.getPropertyValue('--cx-band-h'), band)
  }
  assertNative()
  assert.equal(root.hasAttribute('data-sk-codex-shell'), false)
  // Growing past the host's own auto-collapse breakpoint applies the shell
  // without a reload.
  resize(1280)
  await flush()
  assert.equal(root.hasAttribute('data-sk-codex-shell'), true)
  assert.equal(root.hasAttribute('data-sk-desktop'), false)
  assertShell()
  // Back below the breakpoint the host layout returns.
  resize(1023)
  await flush()
  assert.equal(root.hasAttribute('data-sk-codex-shell'), false)
  assertNative()
  // The desktop app measures its own title band, but the shell still needs the
  // host's expanded sidebar column, so the same 1024px gate applies there.
  root.setAttribute('data-platform', 'darwin')
  resize(1280)
  await flush()
  assert.equal(root.hasAttribute('data-sk-desktop'), true)
  assertShell('50px')
  resize(900)
  await flush()
  assert.equal(root.hasAttribute('data-sk-codex-shell'), false)
  assertNative()
  root.removeAttribute('data-platform')
  await flush()
  assertNative()
})

test('every shell, sidebar, rightbar and radius selector requires the Codex palette', async () => {
  // The three shell files also need a shell marker (`data-sk-codex-shell` or a platform
  // attribute): the shell needs a sidebar column to draw the rail in, and the host
  // hands the sidebar to its drawer in narrow windows, where a grafted shell pushes
  // the default buttons out of alignment.
  const structural = new Set(['layout.css', 'sidebar.css', 'rightbar.css'])
  for (const file of ['tokens.css', 'layout.css', 'sidebar.css', 'rightbar.css']) {
    const css = await readFile(new URL(`../../src/modules/theme/client/styles/${file}`, import.meta.url), 'utf8')
    const dom = new JSDOM('<!doctype html><head></head><body></body>')
    const style = dom.window.document.createElement('style')
    style.textContent = css
    dom.window.document.head.append(style)
    assert.ok(style.sheet.cssRules.length > 0, file)
    for (const rule of style.sheet.cssRules) {
      // 全局 @keyframes 没有选择器：codex 皮肤自己的动画统一用 cx- 前缀，
      // 既不外泄到宿主，也不会和宿主的动画名撞车。
      if (rule.constructor.name === 'CSSKeyframesRule') {
        assert.match(rule.name, /^cx-/, `${file}: keyframes ${rule.name}`)
        continue
      }
      assert.ok(rule.selectorText, 'shell styles should remain plain scoped rules')
      for (const selector of selectorList(rule.selectorText)) {
        assert.ok(selector.startsWith('html[data-sk-palette="codex"]'), `${file}: ${selector}`)
        if (!structural.has(file)) continue
        assert.match(
          selector,
          /\[data-sk-codex-shell\]|\[data-platform="darwin"\]|\[data-windows-titlebar\]/,
          `${file}: a shell selector must also require a desktop marker: ${selector}`,
        )
      }
    }
    dom.window.close()
  }
})

test('the empty sidebar footer slot hands its row back to the workspace tree', async () => {
  // `sidebar.footer.action` is optional and DSH 0.2.1-rc.5 left it empty; the grid
  // still reserves the `foot` row, which painted a blank band under the tree.
  const css = await readFile(new URL('../../src/modules/theme/client/styles/sidebar.css', import.meta.url), 'utf8')
  const emptySlot = /html\[data-sk-palette="codex"\][^{]*:not\(:has\(> \[class\*="_footArea"\] > \[class\*="_footerActions"\] :not\(:empty\)\)\)[^{]*\{\s*([^}]*)\}/g
  const rules = [...css.matchAll(emptySlot)]
  const declarations = rules.map(rule => rule[1])
  assert.ok(
    declarations.some(block => /grid-template-areas:\s*"nav\s+brand"\s*"nav\s+new"\s*"nav\s+region"\s*"account\s+region"/.test(block)),
    'the workspace tree takes the empty foot row'
  )
  assert.ok(
    declarations.some(block => /position:\s*absolute/.test(block)),
    'the empty footer actions leave the grid flow instead of holding the row'
  )
  assert.ok(
    declarations.some(block => /padding-bottom:\s*var\(--cx-gap,\s*4px\)/.test(block)),
    'the tree stops at the rounded card edge'
  )
  for (const rule of rules) {
    // Rail mode and the collapsed sidebar already hide or re-flow the footer.
    assert.match(rule[0], /:not\(\[class\*="_collapsed"\]\)/)
    assert.match(rule[0], /:not\(\[data-sk-rail-only\]\)/)
  }
})

test('the rc.2 scroll wrapper is flattened back into the rail grid', async () => {
  // DSH 0.2.2-rc.2 put `_panelList` and `_regionArea` inside
  // `_scrollRegion > _scrollArea`. Both carry the shell's grid areas, so the
  // wrappers have to leave the flow or the rail and the tree lose their cells.
  const css = await readFile(new URL('../../src/modules/theme/client/styles/sidebar.css', import.meta.url), 'utf8')
  const flatten = css.match(
    /html\[data-sk-palette="codex"\]\[data-sk-codex-shell\][^{]*_scrollRegion[^{]*\{\s*display:\s*contents;/
  )
  assert.ok(flatten, 'the scroll region dissolves into the root grid')
  assert.match(css, /_scrollArea[^{]*\{\s*display:\s*contents;/, 'the scroll area dissolves too')
  assert.match(css, /_scrollFade[^{]*\{\s*display:\s*none;/, 'the native fade strip is dropped')
})

test('the rc.2 conversation tabs sit on the toolbar baseline', async () => {
  // rc.2 gives the tab a -10px top margin so its hit area reaches into the title
  // row. The shell turns the tab row into a 37px toolbar, so that margin lifts the
  // label off the "…" button and leaves the 2px underline floating above the
  // header's bottom border. Clearing it puts both back on the toolbar baseline.
  const css = await readFile(new URL('../../src/modules/theme/client/styles/layout.css', import.meta.url), 'utf8')
  const tab = css.match(/[^{]*_tab"\]\[role="tab"\][^{]*\{([^}]*)\}/)
  assert.ok(tab, 'the tab rule is present')
  assert.match(tab[1], /min-height:\s*37px;/, 'the tab fills the toolbar row')
  assert.match(tab[1], /margin-top:\s*0;/, 'the host hit-area margin is dropped')
  assert.match(tab[1], /align-items:\s*center;/, 'the label centres in the row')
  assert.match(css, /_tabs"[^{]*\{[^}]*align-items:\s*center;/, 'the tab row centres its items')
})
