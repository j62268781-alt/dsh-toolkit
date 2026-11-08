/**
 * Host 半边的测试：登录状态机、脱敏、凭据边界与路由鉴权。
 *
 * 全部用假的 fetch 注入，不访问真实网络，也不依赖真实微信账号。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { maskId, normalizeBaseUrl, extractMessageText, readCredential, redirectBaseUrl } from '../../src/modules/weixin-clawbot/host/ilink.js'
import { createLoginManager } from '../../src/modules/weixin-clawbot/host/login.js'
import { createMonitor } from '../../src/modules/weixin-clawbot/host/monitor.js'
import { readConfig, Config, DEFAULT_CREDENTIAL_REF } from '../../src/modules/weixin-clawbot/host/config.js'
import { createRequire as createRequireForSchema } from 'node:module'
import { pathToFileURL } from 'node:url'

// Resolve the exact Cosmokit instance the installed schema runtime uses.
const schemaRequire = createRequireForSchema(import.meta.resolve('@deepseek-ai/schemastery'))
const { isVolatile } = await import(pathToFileURL(schemaRequire.resolve('@deepseek-ai/cosmokit')).href)
import { publicAccount } from '../../src/modules/weixin-clawbot/host/index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 一个只按脚本回答的内存凭据服务。 */
function fakeCredentials(initial) {
  const store = new Map(initial === undefined ? [] : [[initial.ref, initial.value]])
  const writes = []
  return {
    store,
    writes,
    async resolve(ref) {
      const value = store.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    },
    async set(ref, value) {
      if (value === '') throw new Error('empty value')
      writes.push({ ref, value })
      store.set(ref, value)
    },
    async unset(ref) {
      writes.push({ ref, value: undefined })
      store.delete(ref)
    },
  }
}

