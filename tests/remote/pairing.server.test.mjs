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
import { createPairing } from '../../src/modules/remote/client/mobile/pairing.ts'

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

test('nginx 子路径前缀原样保存（http://10.144.70.35/IYN9bNRe/dshgo）', async () => {
  // 真机场景（2026-11-16）：「为什么要限定域名，http://10.144.70.35/IYN9bNRe/dshgo，有的是转发的 nginx 的啊」。
  // 上游请求是 `${baseUrl}${path}` 拼接，子路径本身能用，只是 normalizeServerUrl 拦了；
  // 本仓库用 pnpm patch 放开，这里锁住「路径必须原样进宿主配置」。
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'settings.server.set': () => ok({
      config: { serverUrl: 'http://10.144.70.35/IYN9bNRe/dshgo' },
      associations: { host: undefined },
      applies: 'live',
    }),
  })
  const pairing = createPairing()
  try {
    const saved = await pairing.setServer('  http://10.144.70.35/IYN9bNRe/dshgo/  ')
    assert.equal(saved, true, '带子路径的内网地址应当保存成功')
    assert.equal(calls.length, 1, '只走一次 settings.server.set')
    assert.equal(calls[0].payload.serverUrl, 'http://10.144.70.35/IYN9bNRe/dshgo', '保留路径前缀，去掉末尾斜杠')
    assert.equal(pairing.getSnapshot().error, undefined, '成功时不该留错误行')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('粘贴整条页面地址时去掉查询与片段，路径前缀保留', async () => {
  // 真机场景：把浏览器地址栏整条粘进来。查询/片段没有意义（端点都拼在路径后），路径要留。
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'settings.server.set': () => ok({
      config: { serverUrl: 'http://192.168.1.5:8080/app/remote' },
      associations: { host: undefined },
      applies: 'live',
    }),
  })
  const pairing = createPairing()
  try {
    const saved = await pairing.setServer('  http://192.168.1.5:8080/app/remote?x=1#top  ')
    assert.equal(saved, true, '规整之后应当保存成功')
    assert.equal(calls.length, 1, '只走一次 settings.server.set')
    assert.equal(calls[0].payload.serverUrl, 'http://192.168.1.5:8080/app/remote', '只去查询与片段')
    assert.equal(pairing.getSnapshot().error, undefined, '成功时不该留错误行')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('没写协议时补 https，内网地址也可以只填 host:port', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({
    'settings.server.set': () => ok({ config: { serverUrl: 'https://192.168.1.5:8080' }, applies: 'live' }),
  })
  const pairing = createPairing()
  try {
    assert.equal(await pairing.setServer('192.168.1.5:8080'), true)
    assert.equal(calls[0].payload.serverUrl, 'https://192.168.1.5:8080')
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('公网地址用 http 时在本地就拦下（回 false + 可读原因），不惊动宿主', async () => {
  const originalFetch = globalThis.fetch
  const calls = stubFetch({})
  const pairing = createPairing()
  try {
    const saved = await pairing.setServer('http://pair.example.com')
    assert.equal(saved, false, '上游只允许私有网段的 http，本地先拦下比让它抛英文 TypeError 好')
    assert.equal(calls.length, 0, '地址不合法时不该发控制请求')
    const snapshot = pairing.getSnapshot()
    assert.equal(snapshot.error.code, 'SERVER_URL_INVALID')
    assert.equal(snapshot.error.message, 'http-private-only', '面板按这个码翻成「内网可以用 http，但主机必须是私有网段」')
    assert.equal(snapshot.busy, false)
  } finally {
    pairing.dispose()
    globalThis.fetch = originalFetch
  }
})

test('地址规整：私有网段判定与 origin 归一', async () => {
  const { normalizeServerUrlInput, isPrivateNetworkHostname } = await import('../../src/modules/remote/client/mobile/pairing.ts')
  assert.deepEqual(normalizeServerUrlInput('https://Pair.Example.com:8443/x/y'), { value: 'https://pair.example.com:8443/x/y' })
  assert.deepEqual(normalizeServerUrlInput('HTTP://127.0.0.1:8080/'), { value: 'http://127.0.0.1:8080' })
  assert.deepEqual(normalizeServerUrlInput('http://10.144.70.35/IYN9bNRe/dshgo/'), { value: 'http://10.144.70.35/IYN9bNRe/dshgo' })
  assert.deepEqual(normalizeServerUrlInput('http://192.168.1.5:8080/a/b?x=1#h'), { value: 'http://192.168.1.5:8080/a/b' })
  assert.deepEqual(normalizeServerUrlInput('http://10.1.2.3:9000'), { value: 'http://10.1.2.3:9000' })
  assert.deepEqual(normalizeServerUrlInput('http://172.31.5.5'), { value: 'http://172.31.5.5' })
  assert.deepEqual(normalizeServerUrlInput('http://100.64.0.7:8080'), { value: 'http://100.64.0.7:8080' })
  assert.deepEqual(normalizeServerUrlInput('http://8.8.8.8'), { error: 'http-private-only' })
  assert.deepEqual(normalizeServerUrlInput('http://nas.local:8080'), { error: 'http-private-only' }, '内网域名走 http 上游也不收')
  assert.deepEqual(normalizeServerUrlInput('ftp://example.com'), { error: 'scheme' })
  assert.deepEqual(normalizeServerUrlInput('   '), { error: 'empty' })
  assert.deepEqual(normalizeServerUrlInput('http://user:pw@127.0.0.1:8080'), { error: 'credentials' })
  assert.equal(isPrivateNetworkHostname('localhost'), true)
  assert.equal(isPrivateNetworkHostname('fd12:3456:789a:1::1'), true)
  assert.equal(isPrivateNetworkHostname('8.8.8.8'), false)
})
