/**
 * 卡片四态 + 入口圆点 + 控件外观：这些都是与宿主/设计稿对齐的 UI 契约，
 * 所以直接渲染真组件断言 DOM，而不是断言一堆 className 常量。
 *
 * 四态来自设计稿（等待扫码=纯二维码 / 已扫码=蒙层「连接中」/ 已过期=过期码 +
 * 蒙版「已过期 + 点击刷新」/ 已连接=连接信息）。入口圆点则要跟随真实连接状态，
 * 不能因为面板关掉就变灰。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'

import { createConnection, toneOf } from '../../src/modules/weixin-clawbot/client/model.js'

const VIEWPORT = { width: 1264, height: 785 }
/** 侧栏底部的图标按钮：32×32，左下角。 */
const ANCHOR = { top: 737, bottom: 769, left: 240, right: 272 }
const QR_URL = 'https://liteapp.weixin.qq.com/q/x?qrcode=q&bot_type=3'
/** 倒计时 hook 读的是真实 Date.now()，所以到期时间必须相对现在算，不能写死。 */
const soon = (ms) => Date.now() + ms

const rect = (left, top, width, height) => ({
  x: left, y: top, left, top, width, height,
  right: left + width, bottom: top + height,
})

let panelModule

async function loadPanel() {
  if (panelModule !== undefined) return panelModule
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
  const out = 'node_modules/.cache/weixin_panel_status.mjs'
  await writeFile(out, result.outputFiles[0].text)
  panelModule = await import(`../../${out}?case=${Math.random()}`)
  return panelModule
}

/** 与 model.js 的 normalize 输出同形，避免组件里出现 undefined 访问。 */
function snapshot(overrides) {
  return {
    state: 'idle',
    connected: false,
    account: undefined,
    qr: undefined,
    code: undefined,
    error: undefined,
    monitor: { enabled: false, running: false, connected: false, received: 0 },
    lastMessage: undefined,
    credentialRef: 'WEIXIN_CLAWBOT_CREDENTIAL',
    bridge: {
      enabled: true,
      ready: true,
      accessPolicy: 'allowlist',
      allowCount: 1,
      received: 0,
      replied: 0,
      skipped: 0,
      failed: 0,
      pendingApprovals: 0,
    },
    ...overrides,
  }
}

function fakeConnection(initial) {
  const value = snapshot(initial)
  const calls = []
  return {
    calls,
    getSnapshot: () => value,
    subscribe: () => () => {},
    refresh: async () => value,
    open: async () => value,
    close: () => {},
    startLogin: async (options) => { calls.push({ name: 'startLogin', options }) },
    submitCode: async () => {},
    cancelLogin: async () => { calls.push({ name: 'cancelLogin' }) },
    logout: async () => {},
    probe: async () => ({ messages: 0 }),
    setMonitor: () => {},
    dispose: () => {},
  }
}

async function mountPanel({ initial, open = true } = {}) {
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
  const connection = fakeConnection(initial)
  const Entry = createPanel(React, {
    // 假翻译：原样返回 key（带插值时附上 JSON），方便断言「渲染的是哪个键」。
    t: (key, vars) => String(vars === undefined ? key : `${key}:${JSON.stringify(vars)}`),
    connection,
    portal: createPortal,
  })

  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(Entry))
  })

  if (open) {
    await act(async () => {
      dom.window.document.querySelector('.wc-icon').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }

  return {
    dom,
    connection,
    document: dom.window.document,
    popover: () => dom.window.document.querySelector('.wc-popover'),
    click: async (node) => {
      await act(async () => {
        node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    },
    // 不还原全局 window/document：React 调度器在 unmount 之后还会跑一小段异步逻辑。
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
    },
  }
}

test('toneOf: 已过期归到 bad（要用户动手），已连接归 ok', () => {
  assert.equal(toneOf('expired'), 'bad')
  assert.equal(toneOf('connected'), 'ok')
  assert.equal(toneOf('waiting_qr'), 'busy')
  assert.equal(toneOf('idle'), 'idle')
})

test('connection.close(): 关面板不改状态，入口圆点才不会变灰', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: true, state: 'waiting_qr', connected: false }),
    { headers: { 'content-type': 'application/json' } },
  )
  try {
    const connection = createConnection()
    await connection.refresh()
    assert.equal(connection.getSnapshot().state, 'waiting_qr')

    connection.close()
    // 回归线：以前 close() 会把 state 写成 'closed'，toneOf('closed') 落到 idle，
    // 于是面板一关入口小点就恒灰，用户看到的「状态」永远是未连接。
    assert.equal(connection.getSnapshot().state, 'waiting_qr', '关闭面板不应覆盖真实状态')
  } finally {
    globalThis.fetch = original
  }
})

