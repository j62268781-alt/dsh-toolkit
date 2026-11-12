import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

// Both modules are browser entries; `rail.js` also imports an SVG asset, so they
// ride through esbuild the same way the client build ships them.
async function load(entry) {
  const bundle = await build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm',
    loader: { '.svg': 'text' }, write: false, logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
}
const { installRailTitles } = await load('src/modules/theme/client/rail.js')
const { installRailUnpin } = await load('src/modules/theme/client/rail-unpin.js')

const entry = (markup) => `<div class="kB3qhq_panelEntry kB3qhq_panelEntryWide">${markup}</div>`

function page(t) {
  const dom = new JSDOM(`<!doctype html><html data-sk-palette="codex" data-sk-codex-shell><body>
    <aside data-slot="sidebar"><div class="_root_test">
      <div class="_panelList_test">
        ${entry('<button class="_panelRow_test" title="插件"><span class="_panelTitle_test">插件</span></button>')}
        ${entry('<button class="_panelRow_test"><span class="_panelTitle_test">自动化任务</span></button><button class="_panelUnpin_test" aria-label="从侧边栏取消固定自动化任务"></button>')}
      </div>
    </div></aside>
  </body></html>`)
  const previous = new Map()
  const globals = {
    window: dom.window, document: dom.window.document, Element: dom.window.Element,
    Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: (run) => setTimeout(run, 0), cancelAnimationFrame: (id) => clearTimeout(id),
  }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const dispose = installRailUnpin()
  t.after(() => {
    dispose()
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const document = dom.window.document
  const [plain, pinnable] = [...document.querySelectorAll('._panelRow_test')]
  return { dom, document, plain, pinnable }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

test('only entries that offer unpinning are marked, and they lose the native title', async (t) => {
  const { document, plain, pinnable } = page(t)
  await settle()
  const entries = [...document.querySelectorAll('.kB3qhq_panelEntry')]
  assert.equal(entries[0].hasAttribute('data-sk-unpinnable'), false, 'a plain panel keeps the native tooltip')
  assert.equal(entries[1].hasAttribute('data-sk-unpinnable'), true)

  const disposeTitles = installRailTitles()
  t.after(disposeTitles)
  await settle()
  assert.equal(plain.getAttribute('title'), '插件')
  assert.equal(pinnable.hasAttribute('title'), false, 'the dark hint owns the pinned row')
})

test('hovering a pinnable entry shows the dark hint after a short delay', async (t) => {
  const { dom, document, pinnable } = page(t)
  await settle()
  const { MouseEvent } = dom.window
  pinnable.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  assert.equal(document.querySelector('.sk-tip'), null, 'the hint waits for the delay')
  await new Promise((resolve) => setTimeout(resolve, 520))
  const tip = document.querySelector('.sk-tip')
  assert.ok(tip, 'the hint appears on hover')
  assert.equal(tip.hidden, false)
  assert.match(tip.textContent, /自动化任务/)
  assert.match(tip.textContent, /双击取消固定/)

  pinnable.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
  assert.equal(tip.hidden, true, 'leaving the entry hides the hint')
})

test('a double click forwards to the hidden unpin button', async (t) => {
  const { dom, document, pinnable } = page(t)
  await settle()
  const unpin = document.querySelector('._panelUnpin_test')
  let clicks = 0
  unpin.addEventListener('click', () => { clicks += 1 })
  pinnable.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
  assert.equal(clicks, 1)
})
