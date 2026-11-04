import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SystemSoundPlayer, loadSystemSounds } from '../../src/modules/notification/client/system-sounds.js'

function environment(t, fetcher) {
  const original = new Map(['fetch', 'AudioContext'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const requests = [], gains = [], sources = []
  class Audio {
    state = 'running'
    destination = {}
    async resume() { this.state = 'running' }
    async suspend() { this.state = 'suspended' }
    async close() { this.state = 'closed' }
    async decodeAudioData() { return { duration: 0.2 } }
    createGain() { const gain = { gain: { value: 0 }, connect() {}, disconnect() {} }; gains.push(gain); return gain }
    createBufferSource() { const source = { connect() {}, disconnect() {}, start() { source.started = true }, stop() { source.stopped = true; source.onended?.() } }; sources.push(source); return source }
  }
  globalThis.AudioContext = Audio
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return fetcher ? fetcher(url, options) : new Response(new Uint8Array([1, 2, 3]), { status: 200 }) }
  t.after(() => { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
  return { requests, gains, sources }
}

test('system audio uses the selected authenticated file and exact current volume', async (t) => {
  const env = environment(t)
  const player = new SystemSoundPlayer(() => 1)
  t.after(() => player.dispose())
  assert.equal(await player.preview('system'), true)
  assert.equal(env.requests[0].url, '/api/plugins/dsh-toolkit/notification/sound?id=system')
  assert.equal(env.requests[0].options.credentials, 'same-origin')
  assert.equal(env.gains[0].gain.value, 1)
  assert.equal(env.sources[0].started, true)
  await player.preview('system', 0.35)
  assert.equal(env.gains[1].gain.value, 0.35)
  assert.equal(env.requests.length, 2, 'default must follow changed OS preferences instead of a cached buffer')
  assert.equal(await player.preview('system', 0), false)
  assert.equal(env.requests.length, 2)
})

test('catalogue IDs are cached in a bounded player and invalid selections never fetch', async (t) => {
  const env = environment(t)
  const player = new SystemSoundPlayer(() => 1)
  t.after(() => player.dispose())
  const id = 'a'.repeat(32)
  assert.equal(await player.preview(id), true)
  assert.equal(await player.preview(id), true)
  assert.equal(env.requests.length, 1)
  assert.equal(player.play('../../secret', 1), false)
  assert.equal(await player.preview('file:///private/sound', 1), false)
  player.dispose()
  assert.equal(env.sources.every((source) => source.stopped), true)
  assert.equal(player.play('system'), false)
})

test('playback failures remain isolated and oversized responses are not decoded', async (t) => {
  const env = environment(t, () => new Response('', { status: 503 }))
  const player = new SystemSoundPlayer(() => 1)
  t.after(() => player.dispose())
  assert.equal(await player.preview('system'), false)
  assert.equal(player.play('system'), true, 'dispatch accepts async playback without throwing')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(env.sources.length, 0)
  globalThis.fetch = async () => new Response(new Uint8Array([1]), { headers: { 'content-length': String(10 * 1024 * 1024) } })
  assert.equal(await player.preview('system'), false)
  assert.equal(env.sources.length, 0)
})

test('catalogue fetch is same-origin and only admits usable opaque sound choices', async (t) => {
  const env = environment(t, () => new Response(JSON.stringify({ platform: 'darwin', sounds: [{ id: 'system', label: 'Default' }, { id: 'abc', label: 'Glass' }, { id: '../secret', label: 'Invalid' }, { id: 'unknown' }] })))
  const catalog = await loadSystemSounds()
  assert.equal(env.requests[0].options.credentials, 'same-origin')
  assert.deepEqual(catalog.sounds.map((entry) => entry.id), ['system', 'abc'])
})
