/**
 * 弹卡定位：先钉住纯函数的每条分支，再在 jsdom 里跑一遍真实接线。
 *
 * 为什么要两类断言：`placePopover` 的数学错了会算到屏幕外（第一类能钉住），
 * 但接线错了（比如用写死的高度）纯函数永远是绿的（第二类才能钉住）。
 * 真机报过的现象有三代：先是拿 430 去估一个 187px 的卡片导致纵向错 243px；
 * 后来是卡片长在按钮右侧、与按钮关系不明显 —— 纵向统一为「卡片在按钮上方」；
 * 再后来卡片左边与按钮左边对齐，在 collapsed rail 下会压住整条 rail —— 横向改成
 * 「卡片左边从按钮右边缘起」，卡片整体落在按钮右侧的竖线上；
 * 最后是纵向按按钮「盒子」留 10px，但图标在盒子里还内缩 7~9px，人眼看到的是
 * 17~19px 的空当 —— gap 收紧到 2px，视觉上正好 ~10px。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'

import { POPOVER_GAP, POPOVER_MARGIN, placePopover } from '../../src/modules/remote/client/position.js'

const VIEWPORT = { width: 1264, height: 785 }
/** 侧栏底部的图标按钮：32×32，左下角。 */
const ANCHOR = { top: 737, bottom: 769, left: 240, right: 272 }

test('placePopover: 横向从按钮右边缘起，collapsed rail 下不压按钮', () => {
  // 真机 collapsed rail 实测：rail 宽 40，按钮 36×36 贴左下（x 2..38），视口 1280×713。
  const rail = { top: 629, bottom: 665, left: 2, right: 38 }
  const placed = placePopover({ anchor: rail, size: { width: 320, height: 443 }, viewport: { width: 1280, height: 713 } })
  assert.equal(placed.left, rail.right, '卡片左边 = 按钮右边缘')
  assert.ok(placed.left >= rail.right, '卡片不盖住按钮')

  // 展开侧栏时按钮还在左下（x 2..38），同样从右边缘起，不因为侧栏变宽而漂移。
  const expanded = placePopover({ anchor: rail, size: { width: 350, height: 187 }, viewport: VIEWPORT })
  assert.equal(expanded.left, 38)
})

test('placePopover: 卡片长在按钮上方，底边与按钮上边留出 gap', () => {
  // 未连接态实测 350×187。卡片底边 = 按钮上边 - gap = 737 - 2 = 735，故 top = 735 - 187 = 548。
  // gap 是「到按钮盒子」的距离，图标在 32px 盒子里还内缩 7px，视觉上约 9px。
  const short = placePopover({ anchor: ANCHOR, size: { width: 350, height: 187 }, viewport: VIEWPORT })
  assert.equal(short.left, ANCHOR.right, '横向从按钮右边缘起')
  assert.equal(short.top + 187, ANCHOR.top - POPOVER_GAP, '卡片底边应离开按钮上边一个 gap')
  assert.equal(short.top, ANCHOR.top - POPOVER_GAP - 187)

  // 扫码态高 430：仍然在按钮上方，只是往上长得更多（top 更小）。
  const tall = placePopover({ anchor: ANCHOR, size: { width: 350, height: 430 }, viewport: VIEWPORT })
  assert.equal(tall.top + 430, ANCHOR.top - POPOVER_GAP)
  assert.ok(tall.top < short.top, '卡片变高时应向上生长，而不是向下压住按钮')

  // 两者差值正是 187 与 430 的高度差。
  assert.equal(short.top - tall.top, 430 - 187)
})

test('placePopover: 上方放不下时翻到按钮下方', () => {
  // 按钮贴着视口顶部：上方只剩 20px，卡片 187px 放不下。
  const anchor = { top: 20, bottom: 52, left: 240, right: 272 }
  const placed = placePopover({ anchor, size: { width: 350, height: 187 }, viewport: VIEWPORT })
  assert.equal(placed.top, anchor.bottom + POPOVER_GAP, '翻到下方时上边应离开按钮下边一个 gap')
  assert.equal(placed.top, 54)
})

test('placePopover: 横向越界时夹在视口内，不越界', () => {
  // 视口只有 300px 宽，卡片 350px —— 无论怎么摆都要夹住，且左右各留 margin。
  const narrow = { width: 300, height: 600 }
  const anchor = { top: 500, bottom: 532, left: 120, right: 152 }
  const placed = placePopover({ anchor, size: { width: 350, height: 187 }, viewport: narrow })
  assert.equal(placed.left, POPOVER_MARGIN)
  assert.equal(placed.maxHeight, 600 - POPOVER_MARGIN * 2)
})

