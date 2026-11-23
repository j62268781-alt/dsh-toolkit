/**
 * 「设置 › 移动端」里那个手机开关。
 *
 * 它管的是**本插件自己的功能位**（`/preferences` 的 `phone`，决定侧栏「远程连接」里
 * 手机这一栏还给不给用），不是上游 ds-harness-remote 的 host 授权：后者的
 * `host.authorization.set{enabled:true}` 要先拿本机 client 凭据，只接受扫码配对的机器上
 * 必然被 `requireIdentity()` 拒（DEVICE_SCOPE_REQUIRED），开关弹回去 —— 用户报的就是
 * 「点了没反应」。所以这里断言：
 *   - 打开只写功能位，不发任何 ds-harness-remote 控制请求；
 *   - 关闭先写功能位再解绑：撤销设备（settings.logout）、忘掉本地快照、清配对残留；
 *   - 写功能位本身失败才退回原值并弹错误 toast；解绑那一步失败不回翻开关。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'

const CONTROL_PREFIX = '/ds-harness-remote'
const PLUGIN_PREFIX = '/api/plugins/toolkit/remote/'
const LAST_PAIRED_KEY = 'dsh-toolkit-remote/last-paired.v1'

let panelModule

async function loadPanel() {
  if (panelModule !== undefined) return panelModule
  const result = await build({
    entryPoints: ['src/modules/mobile/client/settings-panel.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    jsx: 'automatic',
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.jsx': 'jsx',
      '.js': 'jsx',
      '.css': 'text',
      '.webp': 'dataurl',
    },
    write: false,
    logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = 'node_modules/.cache/mobile_settings_panel.mjs'
  await writeFile(out, result.outputFiles[0].text)
  panelModule = await import(`../../${out}?case=${Math.random()}`)
  return panelModule
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

/**
 * 假后端：两条前缀分别记账。
 * `plugin:` 回插件自己的路由（偏好读写、清本地状态），`control:` 回 ds-harness-remote。
 */
function stubFetch(replies) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const raw = String(url)
    const body = init.body === undefined ? undefined : JSON.parse(init.body)
    if (raw.startsWith(PLUGIN_PREFIX)) {
      const rest = raw.slice(PLUGIN_PREFIX.length)
      const endpoint = rest.split('?')[0]
      const query = rest.includes('?') ? rest.slice(rest.indexOf('?') + 1) : ''
      const key = `plugin:${endpoint}`
      calls.push({ endpoint: key, body, query, method: init.method ?? 'GET' })
      const reply = replies[key]
      if (reply === undefined) {
        return json(endpoint === 'preferences'
          ? { ok: true, phone: true, wechat: false, running: false }
          : { ok: true })
      }
      return json(reply)
    }
    if (raw.startsWith(`${CONTROL_PREFIX}/`)) {
      const endpoint = raw.slice(CONTROL_PREFIX.length + 1)
      calls.push({ endpoint: `control:${endpoint}`, body })
      const reply = replies[`control:${endpoint}`]
      if (reply === undefined) return json({ result: { ok: false, error: { code: 'NO_STUB', message: 'no stub' } } })
      return json({ result: reply.ok === false ? reply : { ok: true, value: reply.value } })
    }
    throw new Error(`unexpected fetch: ${raw}`)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** 宿主 primitives 的 Switch 替身：语义与真组件一致（role=switch + onChange(bool)）。 */
function fakeSwitch() {
  return function Switch(props) {
    return React.createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked === true,
      'aria-label': props.label,
      disabled: props.disabled === true,
      onClick: () => props.onChange(props.checked !== true),
    }, props.label)
  }
}

test('the download banner renders without a bordered or clipping wrapper', async () => {
  const view = await mount({})
  try {
    const section = view.dom.window.document.querySelector('section[aria-label="下载移动端"]')
    assert.ok(section?.querySelector(':scope > img.mbm-hero'))
    assert.equal(section.querySelector('a')?.textContent, '下载')
  } finally {
    await view.unmount()
  }
})

