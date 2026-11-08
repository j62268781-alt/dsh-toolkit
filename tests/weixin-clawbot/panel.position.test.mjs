/**
 * 弹卡定位：先钉住纯函数的每条分支，再在 jsdom 里跑一遍真实接线。
 *
 * 为什么要两类断言：`placePopover` 的数学错了会算到屏幕外（第一类能钉住），
 * 但接线错了（比如仍然用写死的高度）纯函数永远是绿的（第二类才能钉住）。
 * 真机报过的现象：卡片底边比按钮底边高 243px —— 正是拿 430 去估一个 187px 的卡片。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'

import { POPOVER_GAP, POPOVER_MARGIN, placePopover } from '../../src/modules/weixin-clawbot/client/position.js'

const VIEWPORT = { width: 1264, height: 785 }
/** 侧栏底部的图标按钮：32×32，左下角。 */
const ANCHOR = { top: 737, bottom: 769, left: 240, right: 272 }

test('placePopover: 卡片底边与按钮底边对齐（高度按实测，不是估计值）', () => {
  // 未连接态实测 350×187。旧实现写死 430，算出 top=339；正确值是 769-187=582。
  const short = placePopover({ anchor: ANCHOR, size: { width: 350, height: 187 }, viewport: VIEWPORT })
  assert.equal(short.top, ANCHOR.bottom - 187)
  assert.equal(short.top + 187, ANCHOR.bottom)
  assert.equal(short.left, ANCHOR.right + POPOVER_GAP)

  // 扫码态高 430：同一个按钮，底边依旧对齐。
  const tall = placePopover({ anchor: ANCHOR, size: { width: 350, height: 430 }, viewport: VIEWPORT })
  assert.equal(tall.top, ANCHOR.bottom - 430)
  assert.equal(tall.top + 430, ANCHOR.bottom)

  // 两者差值正是 187 与 430 的高度差 —— 这就是旧实现 243px 错位的来源。
  assert.equal(tall.top - short.top, 187 - 430)
})

test('placePopover: 右侧放不下时翻到按钮左侧', () => {
  // 按钮贴近右边缘：右侧只剩 4px，卡片 350px 放不下。
  const anchor = { top: 400, bottom: 432, left: 1228, right: 1260 }
  const placed = placePopover({ anchor, size: { width: 350, height: 187 }, viewport: VIEWPORT })
  assert.equal(placed.left, anchor.left - POPOVER_GAP - 350)
  assert.ok(placed.left + 350 <= VIEWPORT.width - POPOVER_MARGIN)
  assert.ok(placed.left >= POPOVER_MARGIN)
})

test('placePopover: 两侧都放不下时夹在视口内，不越界', () => {
  // 视口只有 300px 宽，卡片 350px —— 无论怎么摆都要夹住，且左右各留 margin。
  const narrow = { width: 300, height: 600 }
  const anchor = { top: 100, bottom: 132, left: 120, right: 152 }
  const placed = placePopover({ anchor, size: { width: 350, height: 187 }, viewport: narrow })
  assert.equal(placed.left, POPOVER_MARGIN)
  assert.equal(placed.maxHeight, 600 - POPOVER_MARGIN * 2)
})

test('placePopover: 卡片高于视口时给出可滚动上限并贴住上边', () => {
  const tiny = { width: 1264, height: 300 }
  const placed = placePopover({ anchor: ANCHOR, size: { width: 350, height: 430 }, viewport: tiny })
  assert.equal(placed.maxHeight, 300 - POPOVER_MARGIN * 2)
  assert.equal(placed.top, POPOVER_MARGIN)
})

