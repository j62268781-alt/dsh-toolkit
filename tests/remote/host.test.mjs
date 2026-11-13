/**
 * Host 半边的测试：登录状态机、脱敏、凭据边界与路由鉴权。
 *
 * 全部用假的 fetch 注入，不访问真实网络，也不依赖真实微信账号。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { maskId, normalizeBaseUrl, extractMessageText, readCredential, redirectBaseUrl } from '../../src/modules/remote/host/wechat/ilink.js'
import { createLoginManager, QR_TTL_MS } from '../../src/modules/remote/host/wechat/login.js'
import { createMonitor, STALE_RETRY_MESSAGE, STALE_INVALID_MESSAGE } from '../../src/modules/remote/host/wechat/monitor.js'
import { readConfig, Config, DEFAULT_CREDENTIAL_REF } from '../../src/modules/remote/host/wechat/config.js'
import { createRequire as createRequireForSchema } from 'node:module'
import { pathToFileURL } from 'node:url'

// Resolve the exact Cosmokit instance the installed schema runtime uses.
const schemaRequire = createRequireForSchema(import.meta.resolve('@deepseek-ai/schemastery'))
const { isVolatile } = await import(pathToFileURL(schemaRequire.resolve('@deepseek-ai/cosmokit')).href)
import { publicAccount } from '../../src/modules/remote/host/index.js'

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

test('二维码过期即进入已过期态，不再自动换码', async () => {
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
    assert.equal(qrFetches, 1, 'start 只申请一张码')
    for (let i = 0; i < 400 && manager.status().state === 'waiting_qr'; i++) await sleep(10)
    const final = manager.status()
    // 过期不是故障：进入 expired 态（不弹红色错误条），并把这张码留给前端画蒙版。
    assert.equal(final.state, 'expired')
    assert.equal(final.error, undefined)
    assert.ok(final.qrUrl !== undefined, '过期码要留着，前端才能画过期蒙版')
    assert.equal(qrFetches, 1, '过期后不得偷偷再申请新码')
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('二维码 TTL 按实测的 120s，过期后状态转 expired', async () => {
  const credentials = fakeCredentials()
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      return jsonResponse({ ret: 0, qrcode: 'q', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/a?qrcode=q&bot_type=3' })
    }
    return jsonResponse({ ret: 0, status: 'wait' })
  })
  let clock = 5_000_000
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF', now: () => clock })
    await manager.start()
    const started = manager.status()
    assert.equal(started.state, 'waiting_qr')
    // 服务端实测：同一张码约 120s 后返回 expired。旧常量 60_000 会让倒计时提前一半归零。
    assert.equal(started.expiresAt - clock, QR_TTL_MS)
    assert.equal(QR_TTL_MS, 120_000)

    // 只过 60s：仍然有效，状态不该变。
    clock += 60_000
    assert.equal(manager.status().state, 'waiting_qr')

    // 过了 120s：转 expired（不报错，码还留着给前端画蒙版）。
    clock += 61_000
    const expired = manager.status()
    assert.equal(expired.state, 'expired')
    assert.equal(expired.error, undefined)
    // 过期后仍能凭这张码的 expiresAt 认出「是刚过期」，refresh 之后才换新码。
    const refreshed = await manager.start({ force: true })
    assert.equal(refreshed.state, 'waiting_qr')
    manager.dispose()
  } finally {
    stub.restore()
  }
})

test('未过期的二维码会被复用，force 才强制换新码', async () => {
  const credentials = fakeCredentials()
  let qrFetches = 0
  const stub = stubFetch((call) => {
    if (call.url.includes('get_bot_qrcode')) {
      qrFetches += 1
      return jsonResponse({ ret: 0, qrcode: `qr-${qrFetches}`, qrcode_img_content: `https://liteapp.weixin.qq.com/q/z?qrcode=qr-${qrFetches}&bot_type=3` })
    }
    return jsonResponse({ ret: 0, status: 'wait' })
  })
  try {
    const manager = createLoginManager({ credentials, credentialRef: 'REF' })
    const first = await manager.start()
    assert.equal(qrFetches, 1)

    // 再打开一次面板：复用同一张码，不产生新的网络请求。
    const again = await manager.start()
    assert.equal(qrFetches, 1, '未过期就该复用，不该重新申请')
    assert.equal(again.qrUrl, first.qrUrl)
    assert.equal(again.expiresAt, first.expiresAt)
    assert.equal(again.loginId, first.loginId)

    // 用户点「刷新二维码」：显式要求换码。
    const forced = await manager.start({ force: true })
    assert.equal(qrFetches, 2, 'force 才申请新码')
    assert.notEqual(forced.qrUrl, first.qrUrl)
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

test('登录超时未完成会被回收成 idle，不会永远停在 waiting', async () => {
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
    // 用户只是走开了，不算失败：回到未连接，不弹错误。
    assert.equal(recycled.state, 'idle')
    assert.equal(recycled.error, undefined)
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

test('监听器收到 -14 立刻置为断开并进入快速重连，不会继续冒充已连接', async () => {
  // 实测依据：拿一个故意写错的 token 调 getUpdates，服务端同样回 {"errcode":-14,"errmsg":"session timeout"}，
  // 所以 -14 只代表「这个 token 现在不被接受」。旧实现把它当「稍后自动恢复」静默重试 30 秒，
  // 期间面板一直显示「已连接」，用户完全看不出消息已经收不到了。
  const stub = stubFetch(() => jsonResponse({ errcode: -14, errmsg: 'session timeout' }))
  try {
    const monitor = createMonitor({ getCredential: async () => CREDENTIAL, onMessage: () => {} })
    monitor.start()
    for (let i = 0; i < 100 && monitor.getState().phase !== 'stale'; i++) await sleep(10)
    const state = monitor.getState()
    assert.equal(state.running, true, '监听不应因 -14 退出')
    assert.equal(state.connected, false, '收到 -14 就已经收不到消息了，不能继续报已连接')
    assert.equal(state.phase, 'stale')
    assert.equal(state.lastError, STALE_RETRY_MESSAGE)
    assert.doesNotMatch(String(state.lastError), /超时/, '不能再说成「稍后自动重试」这种不像故障的话')
    monitor.stop()
  } finally {
    stub.restore()
  }
})

test('连续两次 -14 判定凭据失效，提示重新登录；中途成功一次立刻回绿', async () => {
  let calls = 0
  const stub = stubFetch(() => {
    calls += 1
    // 头两次被拒（模拟 token 被别处登录作废），第三次开始恢复正常。
    return calls <= 2
      ? jsonResponse({ errcode: -14, errmsg: 'session timeout' })
      : jsonResponse({ ret: 0, msgs: [], get_updates_buf: 'c', longpolling_timeout_ms: 1 })
  })
  try {
    const monitor = createMonitor({ getCredential: async () => CREDENTIAL, onMessage: () => {} })
    monitor.start()
    // 第一次 -14 → stale（等 3 秒后才会发第二次请求）。
    for (let i = 0; i < 100 && monitor.getState().phase !== 'stale'; i++) await sleep(10)
    assert.equal(monitor.getState().phase, 'stale')
    // 第二次 -14 → invalid：这次要等 STALE_RETRY_MS（3s）过去。
    for (let i = 0; i < 500 && monitor.getState().phase !== 'invalid'; i++) await sleep(10)
    assert.equal(monitor.getState().phase, 'invalid', '两次都被拒就该判定失效')
    assert.equal(monitor.getState().lastError, STALE_INVALID_MESSAGE)
    // 失效后按 60 秒降频重试，这里直接把调用次数推过去不现实，改成断言它仍在跑。
    assert.equal(monitor.getState().running, true)
    monitor.stop()
  } finally {
    stub.restore()
  }
})

test('-14 之后一次成功就回绿，lastError 清空', async () => {
  let calls = 0
  const stub = stubFetch(() => {
    calls += 1
    if (calls === 1) return jsonResponse({ errcode: -14, errmsg: 'session timeout' })
    if (calls === 2) return jsonResponse({ ret: 0, msgs: [], get_updates_buf: 'cursor-ok', longpolling_timeout_ms: 1 })
    // 成功后必须挂住：否则长轮询秒回、循环会不带停顿地打满 CPU（曾把测试进程打到 OOM）。
    return new Promise(() => {})
  })
  try {
    const monitor = createMonitor({ getCredential: async () => CREDENTIAL, onMessage: () => {} })
    monitor.start()
    for (let i = 0; i < 100 && monitor.getState().phase !== 'stale'; i++) await sleep(10)
    assert.equal(monitor.getState().phase, 'stale')
    // 3 秒后重试成功 → 立即回到 live，错误文案清掉（短暂的会话回收不该长期显示故障）。
    for (let i = 0; i < 500 && monitor.getState().phase !== 'live'; i++) await sleep(10)
    const state = monitor.getState()
    assert.equal(state.phase, 'live')
    assert.equal(state.connected, true)
    assert.equal(state.lastError, undefined)
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