async function mount(replies) {
  const { createMobileSettings } = await loadPanel()
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.localStorage = dom.window.localStorage
  globalThis.Response ??= Response
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const control = stubFetch(replies)
  const Panel = createMobileSettings(React, { primitives: { Switch: fakeSwitch() } })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  // readFeatures() 是异步的：等它把 ready 打开，否则开关是 disabled。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const phone = () => dom.window.document.querySelector('button[aria-label="允许手机控制此设备"]')
  return {
    dom,
    calls: control.calls,
    phone,
    // 失败提示是全局 toast（`src/client/ui/toast.ts` 挂在 document.body 上的那个栈），
    // 面板里不再留一行红字 —— 那一行会把整张卡片往下顶。
    error: () => dom.window.document.querySelector('.sk-toast--error'),
    async click(node) {
      await act(async () => {
        node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      control.restore()
    },
  }
}

const callsTo = (calls, endpoint) => calls.filter((call) => call.endpoint === endpoint)

test('打开手机入口：只写本插件的功能位，不碰 ds-harness-remote 的 host 授权', async () => {
  const panel = await mount({
    'plugin:preferences': { ok: true, phone: false, wechat: false, running: false },
  })
  try {
    assert.equal(panel.phone().disabled, false, '读到偏好后开关应当可点')
    assert.equal(panel.phone().getAttribute('aria-checked'), 'false')

    await panel.click(panel.phone())

    assert.equal(panel.phone().getAttribute('aria-checked'), 'true', '开关应当打开')
    const writes = callsTo(panel.calls, 'plugin:preferences').filter((call) => call.method === 'POST')
    assert.equal(writes.length, 1, '应当写一次偏好')
    assert.deepEqual(writes[0].body, { phone: true })
    assert.deepEqual(
      panel.calls.filter((call) => call.endpoint.startsWith('control:')),
      [],
      '功能位是本插件的事，不该去调上游 host.authorization.set',
    )
    assert.equal(panel.error() === null, true, '成功不该留错误')
  } finally {
    await panel.unmount()
  }
})

test('关闭手机入口：先关功能位，再解绑并清掉本地残留', async () => {
  const panel = await mount({
    'plugin:preferences': { ok: true, phone: true, wechat: false, running: false },
    'control:settings.logout': { ok: true, value: { config: { serverUrl: 'https://remote.example' } } },
  })
  try {
    panel.dom.window.localStorage.setItem(LAST_PAIRED_KEY, '{"deviceName":"phone"}')
    assert.equal(panel.phone().getAttribute('aria-checked'), 'true')

    await panel.click(panel.phone())

    assert.equal(panel.phone().getAttribute('aria-checked'), 'false', '开关应当关闭')
    const writes = callsTo(panel.calls, 'plugin:preferences').filter((call) => call.method === 'POST')
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].body, { phone: false })

    const logouts = callsTo(panel.calls, 'control:settings.logout')
    assert.equal(logouts.length, 1, '关入口要撤销本机授权（解绑）')
    assert.equal(logouts[0].body.type, 'client-request')

    const purges = callsTo(panel.calls, 'plugin:local-state/purge')
    assert.equal(purges.length, 1, '配对残留要清掉，否则重启后又把本机当配对主机')
    assert.match(purges[0].query, /serverUrl=https%3A%2F%2Fremote\.example/)

    assert.equal(
      panel.dom.window.localStorage.getItem(LAST_PAIRED_KEY),
      null,
      '本地快照要一起删掉，面板不该再显示「上次配对的手机」',
    )
    assert.equal(panel.error() === null, true)
  } finally {
    await panel.unmount()
  }
})

test('写功能位失败时退回原值并报错，且不发解绑', async () => {
  const panel = await mount({
    'plugin:preferences': { ok: true, phone: true, wechat: false, running: false },
  })
  try {
    // 第二次 GET 之后的 POST 要失败：用一次性替换模拟写入被拒。
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).startsWith(PLUGIN_PREFIX) && init.method === 'POST') {
        return json({ ok: false, error: '写不进去' }, 500)
      }
      return json({ ok: true, phone: true, wechat: false, running: false })
    }

    await panel.click(panel.phone())

    assert.equal(panel.phone().getAttribute('aria-checked'), 'true', '写失败要退回原值')
    assert.equal(callsTo(panel.calls, 'control:settings.logout').length, 0, '功能位没落地就不该解绑')
    const error = panel.error()
    assert.equal(error !== null, true, '失败要弹一条错误 toast')
    assert.match(error.textContent, /HTTP 500/)
  } finally {
    await panel.unmount()
  }
})
