import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import { createHelperBridge } from '../../src/modules/pet/host/bridge.ts'

async function fixture(t, action = async (value) => ({ accepted: value.action })) {
  let state = { settings: { petEnabled: true }, sessions: [] }
  const bridge = await createHelperBridge(() => state, action)
  t.after(() => bridge.dispose())
  const headers = { authorization: `Bearer ${bridge.token}`, connection: 'close' }
  return { bridge, headers, setState(value) { state = value }, async json(path, options = {}) {
    const response = await fetch(bridge.url + path, { ...options, headers: { ...headers, ...options.headers } })
    return { status: response.status, body: await response.json() }
  } }
}

function stream(url, headers) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, agent: false }, (res) => {
      res.once('data', (chunk) => resolve({ req, res, first: chunk.toString() }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('helper bridge binds loopback and requires the exact bearer capability', async (t) => {
  const f = await fixture(t)
  assert.equal(new URL(f.bridge.url).hostname, '127.0.0.1')
  assert.match(f.bridge.token, /^[a-f0-9]{64}$/)
  for (const authorization of ['', 'Bearer wrong', `bearer ${f.bridge.token}`, `Bearer ${'0'.repeat(64)}`]) {
    const result = await f.json('/state', { headers: { authorization } })
    assert.deepEqual(result, { status: 403, body: { error: 'Forbidden' } })
  }
  assert.deepEqual(await f.json('/state'), { status: 200, body: { settings: { petEnabled: true }, sessions: [], streams: 0, requests: 0 } })
})

test('bridge rejects browser origins even with a valid capability, before dispatching actions', async (t) => {
  const calls = []
  const f = await fixture(t, async (value) => { calls.push(value); return { ok: true } })
  for (const origin of ['http://127.0.0.1', 'https://attacker.example', 'null']) {
    const result = await f.json('/action', { method: 'POST', headers: { origin }, body: JSON.stringify({ action: 'prepare' }) })
    assert.equal(result.status, 403)
  }
  assert.deepEqual(calls, [])
  assert.equal((await f.json('/action', { method: 'POST', body: JSON.stringify({ action: 'prepare' }) })).status, 200)
  assert.deepEqual(calls, [{ action: 'prepare' }])
})

test('bridge validates actions and never dispatches malformed session input', async (t) => {
  const calls = []
  const f = await fixture(t, async (value) => { calls.push(value); return { ok: true } })
  for (const body of ['{', 'null', '[]', JSON.stringify({ action: 'unknown' }), JSON.stringify({ action: 'seen' }), JSON.stringify({ action: 'cancel' }), JSON.stringify({ action: 'open', sessionId: 'x'.repeat(257) }), JSON.stringify({ action: 'prompt', sessionId: 's', text: '  ' }), JSON.stringify({ action: 'prompt', sessionId: 's', text: 'x'.repeat(8001) }), JSON.stringify({ action: 'position', x: 1, y: null })]) {
    assert.equal((await f.json('/action', { method: 'POST', body })).status, 400, body.slice(0, 100))
  }
  assert.deepEqual(calls, [])
  for (const value of [{ action: 'prompt', sessionId: 's', text: 'reply' }, { action: 'seen', sessionId: 's' }, { action: 'position', x: -100, y: 300 }]) {
    assert.deepEqual(await f.json('/action', { method: 'POST', body: JSON.stringify(value) }), { status: 200, body: { ok: true } })
  }
  assert.equal(calls.length, 3)
  assert.equal((await f.json('/missing')).status, 404)
  assert.equal((await f.json('/action')).status, 404)
})

test('event streams deliver initial and published state, enforce a bound, and close on disposal', async (t) => {
  const f = await fixture(t)
  const streams = []
  t.after(() => { for (const item of streams) item.req.destroy() })
  for (let i = 0; i < 4; i += 1) streams.push(await stream(f.bridge.url + '/events', f.headers))
  assert.match(streams[0].first, /data: .*"petEnabled":true/)
  assert.equal((await f.json('/events')).status, 429)
  const update = new Promise((resolve) => streams[0].res.once('data', (chunk) => resolve(chunk.toString())))
  f.setState({ sessions: [{ sessionId: 'updated' }] })
  f.bridge.publish()
  assert.match(await update, /"sessionId":"updated"/)
  const ended = Promise.all(streams.map(({ res }) => new Promise((resolve) => res.once('end', resolve))))
  for (const { res } of streams) res.resume()
  await f.bridge.dispose()
  await ended
})
