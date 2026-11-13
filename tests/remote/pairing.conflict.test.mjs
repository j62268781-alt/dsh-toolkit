/**
 * 配对 store：账号冲突后的行为。
 *
 * 真机回归（2026-11-12）：云端服务器上还留着这台设备的旧账号，新的配对会话
 * 发的是另一个账号，ds-harness-remote 的 adoptPairing 抛出
 * PAIRING_ACCOUNT_CONFLICT（控制路由包成 `{code:'internal', details:{remoteCode}}`）。
 * 症状是面板每 2.5 秒重试一次、错误行来回闪。
 *
 * 这里锁两件事：
 *   1. 冲突属于致命错误 → `halted`，refresh() 不再发请求（轮询由面板停掉）；
 *   2. `unbind()` 先 `settings.logout`，再读一次会话状态，手机已确认的话直接完成配对。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPairing, isAccountConflict } from '../../src/modules/remote/client/pairing.js'

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

const COMPLETED = {
  ...CREATED,
  state: 'completed',
  localSaved: true,
  mobile: { deviceId: 'phone-1', name: 'Pixel 9', fingerprint: 'c'.repeat(64) },
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
    const text = String(url)
    if (text.includes('/local-state/purge')) {
      calls.push({ endpoint: 'local-state/purge', payload: undefined })
      return new Response(JSON.stringify({ ok: true, removed: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const endpoint = text.replace('/ds-harness-remote/', '')
    const body = init.body === undefined ? undefined : JSON.parse(init.body)
    calls.push({ endpoint, payload: body?.payload })
    const handler = handlers[endpoint]
    if (handler === undefined) return new Response('not found', { status: 404 })
    return handler(body?.payload)
  }
  return calls
}

test('hostStatus：面板轮询依赖这个导出，撤销时立刻记下 authError', async () => {
  const originalFetch = globalThis.fetch
  stubFetch({
    status: () => ok({
      host: {
        configured: true,
        authorized: false,
        error: 'DEVICE_REVOKED',
        pairingHostOnly: true,
        connectedClients: [],
      },
    }),
  })
  const pairing = createPairing()
  try {
    // 导出缺失时面板的 setInterval 里会抛 TypeError，状态永远不更新（真机踩过）。
    assert.equal(typeof pairing.hostStatus, 'function', 'hostStatus 必须对外暴露')
    await pairing.hostStatus()
    assert.equal(pairing.getSnapshot().authError, 'DEVICE_REVOKED', '授权被撤销要写进 store')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('isAccountConflict：认 control 包出来的 remoteCode，也认原文', () => {
  assert.equal(isAccountConflict({ code: 'internal', details: { remoteCode: 'PAIRING_ACCOUNT_CONFLICT' } }), true)
  assert.equal(isAccountConflict({ code: 'internal', message: 'Pairing cannot replace the current account.' }), true)
  assert.equal(isAccountConflict({ code: 'internal', message: 'boom' }), false)
})

test('账号冲突：halted 之后 refresh 不再打控制路由', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'host.pairing.status': () => ok(CREATED),
    'host.pairing.confirm': () => failure('internal', 'Pairing cannot replace the current account.', {
      remoteCode: 'PAIRING_ACCOUNT_CONFLICT',
    }),
  })
  const pairing = createPairing()
  try {
    await pairing.refresh()
    assert.equal(pairing.getSnapshot().view.state, 'created')

    const confirmed = await pairing.confirm('00123456')
    assert.equal(confirmed, undefined, '冲突时 confirm 没有结果')
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.error.conflict, true, '错误要标记成账号冲突')
    assert.equal(snapshot.halted, true, '致命错误要停掉自动轮询')

    const before = calls.length
    await pairing.refresh()
    await pairing.refresh()
    assert.equal(calls.length, before, 'halted 后 refresh 不能再发请求（否则错误行一直闪）')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('解绑并重试：先 settings.logout，再读状态并完成配对', async () => {
  const originalFetch = globalThis.fetch
  const confirmCalls = stubFetch({
    'host.pairing.status': () => ok(CREATED),
    'host.pairing.confirm': () => failure('internal', 'Pairing cannot replace the current account.', {
      remoteCode: 'PAIRING_ACCOUNT_CONFLICT',
    }),
  })
  const pairing = createPairing()
  try {
    await pairing.refresh()
    await pairing.confirm('00123456')
    assert.equal(pairing.getSnapshot().halted, true)

    // 手机端已经确认过，服务器侧是 completed：解绑后重读即可落盘。
    const unbindCalls = []
    stubFetch({
      'settings.logout': () => ok({ config: { serverUrl: SERVER } }),
      'settings.get': () => ok({ config: { serverUrl: SERVER } }),
      'host.pairing.status': () => ok(COMPLETED),
    })
    const innerFetch = globalThis.fetch
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      unbindCalls.push(
        text.includes('/local-state/purge') ? 'local-state/purge' : text.replace('/ds-harness-remote/', ''),
      )
      return innerFetch(url, init)
    }

    const view = await pairing.unbind()
    const snapshot = pairing.getSnapshot()
    assert.deepEqual(unbindCalls, ['settings.logout', 'local-state/purge', 'settings.get', 'host.pairing.status'])
    assert.equal(view.state, 'completed')
    assert.equal(snapshot.error, undefined, '解绑成功后要清掉错误')
    assert.equal(snapshot.halted, false)
    assert.equal(confirmCalls.length, 2, '确认阶段只打过 status + confirm')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('解绑：远端注销报 AUTH_INVALID 时仍然继续重读状态', async () => {
  const originalFetch = globalThis.fetch
  stubFetch({
    'settings.logout': () => failure('internal', 'AUTH_INVALID'),
    'settings.get': () => ok({ config: { serverUrl: SERVER } }),
    'host.pairing.status': () => ok(COMPLETED),
  })
  const pairing = createPairing()
  try {
    const view = await pairing.unbind()
    const snapshot = pairing.getSnapshot()
    assert.equal(view?.state, 'completed', '本地凭据已清，注销失败不应中断解绑')
    assert.equal(snapshot.error, undefined)
    assert.equal(snapshot.halted, false)
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('解除绑定：只注销旧设备，不替用户生成新二维码', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'settings.logout': () => ok({ config: { serverUrl: SERVER } }),
    'settings.get': () => ok({ config: { serverUrl: SERVER } }),
    'host.pairing.status': () => ok(undefined),
    'host.pairing.start': () => ok(CREATED),
  })
  const pairing = createPairing()
  try {
    const view = await pairing.unbind()
    assert.deepEqual(calls.map((call) => call.endpoint), [
      'settings.logout',
      'local-state/purge',
      'settings.get',
      'host.pairing.status',
    ])
    assert.equal(view, undefined, '解除绑定后停在未绑定态')
    assert.equal(pairing.getSnapshot().view, undefined)
    assert.equal(pairing.getSnapshot().error, undefined)
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('更换手机：注销旧设备后立刻生成新二维码', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'settings.logout': () => ok({ config: { serverUrl: SERVER } }),
    'settings.get': () => ok({ config: { serverUrl: SERVER } }),
    'host.pairing.status': () => ok(undefined),
    'host.pairing.start': () => ok(CREATED),
  })
  const pairing = createPairing()
  try {
    const view = await pairing.unbind({ restart: true })
    // 更换手机不先读会话状态：终点一定是新二维码，读到的旧 completed 会把面板画回旧手机。
    assert.deepEqual(calls.map((call) => call.endpoint), [
      'settings.logout',
      'local-state/purge',
      'settings.get',
      'host.pairing.start',
    ])
    assert.equal(view.state, 'created', '更换手机后应给出新的扫码会话')
    assert.equal(pairing.getSnapshot().view.state, 'created')
    assert.equal(pairing.getSnapshot().renewing, false, '拿到新码后要退出「正在生成」')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})
