/** Settings navigation behavior against native rows and a live slot/locale registry. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { installSettingsNav } from '../../src/modules/theme/client/settings-nav.js'

function page(t, html) {
  const dom = new JSDOM(html)
  const original = new Map()
  const cleanup = []
  const slotListeners = new Set()
  const localeListeners = new Set()
  const entries = [
    { options: { id: 'account', order: 0, label: '账号与余额' } },
    { options: { id: 'skills-mcp', order: 1, label: 'Skills & MCP' } },
    { options: { id: 'notification', order: 2, label: '通知' } },
  ]
  const ctx = {
    slots: {
      entries(name) { return name === 'settings.section' ? entries : [] },
      subscribe(name, listener) {
        if (name !== 'settings.section') return () => {}
        slotListeners.add(listener)
        return () => slotListeners.delete(listener)
      },
    },
    locale: {
      subscribe(listener) {
        localeListeners.add(listener)
        return () => localeListeners.delete(listener)
      },
    },
  }
  const values = {
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
  }
  for (const [name, value] of Object.entries(values)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  t.after(() => {
    for (const dispose of cleanup.reverse()) dispose()
    dom.window.close()
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return {
    document: dom.window.document,
    ctx,
    entries,
    slotListeners,
    localeListeners,
    notifySlots() { for (const listener of [...slotListeners]) listener() },
    notifyLocale() { for (const listener of [...localeListeners]) listener() },
    onCleanup(dispose) { cleanup.push(dispose) },
    async flush() {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

const PANEL_HTML = `<html><body>
  <div data-shortcut-modal="settings">
    <nav class="_AnXs9G_nav">
      <div class="_AnXs9G_navTitle">设置</div>
      <div class="_AnXs9G_navList">
        <button class="_AnXs9G_navCell _AnXs9G_active">账号与余额</button>
        <button class="_AnXs9G_navCell">Skills &amp; MCP</button>
        <button class="_AnXs9G_navCell">通知</button>
      </div>
    </nav>
  </div>
</body></html>`

test('settings nav block inserts above the native rows and filters them', async (t) => {
  const { document, flush, onCleanup } = page(t, PANEL_HTML)
  const panel = document.querySelector('[data-shortcut-modal="settings"]')
  const nav = panel.querySelector('nav')
  const dispose = installSettingsNav()
  onCleanup(dispose)
  await flush()

  const block = nav.querySelector('[data-sk-setnav]')
  assert.ok(block, 'the block is inserted into the native nav')
  assert.equal(nav.firstElementChild, block, 'it sits above the native title and rows')
  const back = panel.querySelector('.sk-setnav__back')
  assert.equal(back.parentElement, panel, 'the titlebar button stays inside the modal focus trap')
  assert.equal(back.getAttribute('aria-label'), '返回应用')
  assert.equal(back.textContent.trim(), '', 'the toolbar button is icon only')
  assert.ok(back.querySelector('svg[aria-hidden="true"]'))
  assert.ok(panel.hasAttribute('data-sk-settings-toolbar'))
  assert.equal(block.querySelector('.sk-setnav__back'), null, 'the sidebar has no duplicate back row')
  assert.equal(block.querySelector('.sk-setnav__input').placeholder, '搜索设置')

  const cells = () => [...nav.querySelectorAll('[class*="_navCell"]')]
  const visible = () => cells().filter((cell) => cell.style.display !== 'none').map((cell) => cell.textContent.trim())
  const input = block.querySelector('.sk-setnav__input')

  input.value = '通知'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.deepEqual(visible(), ['通知'], 'search keeps only matching rows')
  const empty = nav.querySelector('.sk-setnav__empty')
  assert.ok(empty.hidden, 'the stable hint is hidden while a row matches')

  input.value = '不存在的设置'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.deepEqual(visible(), [])
  assert.equal(nav.querySelector('.sk-setnav__empty'), empty)
  assert.equal(empty.textContent, '没有匹配的设置')
  assert.equal(empty.hidden, false)

  input.value = ''
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(visible().length, 3, 'clearing the query restores every row')
  assert.equal(nav.querySelector('.sk-setnav__empty'), empty)
  assert.equal(empty.hidden, true)
})

test('settings nav back button uses the native Escape close path and teardown is clean', async (t) => {
  const { document, flush, onCleanup } = page(t, PANEL_HTML)
  const keys = []
  document.addEventListener('keydown', (event) => keys.push(event.key))
  const dispose = installSettingsNav()
  onCleanup(dispose)
  await flush()

  document.querySelector('.sk-setnav__back').click()
  assert.deepEqual(keys, ['Escape'], 'the back row closes through the native shortcut, not a custom callback')

  const nav = document.querySelector('[data-shortcut-modal="settings"] nav')
  assert.ok(nav.querySelector('[data-sk-setnav]'))
  dispose()
  assert.equal(document.querySelector('[data-sk-setnav]'), null, 'disposing removes the injected block')
  assert.equal(document.querySelector('.sk-setnav__back'), null, 'disposing removes the toolbar button')
  assert.equal(document.querySelector('[data-sk-settings-toolbar]'), null, 'native close can return after teardown')
})

test('settings toolbar remounts once after a native panel is replaced', async (t) => {
  const { document, flush, onCleanup } = page(t, PANEL_HTML)
  onCleanup(installSettingsNav())
  await flush()
  const previous = document.querySelector('[data-shortcut-modal="settings"]')
  const next = previous.cloneNode(true)
  next.querySelector('[data-sk-setnav]').remove()
  next.querySelector('.sk-setnav__back').remove()
  next.querySelectorAll('.sk-setnav__groups, .sk-setnav__empty').forEach((node) => node.remove())
  previous.replaceWith(next)
  await flush()
  assert.equal(document.querySelectorAll('.sk-setnav__back').length, 1)
  assert.equal(document.querySelectorAll('[data-sk-setnav]').length, 1)
  assert.equal(next.querySelector('.sk-setnav__back').parentElement, next)
})
test('grouped menu keeps React rows in place and orders by stable settings identity', async (t) => {
  const { document, ctx, entries, flush, onCleanup } = page(t, PANEL_HTML)
  const nav = document.querySelector('nav')
  const list = nav.querySelector('._AnXs9G_navList')
  entries[2].options.label = '自定义提示'
  list.lastElementChild.textContent = '自定义提示'
  list.firstElementChild.setAttribute('aria-current', 'true')
  const originals = [...list.children]
  const clicks = []
  originals.forEach((cell) => cell.addEventListener('click', () => {
    clicks.push(cell.textContent.trim())
    originals.forEach((row) => row.removeAttribute('aria-current'))
    cell.setAttribute('aria-current', 'true')
  }))
  onCleanup(installSettingsNav(ctx))
  await flush()

  const grouped = nav.querySelector('.sk-setnav__groups')
  assert.equal(nav.getAttribute('data-sk-settings-grouped'), '')
  assert.deepEqual([...list.children], originals, 'native React-owned rows stay in their original list')
  const labels = [...grouped.querySelectorAll('.sk-setnav__item span')].map((node) => node.textContent)
  assert.deepEqual(labels, ['账号与余额', '自定义提示', 'Skills & MCP'], 'group ordering places notification in basic settings ahead of tools')
  assert.equal(grouped.querySelector('[data-settings-id="notification"]').closest('section').getAttribute('aria-label'), '基础设置')
  assert.equal(grouped.querySelector('[data-settings-id="account"]').getAttribute('aria-current'), 'true')

  grouped.querySelector('[data-settings-id="notification"]').click()
  await flush()
  assert.deepEqual(clicks, ['自定义提示'], 'grouped item forwards to its native counterpart')
  assert.equal(grouped.querySelector('[data-settings-id="notification"]').getAttribute('aria-current'), 'true')
  assert.equal(grouped.querySelector('[data-settings-id="account"]').hasAttribute('aria-current'), false)
  originals[1].click()
  await flush()
  assert.equal(grouped.querySelector('[data-settings-id="skills-mcp"]').getAttribute('aria-current'), 'true')
  assert.equal(grouped.querySelector('[data-settings-id="notification"]').hasAttribute('aria-current'), false)
  assert.ok(originals.every((cell, index) => list.children[index] === cell), 'selection never replaces or moves native rows')
})

test('unknown slot IDs use the fallback group and search hides empty sections', async (t) => {
  const { document, ctx, entries, flush, onCleanup } = page(t, PANEL_HTML)
  entries.push({ options: { id: 'third-party-panel', order: 3, label: '第三方控制' } })
  const list = document.querySelector('._AnXs9G_navList')
  const custom = document.createElement('button')
  custom.className = '_AnXs9G_navCell'
  custom.textContent = '第三方控制'
  list.append(custom)
  onCleanup(installSettingsNav(ctx))
  await flush()

  const nav = document.querySelector('nav')
  const menu = nav.querySelector('.sk-setnav__groups')
  const fallback = [...menu.querySelectorAll('section')].find((section) => section.getAttribute('aria-label') === '其他设置')
  assert.ok(fallback?.querySelector('[data-settings-id="third-party-panel"]'))
  const input = nav.querySelector('.sk-setnav__input')
  input.value = '通知'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(fallback.hidden, true, 'sections with no visible match are hidden')
  assert.equal([...menu.querySelectorAll('section')].find((section) => section.getAttribute('aria-label') === '基础设置').hidden, false)
})

test('slot and locale subscriptions update active search results and unsubscribe on dispose', async (t) => {
  const { document, ctx, entries, slotListeners, localeListeners, notifySlots, notifyLocale, flush, onCleanup } = page(t, PANEL_HTML)
  const dispose = installSettingsNav(ctx)
  onCleanup(dispose)
  assert.equal(slotListeners.size, 1)
  assert.equal(localeListeners.size, 1)
  await flush()
  const nav = document.querySelector('nav')
  const input = nav.querySelector('.sk-setnav__input')
  input.value = '扩展'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))

  const list = nav.querySelector('._AnXs9G_navList')
  const pluginCell = document.createElement('button')
  pluginCell.className = '_AnXs9G_navCell'
  pluginCell.textContent = '扩展中心'
  list.append(pluginCell)
  entries.push({ options: { id: 'plugin-center', order: 3, label: '扩展中心' } })
  notifySlots()
  assert.equal(nav.querySelector('[data-settings-id="plugin-center"]').hidden, false, 'slot subscription immediately filters the inserted row against the active query')
  await flush()
  assert.equal(nav.querySelector('.sk-setnav__empty').hidden, true)

  entries.pop()
  pluginCell.remove()
  notifySlots()
  await flush()
  assert.equal(nav.querySelector('[data-settings-id="plugin-center"]'), null, 'removed slot is removed from the rendered menu')
  assert.equal(nav.querySelector('.sk-setnav__empty').hidden, false)

  input.value = '账户'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(nav.querySelector('[data-settings-id="account"]').hidden, true)
  const translated = '账户余额'
  entries[0].options.label = () => translated
  list.children[0].textContent = translated
  notifyLocale()
  assert.equal(nav.querySelector('[data-settings-id="account"] span').textContent, translated, 'locale subscription updates before observer delivery')
  assert.equal(nav.querySelector('[data-settings-id="account"]').hidden, false, 'translated labels are searched using the current query')
  assert.equal(nav.querySelector('.sk-setnav__empty').hidden, true)
  await flush()

  dispose()
  assert.equal(slotListeners.size, 0)
  assert.equal(localeListeners.size, 0)
  assert.equal(nav.hasAttribute('data-sk-settings-grouped'), false)
  assert.equal(nav.querySelector('.sk-setnav__groups'), null)
  assert.equal(nav.querySelector('.sk-setnav__empty'), null)
  assert.ok([...list.children].every((cell) => cell.style.display === ''))
  list.lastElementChild.textContent = '卸载后变更'
  notifySlots()
  notifyLocale()
  await flush()
  assert.equal(nav.querySelector('[data-sk-setnav]'), null, 'native mutations do not remount after disposal')
})

test('search returns focus from a newly hidden grouped item to the search field', async (t) => {
  const { document, ctx, flush, onCleanup } = page(t, PANEL_HTML)
  onCleanup(installSettingsNav(ctx))
  await flush()
  const nav = document.querySelector('nav')
  const input = nav.querySelector('.sk-setnav__input')
  const item = nav.querySelector('[data-settings-id="account"]')
  item.focus()
  input.value = '通知'
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(document.activeElement, input, 'keyboard focus remains in the active search field')
  assert.equal(item.hidden, true)
})