test('placePopover: 还没量到锚点/尺寸时退化到安全落点', () => {
  const noAnchor = placePopover({ anchor: undefined, size: undefined, viewport: VIEWPORT })
  assert.equal(noAnchor.left, POPOVER_MARGIN)
  assert.equal(noAnchor.top, POPOVER_MARGIN)

  // 只量到锚点、还没量到卡片：不抛错，先把卡片上边贴到按钮底边（高度随后被实测值修正）。
  const noSize = placePopover({ anchor: ANCHOR, size: undefined, viewport: VIEWPORT })
  assert.equal(noSize.top, ANCHOR.bottom)
  assert.equal(noSize.left, ANCHOR.right + POPOVER_GAP)
})

async function loadPanel() {
  const result = await build({
    entryPoints: ['src/modules/weixin-clawbot/client/panel.jsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    jsx: 'automatic',
    loader: { '.jsx': 'jsx', '.js': 'jsx', '.css': 'text' },
    write: false,
    logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = 'node_modules/.cache/weixin_panel_position.mjs'
  await writeFile(out, result.outputFiles[0].text)
  return import(`../../${out}?case=${Math.random()}`)
}

function fakeConnection() {
  const snapshot = { state: 'idle', connected: false }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => {},
    open: async () => {},
    close: () => {},
    startLogin: async () => {},
    submitCode: async () => {},
    cancelLogin: async () => {},
    logout: async () => {},
    probe: async () => ({ messages: 0 }),
    setMonitor: () => {},
    dispose: () => {},
  }
}

const rect = (left, top, width, height) => ({
  x: left, y: top, left, top, width, height,
  right: left + width, bottom: top + height,
})

/**
 * 接线断言：hover 打开后，卡片必须自己量尺寸并贴住按钮底边。
 *
 * jsdom 没有布局，`getBoundingClientRect()` 一律返回 0，所以按类名打桩：
 * 按钮给 32×32 的真实盒子，卡片给 350×187（`box-sizing: border-box` 之后的实测值）。
 */
test('Popover: 打开后按卡片实测高度定位，底边贴住按钮底边', async () => {
  const { createPanel } = await loadPanel()

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  dom.window.innerWidth = VIEWPORT.width
  dom.window.innerHeight = VIEWPORT.height
  dom.window.Element.prototype.getBoundingClientRect = function getRect() {
    const cls = this.getAttribute('class') ?? ''
    if (cls.includes('wc-icon')) return rect(ANCHOR.left, ANCHOR.top, 32, 32)
    if (cls.includes('wc-popover')) return rect(0, 0, 350, 187)
    return rect(0, 0, 0, 0)
  }

  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.Node = dom.window.Node
  globalThis.Element = dom.window.Element
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const { createRoot } = await import('react-dom/client')
  const { createPortal } = await import('react-dom')
  const Connection = fakeConnection()
  const Entry = createPanel(React, {
    t: (key, vars) => String(vars === undefined ? key : `${key}:${JSON.stringify(vars)}`),
    connection: Connection,
    portal: createPortal,
  })

  const root = createRoot(dom.window.document.getElementById('root'))
  try {
    await act(async () => {
      root.render(React.createElement(Entry))
    })

    const trigger = dom.window.document.querySelector('.wc-icon')
    assert.ok(trigger !== null, '入口按钮应已渲染')

    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    const popover = dom.window.document.querySelector('.wc-popover')
    assert.ok(popover !== null, '点击后卡片应已展开')

    const left = Number.parseFloat(popover.style.left)
    const top = Number.parseFloat(popover.style.top)
    assert.equal(left, ANCHOR.right + POPOVER_GAP, '卡片应贴在按钮右侧')
    // 这条就是回归线：旧实现拿 estimated=430 倒推，会得到 339（=769-430），比正确值高 243px。
    assert.equal(top, ANCHOR.bottom - 187, '卡片底边应与按钮底边对齐')
    assert.equal(top + 187, ANCHOR.bottom)
    assert.equal(popover.style.maxHeight, `${VIEWPORT.height - POPOVER_MARGIN * 2}px`)
  } finally {
    // 不还原全局 window/document：React 调度器在 unmount 之后还会跑一小段异步逻辑。
    await act(async () => {
      root.unmount()
    })
  }
})