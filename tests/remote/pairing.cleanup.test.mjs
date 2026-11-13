/**
 * 解绑 / 被远端撤销之后的本地清理。
 *
 * 真机回归（2026-11-13）：用户解绑设备后重启 DSH，面板仍然按「这台机器是配对主机」
 * 讲话。原因在上游：`settings.logout` 只清凭据与身份记录，`pairing-host-only.json`
 * 与旧的 client 角色目录留在盘上。这里锁住我们的两处补刀：
 *   1. 解绑（含远端注销失败）之后一定要走一次 host 的 local-state/purge；
 *   2. 服务端说 DEVICE_REVOKED 时自动清一次，且只清一次（不能每 2.5 秒删一遍盘）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPairing } from '../../src/modules/remote/client/pairing.js'

const SERVER = 'https://pair.example.com'
const LAST_PAIRED_KEY = 'dsh-toolkit-remote/last-paired.v1'
const SNAPSHOT = JSON.stringify({ deviceId: 'phone-1', name: 'Phone', savedAt: 1 })

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

const SETTINGS = { config: { serverUrl: SERVER }, associations: { host: { deviceId: 'host-1' } } }

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    size: () => map.size,
  }
}

/** 假 fetch：控制路由按 endpoint 编排，插件自己的两条路由单独记一笔。 */
function stubFetch(handlers) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/local-state/purge')) {
      calls.push({ kind: 'purge', url: text })
      return new Response(JSON.stringify({ ok: true, removed: ['host/pairing-host-only.json'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (text.includes('/api/plugins/dsh-toolkit/remote/peers')) {
      calls.push({ kind: 'peers', url: text })
      return new Response(JSON.stringify({ ok: true, peers: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const endpoint = text.replace('/ds-harness-remote/', '')
    calls.push({ kind: 'control', endpoint, payload: init.body === undefined ? undefined : JSON.parse(init.body)?.payload })
    const handler = handlers[endpoint]
    if (handler === undefined) return new Response('not found', { status: 404 })
    return handler()
  }
  return calls
}

async function withStore({ handlers, seed }) {
  const originalFetch = globalThis.fetch
  const originalStorage = globalThis.localStorage
  const storage = memoryStorage(seed)
  globalThis.localStorage = storage
  const calls = stubFetch({
    'settings.get': () => ok(SETTINGS),
    'host.pairing.status': () => ok(undefined),
    'status': () => ok({ host: { error: undefined, pairingHostOnly: true, connectedClients: [] } }),
    ...handlers,
  })
  const pairing = createPairing()
  return {
    pairing,
    calls,
    storage,
    async dispose() {
      pairing.dispose()
      globalThis.fetch = originalFetch
      if (originalStorage === undefined) delete globalThis.localStorage
      else globalThis.localStorage = originalStorage
    },
  }
}

test('解绑：清掉本地快照，并调用 host 的 local-state/purge', async () => {
  const harness = await withStore({
    seed: { [LAST_PAIRED_KEY]: SNAPSHOT },
    handlers: { 'settings.logout': () => ok({}) },
  })
  try {
    await harness.pairing.open()
    assert.equal(harness.pairing.getSnapshot().lastPaired.deviceId, 'phone-1')

    await harness.pairing.unbind()
    const purges = harness.calls.filter((call) => call.kind === 'purge')
    assert.equal(purges.length, 1, '解绑必须清一次本机残留')
    assert.match(purges[0].url, /serverUrl=https%3A%2F%2Fpair\.example\.com/, '清理要落到具体服务器目录')
    assert.equal(harness.storage.getItem(LAST_PAIRED_KEY), null, '快照要真的从 localStorage 删掉')
    const snapshot = harness.pairing.getSnapshot()
    assert.equal(snapshot.lastPaired, undefined)
    assert.deepEqual(snapshot.peers, [])
    assert.equal(snapshot.authError, undefined, '解绑成功后不该继续挂着授权失效的红字')
  } finally {
    await harness.dispose()
  }
})

test('解绑：远端注销失败也要清本机（旧 token 失效时最常见）', async () => {
  const harness = await withStore({
    seed: { [LAST_PAIRED_KEY]: SNAPSHOT },
    handlers: { 'settings.logout': () => failure('AUTH_INVALID', 'Authorization is no longer valid.', { remoteCode: 'AUTH_INVALID' }) },
  })
  try {
    await harness.pairing.open()
    await harness.pairing.unbind()
    assert.equal(harness.calls.filter((call) => call.kind === 'purge').length, 1)
    assert.equal(harness.storage.getItem(LAST_PAIRED_KEY), null)
  } finally {
    await harness.dispose()
  }
})

test('DEVICE_REVOKED：自动清一次本机残留，重复轮询不再重复删盘', async () => {
  const harness = await withStore({
    seed: { [LAST_PAIRED_KEY]: SNAPSHOT },
    handlers: {
      'status': () => ok({ host: { error: 'DEVICE_REVOKED', pairingHostOnly: true, connectedClients: [] } }),
    },
  })
  try {
    await harness.pairing.open()
    const snapshot = harness.pairing.getSnapshot()
    assert.equal(snapshot.authError, 'DEVICE_REVOKED', '面板仍要告诉用户授权没了')
    assert.equal(snapshot.lastPaired, undefined, '被撤销的手机不该再按快照画在面板上')
    assert.equal(harness.storage.getItem(LAST_PAIRED_KEY), null)
    assert.equal(harness.calls.filter((call) => call.kind === 'purge').length, 1)

    await harness.pairing.hostStatus()
    await harness.pairing.hostStatus()
    assert.equal(harness.calls.filter((call) => call.kind === 'purge').length, 1, '清理只做一次')
  } finally {
    await harness.dispose()
  }
})

test('普通授权失效（AUTH_INVALID）不触发删盘：可能只是 token 过期，重新登录就好', async () => {
  const harness = await withStore({
    seed: { [LAST_PAIRED_KEY]: SNAPSHOT },
    handlers: {
      'status': () => ok({ host: { error: 'AUTH_INVALID', pairingHostOnly: true, connectedClients: [] } }),
    },
  })
  try {
    await harness.pairing.open()
    assert.equal(harness.pairing.getSnapshot().authError, 'AUTH_INVALID')
    assert.equal(harness.calls.filter((call) => call.kind === 'purge').length, 0)
    assert.equal(harness.pairing.getSnapshot().lastPaired.deviceId, 'phone-1')
  } finally {
    await harness.dispose()
  }
})
