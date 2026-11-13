/**
 * 配对 store：改配对服务器地址（settings.server.set）。
 *
 * 真机反馈（2026-11-13）：「保存修改配对服务器地址会卡一下」。上游 control-runtime 的
 * `settings.server.set` 先 `settings.replace()` 落盘新地址，再 `switchServer()` 把 client 与
 * host 两套运行时空重建（重新联网握手/探测能力）——慢的是后者。这里锁三件事：
 *   1. 保存成功时用**响应自带的 settingsView** 更新快照，不再补一次 settings.get（少一个 round trip）；
 *   2. 返回值告诉面板「真的切换完了」，面板据此决定是否退出编辑态；
 *   3. 失败时返回 false，错误挂在快照上，编辑态留在原地。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPairing } from '../../src/modules/remote/client/pairing.js'

const OLD = 'https://pair.example.com'
const NEW = 'https://other.example.com'

const ok = (value) => new Response(JSON.stringify({
  type: 'server-response',
  rpcId: 'rpc',
  result: { ok: true, value },
}), { status: 200, headers: { 'content-type': 'application/json' } })

const failure = (code, message) => new Response(JSON.stringify({
  type: 'server-response',
  rpcId: 'rpc',
  result: { ok: false, error: { code, message, details: { remoteCode: code, retryable: false } } },
}), { status: 200, headers: { 'content-type': 'application/json' } })

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

test('保存服务器地址：用响应里的 settingsView 更新快照，不再补一次 settings.get', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'settings.server.set': () => ok({
      config: { serverUrl: NEW },
      associations: { host: { method: 'device-pairing', account: 'dsh-device:abc' } },
      applies: 'live',
    }),
  })
  const pairing = createPairing()
  try {
    const saved = await pairing.setServer(NEW)
    assert.equal(saved, true, '切换成功要回 true，面板才退出编辑态')
    const endpointNames = calls.map((call) => call.endpoint)
    assert.deepEqual(endpointNames, ['settings.server.set'], `保存只该走一次控制往返: ${JSON.stringify(endpointNames)}`)
    assert.equal(calls[0].payload.serverUrl, NEW, '新地址原样送给 settings.server.set')
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.serverUrl, NEW, '服务器地址取自 set 的响应')
    assert.equal(snapshot.binding, true, 'associations.host 一并更新（已绑定）')
    assert.equal(snapshot.view, undefined, '换服务器后旧会话属于旧服务器，要清空')
    assert.equal(snapshot.busy, false, '结束后不能卡在忙碌态')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('保存服务器地址失败：回 false（面板留在编辑态）并挂上错误', async () => {
  const originalFetch = globalThis.fetch
  stubFetch({
    'settings.server.set': () => failure('SERVER_SWITCH_BUSY', 'A Server switch is already in progress.'),
  })
  const pairing = createPairing()
  try {
    const saved = await pairing.setServer(NEW)
    assert.equal(saved, false, '失败不能假装保存成功，否则面板会退出编辑态把人晾在那儿')
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.error.code, 'SERVER_SWITCH_BUSY', '错误码要带出来（面板翻成人话）')
    assert.equal(snapshot.busy, false)
    assert.equal(snapshot.serverUrl, undefined, '失败时不要改快照里的服务器地址')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})
