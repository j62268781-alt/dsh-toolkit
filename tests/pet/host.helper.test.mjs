import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { HelperManager } from '../../src/modules/pet/host/helper.js'

const enabled = { petEnabled: true, islandEnabled: false }
const disabled = { petEnabled: false, islandEnabled: false }
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }

function fixture(t, options = {}) {
  const children = [], launches = [], resolutions = []
  const manager = new HelperManager({
    bridge: { url: 'http://127.0.0.1:1234', token: 'private-token' },
    onChange() {},
    resolve: options.resolve || (async (value) => { resolutions.push(value); return '/test/electron' }),
    launch: options.launch || ((...args) => {
      launches.push(args)
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.signals = []
      child.kill = (signal) => { child.signals.push(signal); queueMicrotask(() => child.emit('exit', 0, signal)); return true }
      children.push(child)
      return child
    }),
  })
  t.after(() => manager.dispose())
  return { manager, children, launches, resolutions }
}

test('helper clears Electron Node mode and becomes running only after a complete ready handshake', async (t) => {
  const previous = process.env.ELECTRON_RUN_AS_NODE
  process.env.ELECTRON_RUN_AS_NODE = '1'
  t.after(() => { if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = previous })
  const f = fixture(t)
  await f.manager.configure({ electronPath: '/configured/electron' }, enabled)
  assert.deepEqual(f.resolutions, [{ electronPath: '/configured/electron', download: true }])
  const [binary, args, options] = f.launches[0]
  assert.equal(binary, '/test/electron')
  assert.match(args[0], /\/runtime\/main\.cjs$/)
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1', 'parent environment must remain intact')
  assert.equal(options.env.DSH_TOOLKIT_PET_URL, 'http://127.0.0.1:1234')
  assert.equal(options.env.DSH_TOOLKIT_PET_TOKEN, 'private-token')
  assert.equal(options.env.DSH_TOOLKIT_HOST_PID, String(process.pid))
  assert.equal(f.manager.state.status, 'starting')
  const child = f.children[0]
  child.stdout.emit('data', Buffer.from('non-json\n{"type":"other"}\n{"type":"rea'))
  assert.equal(f.manager.state.status, 'starting')
  child.stdout.emit('data', Buffer.from('dy"}\n'))
  assert.equal(f.manager.state.status, 'running')
})

test('disabling both surfaces terminates the helper and cancels any restart', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture(t)
  await f.manager.configure({}, enabled)
  const child = f.children[0]
  child.stdout.emit('data', '{"type":"ready"}\n')
  await f.manager.configure({}, disabled)
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(f.manager.state.status, 'stopped')
  child.stdout.emit('data', '{"type":"ready"}\n')
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(f.manager.state.status, 'stopped', 'late readiness cannot resurrect a disabled helper')
  assert.equal(f.launches.length, 1)
})

test('disabling during resolution prevents a late download result from launching a window', async (t) => {
  let finish
  const f = fixture(t, { resolve: () => new Promise((resolve) => { finish = resolve }) })
  const configuring = f.manager.configure({}, enabled)
  await flush()
  assert.equal(typeof finish, 'function')
  await f.manager.configure({}, disabled)
  finish('/late/electron')
  await configuring
  assert.equal(f.launches.length, 0)
  assert.equal(f.manager.state.status, 'stopped')
})

test('crashes restart with bounded backoff and explicit retry resets the failure budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture(t)
  await f.manager.configure({}, enabled)
  for (const [index, delay] of [750, 1500, 3000].entries()) {
    f.children[index].emit('exit', 1)
    assert.equal(f.manager.state.status, 'error')
    t.mock.timers.tick(delay - 1)
    await flush()
    assert.equal(f.launches.length, index + 1)
    t.mock.timers.tick(1)
    await flush()
    assert.equal(f.launches.length, index + 2)
  }
  f.children[3].stderr.emit('data', 'graphics initialization failed')
  f.children[3].emit('exit', 1)
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(f.launches.length, 4, 'four consecutive failures exhaust automatic recovery')
  assert.equal(f.manager.state.error, 'graphics initialization failed')
  await f.manager.retry({})
  assert.equal(f.launches.length, 5)
  assert.equal(f.manager.failures, 0)
})

test('disabling during crash backoff prevents automatic relaunch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture(t)
  await f.manager.configure({}, { petEnabled: false, islandEnabled: true })
  f.children[0].emit('exit', 1)
  await f.manager.configure({}, disabled)
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(f.launches.length, 1)
  assert.equal(f.manager.state.status, 'stopped')
})

test('unresponsive readiness times out, and successful readiness cancels that timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture(t)
  await f.manager.configure({}, enabled)
  t.mock.timers.tick(19999)
  assert.deepEqual(f.children[0].signals, [])
  t.mock.timers.tick(1)
  assert.deepEqual(f.children[0].signals, [undefined])
  await flush()
  t.mock.timers.tick(750)
  await flush()
  f.children[1].stdout.emit('data', '{"type":"ready"}\n')
  t.mock.timers.tick(20001)
  assert.equal(f.manager.state.status, 'running')
  assert.deepEqual(f.children[1].signals, [])
})

test('a helper that ignores graceful shutdown receives a bounded force kill', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture(t)
  await f.manager.configure({}, enabled)
  const child = f.children[0]
  child.kill = (signal) => { child.signals.push(signal); return true }
  const stopping = f.manager.configure({}, disabled)
  assert.deepEqual(child.signals, ['SIGTERM'])
  t.mock.timers.tick(2999)
  assert.deepEqual(child.signals, ['SIGTERM'])
  t.mock.timers.tick(1)
  await stopping
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(f.manager.state.status, 'stopped')
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(f.launches.length, 1)
})

test('a sustained healthy run resets consecutive crash backoff', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture(t)
  await f.manager.configure({}, enabled)
  f.children[0].emit('exit', 1)
  t.mock.timers.tick(750)
  await flush()
  f.children[1].stdout.emit('data', '{"type":"ready"}\n')
  t.mock.timers.tick(180001)
  f.children[1].emit('exit', 1)
  assert.equal(f.manager.failures, 1)
  t.mock.timers.tick(750)
  await flush()
  assert.equal(f.launches.length, 3)
})

test('resolution and synchronous launch failures become visible error states', async (t) => {
  const resolving = fixture(t, { resolve: async () => { throw new Error('runtime unavailable') } })
  await resolving.manager.configure({}, enabled)
  assert.equal(resolving.manager.state.error, 'runtime unavailable')
  assert.equal(resolving.launches.length, 0)
  const launching = fixture(t, { launch: () => { throw new Error('spawn denied') } })
  await launching.manager.configure({}, enabled)
  assert.equal(launching.manager.state.status, 'error')
  assert.equal(launching.manager.state.error, 'spawn denied')
})
