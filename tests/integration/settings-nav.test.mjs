/** Settings navigation behavior against native rows and a live slot/locale registry. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { installSettingsNav } from '../../src/modules/theme/client/settings-nav.ts'

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
    window: dom.window,
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
  assert.equal(document.querySelectorAll('.sk-setnav__toggle').length, 1, 'the cloned panel does not keep a stale toggle')
  assert.equal(document.querySelectorAll('.sk-setnav__scrim').length, 1, 'the cloned panel does not keep a stale scrim')
  assert.equal(next.querySelector('.sk-setnav__back').parentElement, next)
})
test('grouped menu keeps React rows in place and orders by stable settings identity', async (t) => {
  const { document, ctx, entries, flush, onCleanup } = page(t, PANEL_HTML)
  const nav = document.querySelector('nav')
  const list = nav.querySelector('._AnXs9G_navList')
  entries[2].options.label = '自定义提示'
  list.lastElementChild.textContent = '自定义提示'
  list.firstElementChild.setAttribute('aria-current', 'true')
  for (const [id, label] of [['theme', '外观'], ['boot', '启动动画'], ['general', '通用']]) {
    entries.push({ options: { id, label, order: entries.length } })
    const cell = document.createElement('button')
    cell.className = '_AnXs9G_navCell'
    cell.textContent = label
    list.append(cell)
  }
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
  assert.deepEqual(labels, ['账号与余额', '通用', '外观', '启动动画', '自定义提示', 'Skills & MCP'], 'the default account page leads basic settings, followed by general, appearance, boot and notification')
  assert.equal(grouped.querySelector('[data-settings-id="notification"]').closest('section').getAttribute('aria-label'), '个人')
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
  assert.equal([...menu.querySelectorAll('section')].find((section) => section.getAttribute('aria-label') === '个人').hidden, false)
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

test('sections group like the Qoder menu: 个人 / 集成 / 连接 / 归档管理', async (t) => {
  const { document, ctx, entries, flush, onCleanup } = page(t, PANEL_HTML)
  const list = document.querySelector('._AnXs9G_navList')
  // 用一份覆盖全部模块的注册表替换默认三行，断言的是真实 id 的分组结果。
  entries.length = 0
  list.replaceChildren()
  const rows = [
    ['account', '账号与余额'], ['general', '通用'], ['theme', '外观'], ['boot', '启动动画'],
    ['desktop-pet', '桌面宠物'], ['notification', '通知'], ['models', '模型'],
    ['plugins', '扩展管理'], ['agent-presets', '智能体'], ['skills-mcp', 'Skills & MCP'],
    ['judgment', '决策'], ['hooks', '钩子'],
    ['mobile', '移动端'], ['archived-chats', '已归档的会话'],
  ]
  rows.forEach(([id, label], index) => {
    entries.push({ options: { id, order: index, label } })
    const cell = document.createElement('button')
    cell.className = '_AnXs9G_navCell'
    cell.textContent = label
    list.append(cell)
  })
  onCleanup(installSettingsNav(ctx))
  await flush()

  const menu = document.querySelector('.sk-setnav__groups')
  assert.deepEqual(
    [...menu.querySelectorAll('.sk-setnav__heading')].map((node) => node.textContent),
    ['个人', '集成', '连接', '归档管理'],
    'groups follow the Qoder menu order and empty groups are skipped',
  )
  const idsIn = (title) => [...menu.querySelector(`section[aria-label="${title}"]`).querySelectorAll('[data-settings-id]')]
    .map((node) => node.getAttribute('data-settings-id'))
  assert.deepEqual(idsIn('个人'), ['account', 'general', 'theme', 'boot', 'desktop-pet', 'notification', 'models'])
  assert.deepEqual(idsIn('集成'), ['plugins', 'agent-presets', 'skills-mcp', 'judgment', 'hooks'])
  assert.deepEqual(idsIn('连接'), ['mobile'])
  assert.deepEqual(idsIn('归档管理'), ['archived-chats'])
})
test('narrow windows collapse the settings nav into a drawer at the workspace breakpoint', async (t) => {
  const { window, document, ctx, flush, onCleanup } = page(t, PANEL_HTML)
  const viewport = (width) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  viewport(900)
  onCleanup(installSettingsNav(ctx))
  await flush()
  const panel = document.querySelector('[data-shortcut-modal="settings"]')
  const nav = panel.querySelector('nav')
  const toggle = panel.querySelector('.sk-setnav__toggle')
  const scrim = panel.querySelector('.sk-setnav__scrim')
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'collapsed')
  assert.equal(toggle.getAttribute('aria-controls'), nav.id)
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(toggle.getAttribute('aria-label'), '展开设置导航')
  assert.ok(toggle.querySelector('svg[aria-hidden="true"]'))
  assert.equal(scrim.hidden, true)

  toggle.click()
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'open')
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(toggle.getAttribute('aria-label'), '收起设置导航')
  assert.equal(scrim.hidden, false)
  assert.equal(document.activeElement, nav.querySelector('.sk-setnav__input'))

  // Escape closes the drawer first, without closing the settings modal.
  const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.dispatchEvent(escape)
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'collapsed')
  assert.equal(escape.defaultPrevented, true)
  assert.equal(document.activeElement, toggle)

  // A destination closes the drawer after selection.
  toggle.click()
  nav.querySelector('[data-settings-id="notification"]').click()
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'collapsed')
  assert.equal(scrim.hidden, true)

  // The scrim is the pointer path.
  toggle.click()
  scrim.click()
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'collapsed')

  // Widening restores the inline rail and drops the manual override, like the
  // host resetting narrowExpanded when the workspace crosses the breakpoint.
  toggle.click()
  viewport(1200)
  window.dispatchEvent(new window.Event('resize'))
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'wide')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(scrim.hidden, true)
  viewport(900)
  window.dispatchEvent(new window.Event('resize'))
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'collapsed', 'a new narrow window starts collapsed')
  viewport(1024)
  window.dispatchEvent(new window.Event('resize'))
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'wide', '1024px is still a wide window, matching SIDEBAR_AUTO_COLLAPSE')
  viewport(1023)
  window.dispatchEvent(new window.Event('resize'))
  assert.equal(panel.getAttribute('data-sk-settings-nav'), 'collapsed')
})

test('the drawer keeps a native nav id instead of owning it', async (t) => {
  const { document, ctx, flush, onCleanup } = page(t, PANEL_HTML.replace('<nav class=', '<nav id="native-settings-nav" class='))
  const dispose = installSettingsNav(ctx)
  onCleanup(dispose)
  await flush()
  const nav = document.querySelector('nav')
  const toggle = document.querySelector('.sk-setnav__toggle')
  assert.equal(nav.id, 'native-settings-nav')
  assert.equal(toggle.getAttribute('aria-controls'), 'native-settings-nav')
  dispose()
  assert.equal(nav.id, 'native-settings-nav')
})