test('placePopover: 卡片高于视口时给出可滚动上限并贴住上边', () => {
  const tiny = { width: 1264, height: 300 }
  const placed = placePopover({ anchor: ANCHOR, size: { width: 350, height: 430 }, viewport: tiny })
  assert.equal(placed.maxHeight, 300 - POPOVER_MARGIN * 2)
  // 上方放不下、下方也放不下：夹到视口上边的 margin，靠 maxHeight + 内部滚动兜住。
  assert.equal(placed.top, POPOVER_MARGIN)
})

test('placePopover: 还没量到锚点/尺寸时退化到安全落点', () => {
  const noAnchor = placePopover({ anchor: undefined, size: undefined, viewport: VIEWPORT })
  assert.equal(noAnchor.left, POPOVER_MARGIN)
  assert.equal(noAnchor.top, POPOVER_MARGIN)

  // 只量到锚点、还没量到卡片：按 0 高算，卡片底边先贴到按钮上边（随后被实测值修正）。
  const noSize = placePopover({ anchor: ANCHOR, size: undefined, viewport: VIEWPORT })
  assert.equal(noSize.top, ANCHOR.top - POPOVER_GAP)
  assert.equal(noSize.left, ANCHOR.right)
})

async function loadPanel() {
  const result = await build({
    entryPoints: ['src/modules/remote/client/panel.jsx'],
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
  const calls = []
  return {
    calls,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => {},
    open: async () => {},
    close: () => {},
    startLogin: async (options) => { calls.push({ name: 'startLogin', options }) },
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
 * 接线断言：点击打开后，卡片必须自己量尺寸并长在按钮上方。
 *
 * jsdom 没有布局，`getBoundingClientRect()` 一律返回 0，所以按类名打桩：
 * 按钮给 32×32 的真实盒子，卡片给 350×187（`box-sizing: border-box` 之后的实测值）。
 */
test('Popover: 打开后按卡片实测高度定位，卡片长在按钮上方', async () => {
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
    assert.equal(left, ANCHOR.right, '卡片左边应从按钮右边缘起')
    // 回归线：卡片底边（top + 实测 187）必须停在按钮上边之上一个 gap 处。
    assert.equal(top, ANCHOR.top - POPOVER_GAP - 187, '卡片应长在按钮上方')
    assert.equal(top + 187, ANCHOR.top - POPOVER_GAP)
    assert.equal(popover.style.maxHeight, `${VIEWPORT.height - POPOVER_MARGIN * 2}px`)

    // 新交互：按钮只由点击开关，并在打开期间保持选中底色。
    assert.equal(trigger.classList.contains('wc-icon--active'), true, '打开时按钮应有选中底色')
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')

    // 再点一次 → 先挂 closing 播退出动画，动画结束后才卸载。
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', '收起时 aria-expanded 立即为 false')
    assert.ok(
      dom.window.document.querySelector('.wc-popover')?.classList.contains('wc-popover--closing'),
      '收起时卡片应带退出动画类',
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220))
    })
    assert.equal(dom.window.document.querySelector('.wc-popover'), null, '退出动画结束后卡片卸载')
    assert.equal(trigger.classList.contains('wc-icon--active'), false, '收起后按钮恢复常态')
  } finally {
    // 不还原全局 window/document：React 调度器在 unmount 之后还会跑一小段异步逻辑。
    await act(async () => {
      root.unmount()
    })
  }
})

/**
 * 「连接微信」是唯一会申请二维码的入口；刷新走 force。
 *
 * 这条钉的是用户明确提过的问题：打开面板本身不该触发二维码申请，否则每开一次卡片
 * 就是一次网络往返，手机上还没扫的码也会被顶掉。
 */
test('Popover: 打开面板不申请二维码，点「连接微信」才 startLogin', async () => {
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

    await act(async () => {
      // 打开面板（点击入口按钮）。
      dom.window.document.querySelector('.wc-icon').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      // 面板默认开在「手机连接」tab，本用例只关心微信面板的行为。
      dom.window.document.querySelector('#wc-tab-claw')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      // 给「打开面板」相关的异步留出时间：如果这里偷偷申请了二维码，下面就会抓到。
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.deepEqual(Connection.calls, [], '打开面板本身不应申请二维码')

    const connect = [...dom.window.document.querySelectorAll('.wc-button')]
      .find((node) => node.textContent === 'connect')
    assert.ok(connect !== undefined, '未连接态应给出「连接微信」按钮')

    await act(async () => {
      connect.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(Connection.calls.length, 1, '点「连接微信」才申请二维码')
    assert.equal(Connection.calls[0].name, 'startLogin')
    assert.notEqual(Connection.calls[0].options?.force, true, '普通申请不该强制换码')
  } finally {
    await act(async () => {
      root.unmount()
    })
  }
})
