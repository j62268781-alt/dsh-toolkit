import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { catalogAuthorizationIdentity, createCatalogReader } from '../../src/modules/skills-mcp/host/mcp/catalog.js'

const http = { transport: 'streamable-http', serverName: 'alpha', url: 'https://example.test/mcp', headers: {} }
const anonymous = { auth: null }
const raw = (name) => ({
  name, title: 'Title', description: 'Description', inputSchema: { type: 'object' },
  outputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, _meta: { extension: { test: 1 } },
})

function harness({ pages = [], tools = true, closeEvent = true, changed = false, onRequest } = {}) {
  const requests = []
  const transports = []
  let closeCount = 0
  class Transport {
    constructor(...args) { transports.push(args) }
    async start() {}
    async close() { closeCount++; if (closeEvent) this.onclose?.() }
  }
  class Client {
    async connect(transport) { this.transport = transport; await transport.start() }
    getServerCapabilities() { return tools ? { tools: {} } : {} }
    setNotificationHandler(method, handler) {
      assert.equal(method, 'notifications/tools/list_changed')
      this.changed = handler
    }
    async request(request, options) {
      requests.push(request)
      if (changed) this.changed()
      if (onRequest) return onRequest(options)
      return pages[requests.length - 1]
    }
    async close() { await this.transport.close() }
  }
  const reader = createCatalogReader({ hostUrl: 'unused', normalizeConfig: x => x, loadRuntime: () => ({
    sdk: { Client, StreamableHTTPClientTransport: Transport },
    stdio: () => ({ StdioClientTransport: Transport, scrubbedParentEnv: () => ({ PATH: '/safe', HOME: '/home' }) }),
  }) })
  return { read: (config = http, options = anonymous) => reader.read(null, config, options), requests, transports, closes: () => closeCount }
}

test('lists all pages without executing tools and retains raw metadata and server cache hints', async () => {
  const first = raw('first')
  const second = { ...raw('second'), arbitraryExtension: ['preserved'] }
  const h = harness({ pages: [
    { tools: [first], nextCursor: 'page-two', ttlMs: 200, cacheScope: 'public' },
    { tools: [second], ttlMs: 100, cacheScope: 'private' },
  ] })
  const before = Date.now()
  const { capturedAt, ...catalog } = await h.read()
  assert.ok(capturedAt >= before && capturedAt <= Date.now())
  assert.deepEqual(catalog, { tools: [first, second], ttlMs: 100, cacheScope: 'private', authorizationIdentity: 'anonymous' })
  assert.deepEqual(h.requests, [{ method: 'tools/list' }, { method: 'tools/list', params: { cursor: 'page-two' } }])
  assert.equal(h.closes(), 1)
})

test('never fabricates cache metadata for legacy or tool-less servers, and retains a zero TTL', async () => {
  const { capturedAt: _capturedAt, ...empty } = await harness({ tools: false }).read()
  assert.deepEqual(empty, { tools: [], ttlMs: null, cacheScope: null, authorizationIdentity: 'anonymous' })
  const legacy = await harness({ pages: [{ tools: [raw('one')] }] }).read()
  assert.equal(legacy.ttlMs, null)
  assert.equal(legacy.cacheScope, null)
  assert.equal((await harness({ pages: [{ tools: [], ttlMs: 0, cacheScope: 'public' }] }).read()).ttlMs, 0)
})

test('rejects a repeating cursor, duplicate tool names, and a concurrent tools/list_changed', async () => {
  for (const h of [
    harness({ pages: [{ tools: [], nextCursor: 'again' }, { tools: [], nextCursor: 'again' }] }),
    harness({ pages: [{ tools: [raw('same'), raw('same')] }] }),
    harness({ pages: [{ tools: [raw('maybe-stale')] }], changed: true }),
  ]) {
    await assert.rejects(h.read(), /MCP catalog/)
    assert.equal(h.closes(), 1)
  }
})

test('uses exact configured HTTP headers or scrubbed stdio without treating either as persist-safe', async () => {
  const h = harness({ tools: false })
  const headers = { Authorization: 'Bearer fixture' }
  assert.equal((await h.read({ ...http, headers })).authorizationIdentity, null)
  assert.deepEqual(h.transports[0][1], { requestInit: { headers } })
  const stdio = { transport: 'stdio', command: 'fixture', args: ['--test'], cwd: '/mount', env: { PATH: '/mount/bin' } }
  assert.equal((await h.read(stdio, {})).authorizationIdentity, null)
  assert.deepEqual(h.transports[1][0], { command: 'fixture', args: ['--test'], cwd: '/mount', env: { PATH: '/mount/bin', HOME: '/home' } })
})

test('fails closed before opening a transport when templates or OAuth cannot be verified', async () => {
  const h = harness()
  await assert.rejects(h.read(http, {}), /cannot be verified/)
  await assert.rejects(h.read({ ...http, expandTemplates: true }), /cannot be verified/)
  for (const url of ['https://user@example.test/mcp', 'https://example.test/mcp?token=a', 'https://example.test/#token']) {
    assert.equal(catalogAuthorizationIdentity({ ...http, url }, anonymous), null)
  }
  assert.deepEqual(h.transports, [])
})

test('snapshots an OAuth token once without exposing it or supplying interactive authorization hooks', async () => {
  const h = harness({ tools: false })
  let reads = 0
  const auth = { token: async () => { reads++; return 'fixture-bearer' } }
  const catalog = await h.read(http, { auth })
  assert.equal(catalog.authorizationIdentity, null)
  assert.equal(reads, 1)
  assert.ok(!JSON.stringify(catalog).includes('fixture-bearer'))
  const authProvider = h.transports[0][1].authProvider
  assert.deepEqual(Object.keys(authProvider), ['token'])
  assert.equal(await authProvider.token(), 'fixture-bearer')
  assert.equal(await authProvider.token(), 'fixture-bearer')
  assert.equal(reads, 1)
  assert.equal((await h.read(http, { auth: { token: async () => undefined } })).authorizationIdentity, 'anonymous')
})

test('aborts an in-flight list, closes exactly once and does not expose SDK error content', async () => {
  const abort = new AbortController()
  const h = harness({ onRequest: async ({ signal }) => {
    abort.abort('private cancellation reason')
    signal.throwIfAborted()
  } })
  await assert.rejects(h.read(http, { ...anonymous, signal: abort.signal }), { message: 'MCP catalog read aborted or timed out' })
  assert.equal(h.closes(), 1)
})

test('rejects instead of returning a catalog if transport closure is not confirmed', async () => {
  const h = harness({ tools: false, closeEvent: false })
  await Promise.all([
    assert.rejects(h.read({ ...http, closeTimeoutMs: 5 }), /closure was not confirmed/),
    delay(20), // AbortSignal.timeout() intentionally does not keep the process alive.
  ])
  assert.equal(h.closes(), 1)
})
