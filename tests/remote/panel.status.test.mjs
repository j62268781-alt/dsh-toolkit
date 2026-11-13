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

import { createConnection, pollInterval, toneOf } from '../../src/modules/remote/client/wechat/model.js'

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
    monitor: { enabled: false, running: false, connected: false, phase: 'idle', received: 0 },
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

async function mountPanel({ initial, open = true, tab = 'claw' } = {}) {
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
    // 面板默认开在「手机连接」tab；本文件的既有断言都是微信面板的四态契约，
    // 所以挂载后统一切到 ClawBot tab。tab 本身的断言见文件末尾的专项用例。
    if (tab !== undefined) {
      const button = dom.window.document.querySelector(`#wc-tab-${tab}`)
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
    }
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
    // 收起动画 150ms，等它跑完再断言卸载。
    settle: async (ms = 200) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms))
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
  // 重连态必须报警：这时凭据还在、但通道已经被服务端拒了，亮绿灯等于骗人。
  assert.equal(toneOf('reconnecting'), 'bad')
})

test('pollInterval: 扫码期间 1.5s 一次、已连接 6s 一次、其余不轮询', () => {
  // 节奏是「扫码要快、连接后要省」的取舍：改错会导致 IP 被 iLink 限流或二维码状态明显滞后。
  for (const state of ['waiting_qr', 'scanned', 'need_code', 'requesting']) {
    assert.equal(pollInterval(state), 1500, `${state} 应该 1.5 秒轮询一次`)
  }
  for (const state of ['connected', 'confirmed']) {
    assert.equal(pollInterval(state), 6000, `${state} 应该 6 秒轮询一次`)
  }
  for (const state of ['idle', 'failed', 'expired', 'closed', undefined]) {
    assert.equal(pollInterval(state), 0, `${state} 不该起轮询`)
  }
  // 断开期间要尽快反映「恢复」或「判定失效」，所以比已连接的 6 秒更快。
  assert.equal(pollInterval('reconnecting'), 1500)
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
    // 二维码 + 倒计时已经表达「等扫码」，不再叠一行状态文字。
    assert.equal(popover.querySelector('.wc-status'), null, '等待扫码不显示状态行')
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

test('Disconnected: 未连接只剩一个主按钮，不再重复写「未连接」', async () => {
  const panel = await mountPanel({ initial: { state: 'idle', connected: false } })
  try {
    const popover = panel.popover()
    assert.ok(popover !== null, '卡片应已展开')
    // 未连接不该出现二维码/输入框/连接信息，也不该有「未连接」状态行 —— 只留一个主按钮。
    assert.equal(popover.querySelector('.wc-qr'), null)
    assert.equal(popover.querySelector('input'), null)
    assert.equal(popover.querySelector('.wc-status'), null, '未连接态不再显示状态行')
    assert.doesNotMatch(popover.textContent, /stateIdle/, '「连接微信」按钮已说明状态，不再写「未连接」')
    const buttons = [...popover.querySelectorAll('button')].filter((button) => !button.classList.contains('wc-icon'))
    const primary = buttons.find((button) => button.textContent.trim() === 'connect')
    assert.ok(primary !== undefined, `未连接要有「连接微信」主按钮，实际按钮：${buttons.map((b) => b.textContent).join('|')}`)

    await panel.click(primary)
    assert.equal(panel.connection.calls.length, 1, '点主按钮应触发一次登录')
    assert.equal(panel.connection.calls[0].name, 'startLogin')
  } finally {
    await panel.unmount()
  }
})

test('requesting: 还没拿到二维码时用「正在申请二维码…」占位，不画空码', async () => {
  const panel = await mountPanel({ initial: { state: 'requesting' } })
  try {
    const popover = panel.popover()
    // 服务端还在申请：卡片留在扫码阶段，但没有二维码可画，只能给一句提示。
    assert.equal(popover.querySelector('.wc-qr'), null, '没拿到二维码不该画空码')
    assert.match(popover.textContent, /stateRequesting/)
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
    // 被别处登录顶掉：凭据还在（connected=true），但长轮询已被服务端拒（-14），圆点必须报红。
    { initial: { state: 'reconnecting', connected: true, monitor: { enabled: true, running: true, connected: false, phase: 'stale', received: 3 } }, expected: 'bad' },
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
    assert.ok(panel.popover().classList.contains('wc-popover--closing'), '点关闭先播退出动画')
    await panel.settle()
    assert.equal(panel.popover(), null, '动画结束后卡片应卸载')
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

test('被顶号断开：文案从「正在重连」升级到「连接已失效」，监听行说明原因，重新登录变主按钮', async () => {
  // 真实场景：另一台电脑扫码后旧 token 被服务端作废，getUpdates 只回 -14。
  // 老实现只记一条「稍后自动重试」，面板还是「已连接」，用户根本不知道消息已经断了。
  const cases = [
    { phase: 'stale', lastError: '微信连接已断开，正在重连…' },
    { phase: 'invalid', lastError: '微信连接已失效（可能在其他设备重新登录），请点「重新登录」' },
  ]
  for (const item of cases) {
    const panel = await mountPanel({
      initial: {
        state: 'reconnecting',
        connected: true,
        account: { accountId: '95be******.bot', baseUrlHost: 'ilinkai.weixin.qq.com' },
        monitor: {
          enabled: true,
          running: true,
          connected: false,
          phase: item.phase,
          received: 8,
          lastError: item.lastError,
        },
        bridge: {
          enabled: true,
          ready: true,
          accessPolicy: 'allowlist',
          allowCount: 1,
          received: 8,
          replied: 8,
          skipped: 0,
          failed: 0,
          pendingApprovals: 0,
        },
      },
    })
    try {
      const popover = panel.popover()
      const text = popover.textContent
      assert.equal(popover.querySelector('.wc-status'), null, '状态行已移除，原因写在监听行里')
      assert.ok(text.includes(item.lastError), '监听行要把断线原因说出来')
      assert.ok(!text.includes('monitorTraffic'), '断线时不能再显示「监听中 · 收 N 回 M」')
      const buttons = [...popover.querySelectorAll('button')]
      const reconnect = buttons.find((node) => node.textContent === 'reconnect')
      assert.ok(reconnect !== undefined, '重新登录按钮要在')
      assert.ok(reconnect.className.includes('wc-button--primary'), '断线时「重新登录」应是主按钮')
    } finally {
      await panel.unmount()
    }
  }
})
