/**
 * 配对 store：限流错误怎么显示、连点「重新生成二维码」怎么处理。
 *
 * 真机回归（2026-11-13）：一分钟内连点几次「重新生成二维码」后，面板出现
 * 「配对请求失败（internal）：Pairing failed; recover the original submission if sent.」。
 * 根因是本地 server 对建会话限流 5 次/分钟/IP（server/src/pairing.ts 的 DEFAULT_LIMITS.create），
 * 第 6 次返回 429 RATE_LIMITED；ds-harness-remote 的控制路由把它统一包成
 * `{code:'internal', details:{remoteCode, retryable}}`，而这里只读 code → 面板画成 (internal)。
 *
 * 这里锁三件事：
 *   1. 真错误码取自 details.remoteCode，retryable 也要带出来；
 *   2. 二维码还在有效期内时，重复 start 复用现有会话、不再发建会话请求（不烧配额）；
 *   3. 临期（不足 30 秒）时仍然允许真的换一张新二维码。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPairing } from '../../src/modules/remote/client/pairing.js'

const SERVER = 'https://pair.example.com'

const CREATED = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  state: 'created',
  expiresAt: Date.now() + 180_000,
  serverUrl: SERVER,
  hostFingerprint: 'a'.repeat(64),
  qrPayload: `${SERVER}/pair#v1.${'b'.repeat(43)}`,
  canRetry: false,
  localSaved: false,
}

const ok = (value) => new Response(JSON.stringify({
  type: 'server-response',
  rpcId: 'rpc',
  result: { ok: true, value },
}), { status: 200, headers: { 'content-type': 'application/json' } })

const failure = (code, message, details) => new Response(JSON.stringify({
  type: 'server-response',
  rpcId: 'rpc',
  result: { ok: false, error: { code, message, details } },
}), { status: 200, headers: { 'content-type': 'application/json' } })

/** 把 fetch 换成按 endpoint 编排的假控制路由，返回调用记录。 */
function stubFetch(handlers) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const endpoint = String(url).replace('/ds-harness-remote/', '')
    calls.push({ endpoint, payload: init.body === undefined ? undefined : JSON.parse(init.body)?.payload })
    const handler = handlers[endpoint]
    if (handler === undefined) return new Response('not found', { status: 404 })
    return handler()
  }
  return calls
}