test('Waiting: 等待扫码只画二维码，不加蒙层', async () => {
  const panel = await mountPanel({
    initial: { state: 'waiting_qr', qr: { url: QR_URL, expiresAt: soon(120_000), loginId: 'login-1' } },
  })
  try {
    const popover = panel.popover()
    assert.ok(popover !== null, '卡片应已展开')
    assert.ok(popover.querySelector('.wc-qr') !== null, '等待扫码要展示二维码')
    assert.equal(popover.querySelector('.wc-qr-mask'), null, '等待扫码不该有蒙层')
    // 倒计时用「秒后过期」那条文案，读数来自服务端 expiresAt。
    assert.match(popover.textContent, /qrCountdown/)
  } finally {
    await panel.unmount()
  }
})

test('Waiting: 已扫码在二维码上盖「连接中」蒙层', async () => {
  const panel = await mountPanel({
    initial: { state: 'scanned', qr: { url: QR_URL, expiresAt: soon(120_000), loginId: 'login-1' } },
  })
  try {
    const popover = panel.popover()
    const mask = popover.querySelector('.wc-qr-mask')
    assert.ok(mask !== null, '已扫码要有蒙层')
    assert.equal(mask.classList.contains('wc-qr-mask--expired'), false, '已扫码不是过期蒙版')
    assert.match(mask.textContent, /qrConnecting/)
    // 蒙层压在码上，码本身仍在（否则蒙层下面就是空白）。
    assert.ok(popover.querySelector('.wc-qr') !== null, '蒙层下面应保留二维码')
  } finally {
    await panel.unmount()
  }
})

test('Waiting: 已过期保留过期二维码 + 蒙版，点蒙版强制换新码', async () => {
  const panel = await mountPanel({
    initial: { state: 'expired', qr: { url: QR_URL, expiresAt: soon(-1), loginId: 'login-1' } },
  })
  try {
    const popover = panel.popover()
    const mask = popover.querySelector('.wc-qr-mask--expired')
    assert.ok(mask !== null, '已过期要有可点的过期蒙版')
    assert.match(mask.textContent, /qrExpiredTitle/)
    assert.match(mask.textContent, /qrExpiredAction/)
    // 过期后不再显示倒计时（读数恒 0 没有意义）。
    assert.doesNotMatch(popover.textContent, /qrCountdown/)

    await panel.click(mask)
    assert.equal(panel.connection.calls.length, 1, '点蒙版应触发一次刷新')
    assert.equal(panel.connection.calls[0].name, 'startLogin')
    assert.equal(panel.connection.calls[0].options?.force, true, '点「点击刷新」必须强制换码')
  } finally {
    await panel.unmount()
  }
})

test('入口圆点：data-state 跟随连接状态，与面板开关无关', async () => {
  const cases = [
    { initial: { state: 'connected', connected: true }, expected: 'ok' },
    { initial: { state: 'waiting_qr' }, expected: 'busy' },
    { initial: { state: 'failed', error: 'boom' }, expected: 'bad' },
    { initial: { state: 'idle' }, expected: 'idle' },
    /**
     * 掉线回归：model.js 在 refresh/act 失败时只把 state 改成 'failed'，
     * 保留上一次快照里的 connected=true。若圆点让 connected 先决，掉线时它就一直绿着
     * （B17 实测：面板已经显示「操作失败：连不上插件路由」，圆点还是 ok）。
     */
    { initial: { state: 'failed', connected: true, error: '连不上插件路由' }, expected: 'bad' },
  ]
  for (const item of cases) {
    const panel = await mountPanel({ initial: item.initial, open: false })
    try {
      const dot = panel.document.querySelector('.wc-icon .wc-dot')
      assert.ok(dot !== null, '入口按钮上应一直有状态圆点')
      assert.equal(dot.getAttribute('data-state'), item.expected, `状态 ${item.initial.state} 的圆点分档应为 ${item.expected}`)
    } finally {
      await panel.unmount()
    }
  }
})