/** 替换全局 fetch，返回一个记录器。 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init }
    calls.push(call)
    return handler(call)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const CREDENTIAL = {
  token: 'super-secret-token-value',
  accountId: 'ilink-bot-account-0123456789',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  userId: 'user-abcdefghijkl',
}

// ── 纯函数 ─────────────────────────────────────────────────────

test('maskId 对短标识整体打码，不会把原文当脱敏结果', () => {
  assert.equal(maskId(''), '')
  assert.equal(maskId('abc'), '***')
  assert.equal(maskId('0123456789'), '**********')
  // 长标识保留首尾各 4 位，中间打码。
  assert.equal(maskId('0123456789abcdef'), '0123******cdef')
  assert.equal(maskId('  padded-id-value-with-length  '), 'padd******ngth')
  // 任何情况下脱敏结果都不能等于原文。
  for (const value of ['abc', '0123456789', '0123456789abcdef', 'a'.repeat(40)]) {
    assert.notEqual(maskId(value), value)
  }
})

test('normalizeBaseUrl 只接受 https 并去掉尾斜杠', () => {
  assert.equal(normalizeBaseUrl('https://ilinkai.weixin.qq.com/'), 'https://ilinkai.weixin.qq.com')
  assert.equal(normalizeBaseUrl(undefined), 'https://ilinkai.weixin.qq.com')
  assert.equal(normalizeBaseUrl(''), 'https://ilinkai.weixin.qq.com')
  assert.throws(() => normalizeBaseUrl('http://insecure.example.com'), /HTTPS/)
  assert.throws(() => normalizeBaseUrl('not a url'), /合法/)
})

test('redirectBaseUrl 只接受主机名，拒绝协议与路径注入', () => {
  assert.equal(redirectBaseUrl('ilink-1.example.com'), 'https://ilink-1.example.com')
  assert.equal(redirectBaseUrl('ilink-1.example.com:8443'), 'https://ilink-1.example.com:8443')
  assert.throws(() => redirectBaseUrl(''), /没有返回/)
  assert.throws(() => redirectBaseUrl('https://evil.example.com/x'), /格式无效/)
  assert.throws(() => redirectBaseUrl('evil.com/../etc'), /格式无效/)
  assert.throws(() => redirectBaseUrl('user@evil.com'), /格式无效/)
})

test('extractMessageText 只取文本项，缺失时返回空串', () => {
  assert.equal(extractMessageText({ item_list: [{ text_item: { text: 'hello' } }] }), 'hello')
  assert.equal(extractMessageText({ item_list: [{ text_item: { text: 'a' } }, { text_item: { text: 'b' } }] }), 'a\nb')
  assert.equal(extractMessageText({ item_list: [{ image_item: {} }] }), '')
  assert.equal(extractMessageText({}), '')
  assert.equal(extractMessageText(undefined), '')
})

test('readCredential 缺字段时报可读错误，不编造凭据', () => {
  assert.throws(() => readCredential({ status: 'confirmed' }), /没有返回完整凭据/)
  assert.throws(() => readCredential({ bot_token: 't' }), /没有返回完整凭据/)
  const credential = readCredential({
    bot_token: 'token',
    ilink_bot_id: 'account',
    baseurl: 'https://ilinkai.weixin.qq.com/',
    ilink_user_id: 'user',
  })
  assert.deepEqual(credential, {
    token: 'token',
    accountId: 'account',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    userId: 'user',
  })
  // userId 缺失时不能出现 undefined 字段。
  assert.equal(Object.hasOwn(readCredential({ bot_token: 't', ilink_bot_id: 'a' }), 'userId'), false)
})

test('publicAccount 只暴露掩码账号与 host', () => {
  assert.equal(publicAccount(undefined), undefined)
  const view = publicAccount(CREDENTIAL)
  assert.equal(view.baseUrlHost, 'ilinkai.weixin.qq.com')
  assert.notEqual(view.accountId, CREDENTIAL.accountId)
  assert.equal(view.accountId, maskId(CREDENTIAL.accountId))
  // 整个对外结构里不能出现 token。
  assert.equal(JSON.stringify(view).includes('super-secret'), false)
})

test('配置读取有默认值且 credentialRef 独立于官方插件', () => {
  assert.equal(readConfig({}).credentialRef, DEFAULT_CREDENTIAL_REF)
  assert.equal(DEFAULT_CREDENTIAL_REF, 'WEIXIN_CLAWBOT_CREDENTIAL')
  assert.notEqual(DEFAULT_CREDENTIAL_REF, 'WEIXIN_ILINK_CREDENTIAL')
  assert.equal(readConfig({ enabled: false }).enabled, false)
  assert.equal(readConfig({ credentialRef: '  ' }).credentialRef, DEFAULT_CREDENTIAL_REF)
  assert.equal(readConfig({ credentialRef: 'CUSTOM_REF' }).credentialRef, 'CUSTOM_REF')
  // Schemastery wraps volatile leaves in a { get() } cell.
  const defaults = Config({})
  const read = (key) => (typeof defaults[key]?.get === 'function' ? defaults[key].get() : defaults[key])
  assert.equal(read('enabled'), true)
  assert.equal(read('monitorOnConnect'), true)
  assert.equal(read('credentialRef'), DEFAULT_CREDENTIAL_REF)
  // 全部叶子都是 volatile：运行时可改，不需要重启。
  for (const key of ['enabled', 'credentialRef', 'monitorOnConnect']) {
    assert.equal(isVolatile(defaults[key]), true, `${key} 必须是 volatile`)
  }
})

// ── 登录状态机 ─────────────────────────────────────────────────

test('登录流程：申请二维码 → 扫码 → 确认 → 写入凭据，且响应不含 token', async () => {
  const credentials = fakeCredentials()
  const statuses = ['wait', 'scaned', 'confirmed']
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'qr-id-1', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/x?qrcode=qr-id-1&bot_type=3' })
    }
    if (call.url.includes('get_qrcode_status')) {
      const next = statuses.shift() ?? 'wait'
      return jsonResponse(next === 'confirmed'
        ? { ret: 0, status: 'confirmed', bot_token: CREDENTIAL.token, ilink_bot_id: CREDENTIAL.accountId, baseurl: CREDENTIAL.baseUrl, ilink_user_id: CREDENTIAL.userId }
        : { ret: 0, status: next })
    }
    throw new Error(`unexpected URL ${call.url}`)
  })
  try {
    const manager = createLoginManager({ credentials, credentialRef: DEFAULT_CREDENTIAL_REF })
    const started = await manager.start()
    assert.equal(started.state, 'waiting_qr')
    assert.match(started.qrUrl, /^https:\/\/liteapp\.weixin\.qq\.com\/q\//)
    // 起始状态里不含 token。
    assert.equal(JSON.stringify(started).includes(CREDENTIAL.token), false)

    // 等状态机跑完。
    for (let i = 0; i < 200 && manager.status().state !== 'confirmed'; i++) await sleep(10)
    const final = manager.status()
    assert.equal(final.state, 'confirmed')
    assert.equal(final.account.accountId, maskId(CREDENTIAL.accountId))
    assert.equal(final.account.baseUrlHost, 'ilinkai.weixin.qq.com')
    assert.equal(final.qrUrl, undefined, '确认后二维码应被清掉')
    assert.equal(JSON.stringify(final).includes(CREDENTIAL.token), false, '状态响应绝不能含 token')

    // 凭据落到了独立 ref。
    const stored = await credentials.resolve(DEFAULT_CREDENTIAL_REF)
    assert.ok(stored !== undefined)
    assert.equal(JSON.parse(stored.value).token, CREDENTIAL.token)

    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('扫码后需要数字校验码：need_verifycode → submitCode → 继续', async () => {
  const credentials = fakeCredentials()
  let statusCall = 0
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'qr-id-2', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/y?qrcode=qr-id-2&bot_type=3' })
    }
    statusCall += 1
    if (statusCall === 1) return jsonResponse({ ret: 0, status: 'need_verifycode' })
    // 第二轮必须带上 verify_code 才继续。
    if (call.url.includes('verify_code=4321')) {
      return jsonResponse({ ret: 0, status: 'confirmed', bot_token: 'tok', ilink_bot_id: 'acc-0123456789', baseurl: 'https://ilinkai.weixin.qq.com' })
    }
    return jsonResponse({ ret: 0, status: 'need_verifycode' })
  })
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF' })
    await manager.start()
    for (let i = 0; i < 200 && manager.status().state !== 'need_code'; i++) await sleep(10)
    assert.equal(manager.status().state, 'need_code')

    // 非法校验码要被拒。
    assert.throws(() => manager.submitCode('abc'), /2-8 位数字/)
    assert.throws(() => manager.submitCode(''), /2-8 位数字/)

    manager.submitCode('4321')
    for (let i = 0; i < 300 && manager.status().state !== 'confirmed'; i++) await sleep(10)
    assert.equal(manager.status().state, 'confirmed')
    assert.ok(stub.calls.some((call) => call.url.includes('verify_code=4321')))
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('二维码过期会自动换码，超过上限才失败', async () => {
  const credentials = fakeCredentials()
  let qrFetches = 0
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      qrFetches += 1
      return jsonResponse({ ret: 0, qrcode: `qr-${qrFetches}`, qrcode_img_content: `https://liteapp.weixin.qq.com/q/z?qrcode=qr-${qrFetches}&bot_type=3` })
    }
    return jsonResponse({ ret: 0, status: 'expired' })
  })
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF' })
    await manager.start()
    for (let i = 0; i < 400 && manager.status().state !== 'failed'; i++) await sleep(10)
    const final = manager.status()
    assert.equal(final.state, 'failed')
    assert.match(final.error, /过期/)
    assert.ok(qrFetches >= 2, `应当换过码，实际申请 ${qrFetches} 次`)
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('已绑定其他实例时报错，不会把旧凭据覆盖成坏值', async () => {
  const credentials = fakeCredentials()
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'q', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/a?qrcode=q&bot_type=3' })
    }
    return jsonResponse({ ret: 0, status: 'binded_redirect' })
  })
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF' })
    await manager.start()
    for (let i = 0; i < 200 && manager.status().state !== 'failed'; i++) await sleep(10)
    assert.equal(manager.status().state, 'failed')
    assert.match(manager.status().error, /已绑定其他实例/)
    assert.equal(credentials.writes.length, 0, '失败路径不得写凭据')
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('scaned_but_redirect 会切换节点，且只接受合法主机名', async () => {
  const credentials = fakeCredentials()
  const seenHosts = []
  let redirected = false
  const stub = stubFetch((call) => {
    seenHosts.push(new URL(call.url).host)
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'q', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/a?qrcode=q&bot_type=3' })
    }
    if (!redirected) {
      redirected = true
      return jsonResponse({ ret: 0, status: 'scaned_but_redirect', redirect_host: 'ilink-2.example.com' })
    }
    return jsonResponse({ ret: 0, status: 'wait' })
  })
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF' })
    await manager.start()
    for (let i = 0; i < 300 && !seenHosts.includes('ilink-2.example.com'); i++) await sleep(10)
    assert.ok(seenHosts.includes('ilink-2.example.com'), `应切到新节点，实际 ${seenHosts.join(',')}`)
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('取消与断开：cancel 不写凭据，logout 清空凭据', async () => {
  const credentials = fakeCredentials({ ref: 'REF', value: JSON.stringify(CREDENTIAL) })
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'q', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/a?qrcode=q&bot_type=3' })
    }
    return jsonResponse({ ret: 0, status: 'wait' })
  })
  let disconnected = 0
  try {
    const manager = createLoginManager({
      credentials,
      credentialRef: 'REF',
      onDisconnected: async () => { disconnected += 1 },
    })
    await manager.start()
    manager.cancel()
    assert.equal(manager.status().state, 'idle')
    assert.equal(JSON.stringify(credentials.writes.filter((w) => w.value !== undefined)).includes('token'), false)

    // logout：清空凭据。
    await manager.logout()
    assert.equal(await credentials.resolve('REF'), undefined)
    assert.equal(manager.status().state, 'idle')
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('登录超时未完成会被回收，不会永远停在 waiting', async () => {
  const credentials = fakeCredentials()
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'q', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/a?qrcode=q&bot_type=3' })
    }
    return jsonResponse({ ret: 0, status: 'wait' })
  })
  let clock = 1_000_000
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF', now: () => clock })
    await manager.start()
    assert.equal(manager.status().state, 'waiting_qr')
    // 跳过 5 分钟回收窗口。
    clock += 5 * 60_000 + 1
    const recycled = manager.status()
    assert.equal(recycled.state, 'failed')
    assert.match(recycled.error, /超时/)
    manager.dispose()
  } finally {
    stub.restore()
  }
})

// ── 监听器 ─────────────────────────────────────────────────────

test('监听器只把脱敏摘要交给 UI，并在 stop 后停止', async () => {
  const received = []
  let calls = 0
  const stub = stubFetch((call) => {
    calls += 1
    if (calls === 1) {
      return jsonResponse({
        ret: 0,
        msgs: [{ from_user_id: 'wxid_abcdefghijklmnop', item_list: [{ text_item: { text: '你好，这是一条测试消息' } }] }],
        get_updates_buf: 'cursor-1',
        longpolling_timeout_ms: 1,
      })
    }
    return new Promise(() => {}) // 之后一直挂着，直到被 abort
  })
  try {
    const monitor = createMonitor({
      getCredential: async () => CREDENTIAL,
      onMessage: (summary) => received.push(summary),
    })
    monitor.start()
    for (let i = 0; i < 300 && received.length === 0; i++) await sleep(10)
    assert.equal(received.length, 1)
    assert.equal(received[0].text, '你好，这是一条测试消息')
    // 发送者必须是脱敏的。
    assert.notEqual(received[0].from, 'wxid_abcdefghijklmnop')
    assert.equal(JSON.stringify(received[0]).includes(CREDENTIAL.token), false)
    monitor.stop()
    assert.equal(monitor.getState().running, false)
  } finally {
    stub.restore()
  }
})

test('监听器在 token 失效（-14）时暂停重试而不是崩溃', async () => {
  const stub = stubFetch(() => jsonResponse({ errcode: -14, errmsg: 'session timeout' }))
  try {
    const monitor = createMonitor({ getCredential: async () => CREDENTIAL, onMessage: () => {} })
    monitor.start()
    await sleep(60)
    const state = monitor.getState()
    assert.equal(state.running, true, '监听不应因 -14 退出')
    assert.match(String(state.lastError), /超时/)
    monitor.stop()
  } finally {
    stub.restore()
  }
})

test('没有凭据时监听器报告未连接，探测则抛出可读错误', async () => {
  const monitor = createMonitor({ getCredential: async () => undefined, onMessage: () => {} })
  monitor.start()
  await sleep(40)
  assert.equal(monitor.getState().connected, false)
  monitor.stop()
  await assert.rejects(() => monitor.probe(), /请先连接微信/)
})
