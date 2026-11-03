import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerRuntimeRoute, RUNTIME_PATH } from '../../src/modules/skills-mcp/host/mcp/runtime.js'
import { createServerObserver } from '../../src/modules/skills-mcp/host/mcp/observe.js'

function harness(read, rejection) {
  let route
  let disposed = false
  const cleanups = []
  registerRuntimeRoute({
    effect: (fn) => cleanups.push(fn()),
    webServer: { register: (value) => { route = value; return () => { disposed = true } } },
    connection: { requestRejection: () => rejection },
    logger: { warn() {} },
  }, read)
  return {
    route,
    dispose: () => { cleanups.forEach((fn) => fn()); return disposed },
    request: async (method = 'GET') => {
      const headers = {}
      let body = ''
      const res = { statusCode: 0, setHeader: (k, v) => { headers[k] = v }, end: (value = '') => { body = value } }
      await route.handler({ method }, res)
      return { status: res.statusCode, headers, body }
    },
  }
}

test('runtime route checks authorization before reading inventory', async () => {
  for (const rejection of [401, 403]) {
    const h = harness(() => { throw new Error('must not read') }, rejection)
    assert.equal((await h.request()).status, rejection)
  }
})

test('runtime route reads fresh data, disables caching and unregisters on disposal', async () => {
  let n = 0
  const h = harness(() => ({ tools: [++n] }))
  assert.equal(h.route.path, RUNTIME_PATH)
  assert.equal((await h.request('POST')).status, 405)
  assert.equal(n, 0)
  const first = await h.request()
  assert.equal(first.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(first.body), { tools: [1] })
  assert.deepEqual(JSON.parse((await h.request()).body), { tools: [2] })
  assert.equal(h.dispose(), true)
})

test('observer invalidation prevents an obsolete probe from repopulating cache', async () => {
  let rejectFirst
  let calls = 0
  const ctx = {
    logger: { warn() {}, info() {} },
    get: (name) => name === 'mcpResources' ? {
      request: () => {
        calls += 1
        if (calls === 1) return new Promise((_resolve, reject) => { rejectFirst = reject })
        return Promise.resolve()
      },
    } : null,
  }
  const observer = createServerObserver(ctx, { agents: () => [], servers: () => [] })
  const rows = [{ serverName: 'probe', scope: 'global', enabled: true, transport: 'streamable-http', target: 'https://x/mcp' }]
  const compute = () => observer.computeServerStatus({ rows, entries: rows, toolCounts: new Map() })

  compute()
  observer.invalidateServerCaches('probe')
  compute()
  await new Promise((resolve) => setImmediate(resolve))
  rejectFirst(new Error('stale disconnection'))
  await new Promise((resolve) => setImmediate(resolve))
  const result = observer.readProbeState().results.find((item) => item.serverName === 'probe')
  assert.equal(result?.state, 'connected', 'the obsolete failure must not replace the current successful result')
  assert.equal(calls, 2)
})

test('runtime read failure returns an explicit unavailable response', async () => {
  const h = harness(() => { throw new Error('private internals') })
  const result = await h.request()
  assert.equal(result.status, 503)
  assert.deepEqual(JSON.parse(result.body), { error: 'runtime-unavailable' })
})
