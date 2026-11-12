/**
 * 手机配对 tab：tab 结构 + 控制 RPC 的接线。
 *
 * 这里不启动真手机，也不碰真服务器：把 `fetch` 换成假的控制路由，断言
 *   - 面板默认开在「手机连接」，tab 选中态/aria 正确；
 *   - 「生成配对二维码」发出的请求体是 ds-harness-remote 的
 *     `{type:'client-request', rpcId, method, payload}` 线协议；
 *   - 手机 claim 之后出现 8 位码输入框，确认时把 sessionId + verificationCode
 *     原样送进 `host.pairing.confirm`；
 *   - completed 后展示手机名称与设备指纹；
 *   - 控制路由不存在（404）时给出可读错误，而不是静默失败。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'

const VIEWPORT = { width: 1264, height: 785 }
const ANCHOR = { top: 737, bottom: 769, left: 240, right: 272 }
const SERVER = 'https://pair.example.com'

const rect = (left, top, width, height) => ({
  x: left, y: top, left, top, width, height,
  right: left + width, bottom: top + height,
})

const soon = (ms) => Date.now() + ms

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
  const out = 'node_modules/.cache/remote_panel_pairing.mjs'
  await writeFile(out, result.outputFiles[0].text)
  panelModule = await import(`../../${out}?case=${Math.random()}`)
  return panelModule
}

function snapshot() {
  return {
    state: 'idle',
    connected: false,
    account: undefined,
    qr: undefined,
    code: undefined,
    error: undefined,
    monitor: { enabled: false, running: false, connected: false, phase: 'idle', received: 0 },
    lastMessage: undefined,
    credentialRef: 'WEIXIN_REMOTE_CREDENTIAL',
    bridge: {
      enabled: true, ready: true, accessPolicy: 'allowlist', allowCount: 1,
      received: 0, replied: 0, skipped: 0, failed: 0, pendingApprovals: 0,
    },
  }
}

function fakeConnection() {
  const value = snapshot()
  return {
    getSnapshot: () => value,
    subscribe: () => () => {},
    refresh: async () => value,
    open: async () => value,
    close: () => {},
    startLogin: async () => {},
    submitCode: async () => {},
    cancelLogin: async () => {},
    logout: async () => {},
    probe: async () => ({ messages: 0 }),
    dispose: () => {},
  }
}

/** 假控制路由：按 endpoint 返回预先编排的 HostPairingView。 */
function fakeControl(replies) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const endpoint = String(url).replace('/ds-harness-remote/', '')
    const body = init.body === undefined ? undefined : JSON.parse(init.body)
    calls.push({ endpoint, body, init })
    const reply = replies[endpoint]
    if (reply === undefined) {
      return new Response('not found', { status: 404 })
    }
    const value = typeof reply === 'function' ? reply(body) : reply
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: body?.rpcId ?? 'rpc',
      result: { ok: true, value },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetch }
}

const CREATED = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  state: 'created',
  expiresAt: soon(180_000),
  serverUrl: SERVER,
  hostFingerprint: 'a'.repeat(64),
  qrPayload: `${SERVER}/pair#v1.${'b'.repeat(43)}`,
  canRetry: false,
  localSaved: false,
}

const CLAIMED = {
  ...CREATED,
  state: 'claimed',
  mobile: { deviceId: 'phone-1', name: 'Pixel 9', fingerprint: 'c'.repeat(64) },
}

const COMPLETED = {
  ...CLAIMED,
  state: 'completed',
  localSaved: true,
}

async function mount(replies) {
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

  const control = fakeControl(replies)
  const originalFetch = globalThis.fetch
  globalThis.fetch = control.fetch

  const { createRoot } = await import('react-dom/client')
  const { createPortal } = await import('react-dom')
  const Entry = createPanel(React, {
    t: (key, vars) => String(vars === undefined ? key : `${key}:${JSON.stringify(vars)}`),
    connection: fakeConnection(),
    portal: createPortal,
  })

  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(Entry))
  })
  await act(async () => {
    dom.window.document.querySelector('.wc-icon').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })

  const click = async (node) => {
    await act(async () => {
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }

  return {
    dom,
    control,
    document: dom.window.document,
    popover: () => dom.window.document.querySelector('.wc-popover'),
    click,
    flush,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      globalThis.fetch = originalFetch
    },
  }
}

