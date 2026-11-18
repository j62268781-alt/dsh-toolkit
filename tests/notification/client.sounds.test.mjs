import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDLE_CLOSE_MS, SOUND_RECIPES, SoundPlayer, recipeDuration } from '../../src/modules/notification/client/sounds.ts'
import { SystemSoundPlayer } from '../../src/modules/notification/client/system-sounds.ts'

// 与 scheduleSuspend 里的取整一致：播放结束后多少毫秒挂起。
const suspendAt = (id) => Math.max(50, Math.round((recipeDuration(SOUND_RECIPES[id]) + 0.35) * 1000))
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }

function environment(t, fetcher) {
  const original = new Map(['fetch', 'AudioContext'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const instances = []
  const sources = []
  const signals = []
  class Audio {
    constructor() {
      this.state = 'running'
      this.currentTime = 1
      this.destination = {}
      this.closes = 0
      this.suspends = 0
      instances.push(this)
    }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} } }
    createDynamicsCompressor() { return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, connect() {} } }
    createOscillator() { return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {}, stop() {} } }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() {}, stop() { source.stopped = true; source.onended?.() } }
      sources.push(source)
      return source
    }
    async decodeAudioData() { return { duration: 0.2 } }
    async resume() { this.state = 'running' }
    async suspend() { this.suspends += 1; this.state = 'suspended' }
    async close() { this.closes += 1; this.state = 'closed' }
  }
  globalThis.AudioContext = Audio
  globalThis.fetch = async (url, options) => {
    signals.push(options?.signal)
    return fetcher ? fetcher(url, options) : new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }
  t.after(() => { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
  return { instances, sources, signals }
}

test('空闲到期后关闭 AudioContext，下一次播放再懒重建', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = environment(t)
  const player = new SoundPlayer(() => 1)
  t.after(() => player.dispose())
  assert.equal(player.play('pop'), true)
  assert.equal(env.instances.length, 1)
  // 播放结束 → 挂起，挂起之后才开始计空闲窗口。
  t.mock.timers.tick(suspendAt('pop'))
  assert.equal(env.instances[0].state, 'suspended')
  assert.equal(env.instances[0].suspends, 1)
  t.mock.timers.tick(IDLE_CLOSE_MS - 1)
  assert.equal(env.instances[0].closes, 0, '空闲窗口内上下文仍然复用')
  t.mock.timers.tick(1)
  assert.equal(env.instances[0].closes, 1)
  assert.equal(env.instances[0].state, 'closed')
  assert.equal(player.context, null, '关闭后不再持有上下文')
  assert.equal(player.play('pop'), true)
  assert.equal(env.instances.length, 2, '下一次播放重新 new 一个 AudioContext')
})

test('空闲窗口内再次播放会取消关闭，并沿用同一个上下文', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = environment(t)
  const player = new SoundPlayer(() => 1)
  t.after(() => player.dispose())
  assert.equal(player.play('pop'), true)
  t.mock.timers.tick(suspendAt('pop'))
  t.mock.timers.tick(IDLE_CLOSE_MS - 10000)
  assert.equal(player.play('chime'), true)
  assert.equal(player.context, env.instances[0], '10 分钟内播放不重建上下文')
  // 新播放重排了一个完整的空闲窗口；推进过原来的截止点也不该 close。
  t.mock.timers.tick(IDLE_CLOSE_MS)
  assert.equal(env.instances[0].closes, 0)
  assert.equal(env.instances.length, 1)
})

test('dispose 清掉空闲定时器并只 close 一次', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = environment(t)
  const player = new SoundPlayer(() => 1)
  assert.equal(player.play('pop'), true)
  t.mock.timers.tick(suspendAt('pop'))
  player.dispose()
  assert.equal(env.instances[0].closes, 1)
  t.mock.timers.tick(IDLE_CLOSE_MS * 2)
  assert.equal(env.instances[0].closes, 1, '被取消的空闲定时器不得再次 close')
  player.dispose()
  assert.equal(env.instances[0].closes, 1, '重复 dispose 不会二次 close')
  assert.equal(player.context, null)
})

test('空闲到期时上下文已被关闭也不会抛错', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = environment(t)
  const player = new SoundPlayer(() => 1)
  t.after(() => player.dispose())
  assert.equal(player.play('pop'), true)
  t.mock.timers.tick(suspendAt('pop'))
  const context = env.instances[0]
  // 模拟别处已经关过：state 为 closed，且 close 不能再被调用。
  context.state = 'closed'
  context.closes = 1
  t.mock.timers.tick(IDLE_CLOSE_MS)
  assert.equal(context.closes, 1)
  assert.equal(player.context, null, '仍然要丢掉这个已经失效的引用')
})

test('系统音效播放器空闲后清空解码缓冲并释放节点', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const env = environment(t)
  const player = new SystemSoundPlayer(() => 1)
  t.after(() => player.dispose())
  assert.equal(await player.preview('abc'), true)
  assert.equal(player.buffers.size, 1)
  assert.equal(player.sources.size, 1)
  env.sources.at(-1).onended()
  t.mock.timers.tick(150)
  assert.equal(env.instances[0].state, 'suspended')
  t.mock.timers.tick(IDLE_CLOSE_MS)
  assert.equal(player.buffers.size, 0, '解码后的 AudioBuffer 不再常驻')
  assert.equal(player.sources.size, 0)
  assert.equal(player.requests.size, 0)
  assert.equal(env.instances[0].closes, 1)
  assert.equal(player.context, null)
})

test('空闲关闭时在途的 fetch/decode 安全失败，也不会把结果写回缓存', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  // 只有慢请求挂起：先播的那一条要能正常完成，才能进入空闲倒计时。
  const env = environment(t, (url) => url.includes('id=slow')
    ? new Promise((resolve) => { release = () => resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 })) })
    : new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  const player = new SystemSoundPlayer(() => 1)
  t.after(() => player.dispose())
  // 先播一次并结束，让空闲关闭进入倒计时。
  assert.equal(await player.preview('warm'), true)
  env.sources.at(-1).onended()
  t.mock.timers.tick(150)
  const pending = player.preview('slow')
  await flush()
  assert.equal(player.requests.size, 1, '慢请求已经在途')
  t.mock.timers.tick(IDLE_CLOSE_MS)
  assert.equal(env.instances[0].closes, 1)
  assert.equal(player.requests.size, 0, '在途请求被 abort 并清空')
  assert.equal(env.signals.at(-1).aborted, true)
  release()
  assert.equal(await pending, false, '迟到的解码结果被丢弃')
  assert.equal(player.buffers.size, 0, '不会把旧上下文的解码结果塞回缓存')
})