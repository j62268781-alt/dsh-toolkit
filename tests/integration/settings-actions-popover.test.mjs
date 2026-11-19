/**
 * 原生 popover 路径的单独用例。jsdom 没有 `popover`，settings-actions.test.mjs
 * 只跑得到手写 `hidden` 兜底；真机（Chromium/Electron）走的是 top layer。
 *
 * popover 的开关状态不在 `hidden` 上 —— showPopover/hidePopover 只动 top layer，
 * `hidden` 永远是 false。一旦拿 `menu.hidden` 当「是否展开」的判据：
 *   · 点「更多」永远落到 close()，菜单打不开；
 *   · Esc 被菜单的 window 捕获监听器一直吞掉，原生设置收不到 Escape，
 *     标题栏的返回按钮（它靠派发 Escape 关闭设置）随之失效。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const HTML = '<div data-shortcut-modal="settings"><nav class="_AnXs9G_nav"><div class="_AnXs9G_navList"></div></nav><div class="_AnXs9G_content"><div class="_AnXs9G_header"><div class="_AnXs9G_actions"><div class="_yHUiNq_action"><button>打开配置文件</button></div></div></div></div></div>'

/** 让 jsdom 冒充支持 popover 的浏览器：只有 CAN_POPOVER 的判定与 :popover-open 需要。 */
function emulatePopover(dom) {
  const proto = dom.window.HTMLElement.prototype
  Object.defineProperty(proto, 'popover', {
    configurable: true,
    get() {
      const value = this.getAttribute('popover')
      return value === null ? null : value === '' ? 'auto' : value
    },
  })
  const dispatch = (element, newState) => {
    const event = new dom.window.Event('toggle')
    event.newState = newState
    element.dispatchEvent(event)
  }
  proto.showPopover = function showPopover() {
    this.__popoverOpen = true
    dispatch(this, 'open')
  }
  proto.hidePopover = function hidePopover() {
    this.__popoverOpen = false
    dispatch(this, 'closed')
  }
  const matches = dom.window.Element.prototype.matches
  dom.window.Element.prototype.matches = function patchedMatches(selector) {
    if (String(selector).includes(':popover-open')) return this.__popoverOpen === true
    return matches.call(this, selector)
  }
}

test('popover 菜单：点「更多」能展开，Esc 先关菜单再轮到原生设置', async (t) => {
  const dom = new JSDOM(HTML)
  emulatePopover(dom)
  const originals = new Map()
  const values = {
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
  }
  for (const [name, value] of Object.entries(values)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  // CAN_POPOVER 在模块求值时决定，所以必须在 shim 之后再载入源码。
  const { installSettingsNav } = await import('../../src/modules/theme/client/settings-nav.ts')
  const dispose = installSettingsNav()
  t.after(() => {
    dispose()
    dom.window.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })

  const doc = dom.window.document
  const panel = doc.querySelector('[data-shortcut-modal="settings"]')
  const more = doc.querySelector('.sk-setnav__more')
  const menu = doc.querySelector('.sk-setnav__actions')
  const back = doc.querySelector('.sk-setnav__back')
  assert.ok(menu.hasAttribute('popover'), '真机路径必须走原生 popover')
  assert.equal(menu.hidden, false, 'popover 路径不靠 hidden 收尾')
  assert.equal(menu.__popoverOpen, undefined, '初始是关闭的')

  let nativeCloses = 0
  doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') nativeCloses++ })

  // 返回按钮 = 派发一次 Escape 给原生模态。
  back.click()
  assert.equal(nativeCloses, 1, '菜单没开时，返回按钮的 Escape 必须到达原生设置')

  more.click()
  assert.equal(menu.__popoverOpen, true, '点「更多」要展开菜单')
  assert.equal(more.getAttribute('aria-expanded'), 'true')

  // 菜单展开时按 Esc：只关菜单，不能关掉整个设置页。
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(menu.__popoverOpen, false, 'Esc 先收起菜单')
  assert.equal(nativeCloses, 1, '这一次 Escape 不该传给原生设置')
  assert.equal(more.getAttribute('aria-expanded'), 'false')

  // 再按一次 Esc：菜单已关，必须让原生设置收到。
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  assert.equal(nativeCloses, 2, '菜单关着时 Escape 必须放行')

  // 点「更多」再点一次应能收起，而不是重复 close。
  more.click()
  assert.equal(menu.__popoverOpen, true)
  more.click()
  assert.equal(menu.__popoverOpen, false, '再次点「更多」收起菜单')

  assert.ok(panel.hasAttribute('data-sk-settings-toolbar'))
})