test('tab：默认开在「手机连接」，两个 tab 的选中态互斥', async () => {
  const panel = await mount({
    'settings.get': { config: { serverUrl: SERVER } },
    'host.pairing.status': undefined,
  })
  try {
    const popover = panel.popover()
    const tabs = [...popover.querySelectorAll('[role="tab"]')]
    assert.equal(tabs.length, 2, '应有两个 tab')
    assert.equal(tabs[0].textContent, 'tabPair')
    assert.equal(tabs[1].textContent, 'tabClaw')
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true', '默认选中手机连接')
    assert.equal(tabs[1].getAttribute('aria-selected'), 'false')
    assert.ok(popover.querySelector('.wc-tabpanel') !== null, 'tab 内容应在 tabpanel 里')

    // 分段控件的白色指示块：唯一一个、不参与 tab 语义、位置靠 transform 平移。
    const indicators = popover.querySelectorAll('.wc-tab-indicator')
    assert.equal(indicators.length, 1)
    assert.equal(indicators[0].getAttribute('aria-hidden'), 'true')
    assert.equal(indicators[0].style.transform, 'translateX(0%)')

    await panel.click(tabs[1])
    assert.equal(tabs[1].getAttribute('aria-selected'), 'true')
    assert.equal(tabs[0].getAttribute('aria-selected'), 'false')
    assert.equal(indicators[0].style.transform, 'translateX(100%)', '切换后指示块应滑到第二格')
  } finally {
    await panel.unmount()
  }
})

test('配对：生成二维码走 host.pairing.start，并渲染二维码', async () => {
  const panel = await mount({
    'settings.get': { config: { serverUrl: SERVER } },
    'host.pairing.status': undefined,
    'host.pairing.start': CREATED,
  })
  try {
    const popover = panel.popover()
    // 打开面板时读过一次状态（没有会话 → undefined）。
    assert.ok(panel.control.calls.some((call) => call.endpoint === 'host.pairing.status'))

    const generate = [...popover.querySelectorAll('.wc-button')].find((node) => node.textContent === 'pairGenerate')
    assert.ok(generate !== undefined, '未配对时要给出生成二维码按钮')
    await panel.click(generate)
    await panel.flush()

    const start = panel.control.calls.find((call) => call.endpoint === 'host.pairing.start')
    assert.ok(start !== undefined, '应调用 host.pairing.start')
    assert.equal(start.body.type, 'client-request', '线协议类型')
    assert.equal(start.body.method, 'host.pairing.start', 'method 必须等于 endpoint')
    assert.equal(typeof start.body.rpcId, 'string')
    assert.deepEqual(start.body.payload, {}, 'start 不带 payload 字段')

    assert.ok(popover.querySelector('.wc-qr') !== null, '生成后要画二维码')
    assert.match(popover.textContent, /pairCountdown/)
  } finally {
    await panel.unmount()
  }
})

test('配对：手机 claim 后输入 8 位码，确认时带上 sessionId 与验证码', async () => {
  const panel = await mount({
    'settings.get': { config: { serverUrl: SERVER } },
    'host.pairing.status': undefined,
    'host.pairing.start': CLAIMED,
    'host.pairing.confirm': COMPLETED,
  })
  try {
    const popover = panel.popover()
    const start = [...popover.querySelectorAll('.wc-button')].find((node) => node.textContent === 'pairGenerate')
    await panel.click(start)
    await panel.flush()

    const input = popover.querySelector('.wc-code__input')
    assert.ok(input !== null, '已扫码后要出现验证码输入框')
    assert.equal(input.getAttribute('maxlength'), '8')

    // React 受控输入用内部 value tracker 去重，必须走原型 setter 才能让它看见变化。
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(panel.dom.window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '00123456')
      input.dispatchEvent(new panel.dom.window.Event('input', { bubbles: true }))
    })

    const bind = [...popover.querySelectorAll('.wc-button')].find((node) => node.textContent === 'pairBind')
    assert.ok(bind !== undefined, '要有确认绑定按钮')
    await panel.click(bind)
    await panel.flush()

    const confirm = panel.control.calls.find((call) => call.endpoint === 'host.pairing.confirm')
    assert.ok(confirm !== undefined, '应调用 host.pairing.confirm')
    assert.deepEqual(confirm.body.payload, {
      sessionId: CREATED.sessionId,
      verificationCode: '00123456',
    })

    assert.ok(popover.textContent.includes('pairStateCompleted'), '完成后状态要变成已连接')
    assert.ok(popover.textContent.includes('Pixel 9'), '完成后要显示手机名称')
  } finally {
    await panel.unmount()
  }
})

test('配对：控制路由不存在时给出可读错误', async () => {
  const panel = await mount({})
  try {
    const popover = panel.popover()
    const generate = [...popover.querySelectorAll('.wc-button')].find((node) => node.textContent === 'pairGenerate')
    await panel.click(generate)
    await panel.flush()
    const error = popover.querySelector('.wc-error')
    assert.ok(error !== null, '404 时应显示错误行')
    assert.match(error.textContent, /CONTROL_MISSING/)
  } finally {
    await panel.unmount()
  }
})