test('卡片标题栏：关闭按钮是宿主同款 svg 图标，不是文字 ×', async () => {
  const panel = await mountPanel({ initial: { state: 'idle' } })
  try {
    const close = panel.popover().querySelector('.wc-close')
    assert.ok(close !== null, '标题栏应有关闭按钮')
    assert.equal(close.textContent, '', '关闭按钮不该再渲染文字 ×')
    const svg = close.querySelector('svg')
    assert.ok(svg !== null, '关闭按钮应内联 svg 图标')
    assert.equal(svg.getAttribute('viewBox'), '0 0 16 16')
    assert.equal(svg.getAttribute('stroke-width'), '1')
    const paths = [...svg.querySelectorAll('path')].map((node) => node.getAttribute('d'))
    assert.deepEqual(paths, ['M2.5 2.5L13.5 13.5', 'M13.5 2.5L2.5 13.5'], '应是宿主 IconCloseOutlineRegular 的两笔交叉线')

    await panel.click(close)
    assert.equal(panel.popover(), null, '点关闭应收起卡片')
  } finally {
    await panel.unmount()
  }
})

test('底部开关：宿主尺寸语义（role=switch + aria-checked + 独立 knob）', async () => {
  const panel = await mountPanel({ initial: { state: 'idle' } })
  try {
    const toggle = panel.popover().querySelector('.wc-switch')
    assert.ok(toggle !== null, '底部应有开关')
    assert.equal(toggle.getAttribute('role'), 'switch')
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    const knob = toggle.querySelector('.wc-switch__knob')
    assert.ok(knob !== null, '开关要有独立 knob 元素')
    assert.equal(knob.getAttribute('aria-hidden'), 'true')

    await panel.click(toggle)
    assert.equal(toggle.getAttribute('aria-checked'), 'true', '点一下应切到开')
  } finally {
    await panel.unmount()
  }
})

test('已连接：只留账号/端点/监听收发 + 底部「重新登录|断开连接」，桥接开关与测试通道都不再出现', async () => {
  const panel = await mountPanel({
    initial: {
      state: 'connected',
      connected: true,
      monitor: { enabled: true, running: true, connected: true, received: 7 },
      bridge: {
        enabled: true,
        ready: true,
        accessPolicy: 'allowlist',
        allowCount: 1,
        received: 3,
        replied: 2,
        skipped: 1,
        failed: 0,
        pendingApprovals: 0,
      },
    },
  })
  try {
    const popover = panel.popover()
    const text = popover.textContent

    // 收发计数并进「消息监听」这一行。
    assert.ok(text.includes('monitorTraffic'), '监听行应带上收发计数')
    assert.ok(text.includes('"r":3') && text.includes('"s":2'), '收发计数应取 bridge.received / bridge.replied')

    // 桥接区块与凭据位置整块消失。
    assert.ok(!text.includes('bridgeTitle'), '不再有「消息桥接」区块')
    assert.ok(!text.includes('bridgeDisable'), '不再有关闭桥接')
    assert.ok(!text.includes('bridgeEnable'), '不再有开启桥接')
    assert.ok(!text.includes('allowRecent'), '不再有允许最近联系人')
    assert.ok(!text.includes('sendTest'), '不再有发送测试消息')
    assert.ok(!text.includes('credentialRef'), '不再显示凭据位置')
    assert.ok(!text.includes('bridgePolicy'), '不再显示策略行')
    assert.ok(!text.includes('probe'), '不再有测试通道')

    const buttons = [...popover.querySelectorAll('button')]
    const reconnect = buttons.find((node) => node.textContent === 'reconnect')
    const disconnect = buttons.find((node) => node.textContent === 'disconnect')
    assert.ok(reconnect !== undefined, '重新登录按钮要保留')
    assert.ok(disconnect !== undefined, '断开连接按钮要保留')

    // 同一行、左右各一半，断开在右。
    assert.equal(reconnect.parentElement, disconnect.parentElement, '两个按钮应在同一行')
    const row = disconnect.parentElement
    assert.equal(reconnect.nextElementSibling, disconnect, '顺序是「重新登录」在左、「断开连接」在右')
    assert.ok(reconnect.className.includes('wc-button--half'), '重新登录应占一半')
    assert.ok(disconnect.className.includes('wc-button--half'), '断开连接应占一半')
    assert.ok(disconnect.className.includes('wc-button--danger-solid'), '断开连接应是实心填充 + 白字')
    assert.equal(disconnect.getAttribute('type'), 'button')
    assert.ok(!row.textContent.includes('probe'), '这一行不再有测试通道')
  } finally {
    await panel.unmount()
  }
})