test('限流：控制路由包的 remoteCode 才是真错误码，不能再显示 (internal)', async () => {
  const originalFetch = globalThis.fetch
  stubFetch({
    'host.pairing.start': () => failure(
      'internal',
      'Pairing failed; recover the original submission if sent.',
      { remoteCode: 'RATE_LIMITED', retryable: true },
    ),
  })
  const pairing = createPairing()
  try {
    const view = await pairing.start()
    assert.equal(view, undefined, '限流时没有会话')
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.error.code, 'RATE_LIMITED', '面板要按限流处理，而不是内部错误')
    assert.equal(snapshot.error.retryable, true, '可重试标记要带出去')
    assert.match(snapshot.error.message, /Pairing failed/, '服务端原文保留，便于排查')
    assert.equal(snapshot.error.conflict, false, '限流不是账号冲突')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('连点重新生成：二维码还在有效期内就复用，不再建新会话', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({ 'host.pairing.start': () => ok(CREATED) })
  const pairing = createPairing()
  try {
    const first = await pairing.start()
    assert.equal(first.state, 'created')
    for (let index = 0; index < 6; index += 1) {
      const again = await pairing.start()
      assert.equal(again?.sessionId, first.sessionId, '有效期内复用同一张二维码')
    }
    const starts = calls.filter((call) => call.endpoint === 'host.pairing.start')
    assert.equal(starts.length, 1, '连点只允许建一次会话（服务器限流 5 次/分钟）')
    assert.equal(pairing.getSnapshot().error, undefined, '复用不该留下错误行')
    assert.equal(pairing.getSnapshot().view.sessionId, first.sessionId)
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('临期（不足 30 秒）点刷新：允许真的换一张新二维码', async () => {
  const originalFetch = globalThis.fetch
  let count = 0
  const calls = stubFetch({
    'host.pairing.start': () => {
      count += 1
      return ok({ ...CREATED, expiresAt: Date.now() + 5_000 })
    },
  })
  const pairing = createPairing()
  try {
    await pairing.start()
    await pairing.start()
    const starts = calls.filter((call) => call.endpoint === 'host.pairing.start')
    assert.equal(starts.length, 2, '临期时刷新要真的重建会话，否则用户只能等到过期')
    assert.equal(count, 2)
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('限流失败后不留下已作废的二维码', async () => {
  const originalFetch = globalThis.fetch
  let mode = 'ok'
  const calls = stubFetch({
    'host.pairing.start': () => (mode === 'ok'
      ? ok({ ...CREATED, expiresAt: Date.now() + 5_000 })
      : failure('internal', 'Pairing failed; recover the original submission if sent.', {
        remoteCode: 'RATE_LIMITED',
        retryable: true,
      })),
  })
  const pairing = createPairing()
  try {
    await pairing.start()
    assert.equal(pairing.getSnapshot().view.state, 'created')

    // 临期会话（不足 30 秒）会真的去建新的；宿主在限流前已经取消了旧会话。
    mode = 'limited'
    const view = await pairing.start()
    assert.equal(view, undefined)
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.error.code, 'RATE_LIMITED')
    assert.equal(snapshot.view, undefined, '作废的二维码不能再画在面板上')

    // 视图被收起来之后，下一次点击是真的重试，而不是复用那张死码。
    // 但限流刚发生，冷却窗口内的点击不出请求（见下面的冷却用例）；
    // 跳过冷却再点，就必须是一次真实的建会话。
    const realNow = Date.now
    const before = calls.filter((call) => call.endpoint === 'host.pairing.start').length
    Date.now = () => realNow() + 61_000
    try {
      await pairing.start()
    } finally {
      Date.now = realNow
    }
    const starts = calls.filter((call) => call.endpoint === 'host.pairing.start')
    assert.equal(starts.length, before + 1, '每次点击都走真实建会话（此时限流已恢复就会成功）')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('已结束的会话（cancelled/expired）再生成：正常走建会话', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({ 'host.pairing.start': () => ok({ ...CREATED, state: 'cancelled' }) })
  const pairing = createPairing()
  try {
    await pairing.start()
    await pairing.start()
    const starts = calls.filter((call) => call.endpoint === 'host.pairing.start')
    assert.equal(starts.length, 2, '终态会话不能复用')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('限流后进入 60 秒冷却：冷却期内点击不再打宿主', async () => {
  // server 回的是 Retry-After: 60，这一分钟内再点必然还是 429。继续发请求只会：
  // 白打一次宿主、把错误行重新画一遍（卡片上下弹）。冷却窗口把这六十秒挡在本地。
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'host.pairing.start': () => failure(
      'internal',
      'Pairing failed; recover the original submission if sent.',
      { remoteCode: 'RATE_LIMITED', retryable: true },
    ),
  })
  const pairing = createPairing()
  const realNow = Date.now
  try {
    await pairing.start()
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.error.code, 'RATE_LIMITED')
    assert.equal(snapshot.cooldownUntil > realNow(), true, '限流要开冷却窗口（面板据此倒计时）')
    assert.equal(snapshot.cooldownUntil - realNow() <= 60_000, true, '冷却不超过 Retry-After 的 60 秒')

    const before = calls.filter((call) => call.endpoint === 'host.pairing.start').length
    await pairing.start()
    await pairing.start()
    const during = calls.filter((call) => call.endpoint === 'host.pairing.start').length
    assert.equal(during, before, '冷却期内连点不该再发建会话请求')
    assert.equal(pairing.getSnapshot().error.code, 'RATE_LIMITED', '错误行原地不动，卡片高度不跳')

    // 冷却过去之后，点击要恢复正常（不能把按钮永久锁死）。
    Date.now = () => realNow() + 61_000
    await pairing.start()
    const after = calls.filter((call) => call.endpoint === 'host.pairing.start').length
    assert.equal(after, before + 1, '冷却结束后要重新允许建会话')
  } finally {
    Date.now = realNow
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('重试进行中不清空错误行：面板不会在每次点击时上下弹两次', async () => {
  // 卡片是「底边贴着按钮、向上长」的（position.js）。旧实现每次 start 先把 error 清掉、
  // 失败再写回，高度一来一回就是两次跳动；真机连点「重新生成二维码」看到的抖动即此。
  const originalFetch = globalThis.fetch
  let mode = 'fail'
  let release
  const calls = stubFetch({
    'host.pairing.start': () => {
      if (mode === 'fail') {
        return failure('internal', 'upstream unavailable', {
          remoteCode: 'PAIRING_UPSTREAM_UNAVAILABLE',
          retryable: true,
        })
      }
      return new Promise((resolve) => {
        release = () => resolve(ok(CREATED))
      })
    },
  })
  const pairing = createPairing()
  try {
    await pairing.start()
    assert.equal(pairing.getSnapshot().error.code, 'PAIRING_UPSTREAM_UNAVAILABLE')

    mode = 'pending'
    const retry = pairing.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const during = pairing.getSnapshot()
    assert.equal(during.busy, true, '重试已经发出（按钮进入忙碌态）')
    assert.equal(during.error?.code, 'PAIRING_UPSTREAM_UNAVAILABLE', '重试期间错误行必须留着')

    release()
    const view = await retry
    assert.equal(view?.state, 'created')
    assert.equal(pairing.getSnapshot().error, undefined, '成功之后才清掉错误行')
    assert.equal(calls.filter((call) => call.endpoint === 'host.pairing.start').length, 2)
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})
