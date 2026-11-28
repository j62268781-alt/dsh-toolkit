import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { HelperManager } from '../../src/modules/pet/host/helper.ts'

const enabled = { petEnabled: true, islandEnabled: false }
const disabled = { petEnabled: false, islandEnabled: false }
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }

test('runtime download progress is published while preparing and cleared afterwards', async (t) => {
  const states = []
  const manager = new HelperManager({
    bridge: { url: 'http://127.0.0.1:1234', token: 'private-token' },
    onChange() { states.push({ ...manager.state }) },
    resolve: async (options) => {
      options.onProgress?.({ phase: 'download', percent: 42, received: 42, total: 100 })
      await flush()
      return '/test/electron'
    },
  })
  t.after(() => manager.dispose())
  await manager.prepare(disabled)
  const during = states.find((state) => state.progress?.percent === 42)
  assert.equal(during?.status, 'starting', 'progress must arrive while the runtime is still preparing')
  assert.equal(during?.progress?.phase, 'download')
  assert.equal(during?.progress?.received, 42)
  assert.equal(manager.state.progress, undefined, 'a prepared runtime must not keep a stale progress bar')
  assert.equal(manager.state.available, true)
})

test('an installed runtime is probed without downloading', async (t) => {
  const f = fixture(t)
  await f.manager.probe({ electronPath: '' })
  assert.equal(f.resolutions[0].download, false, 'a probe must never start the download pipeline')
  assert.equal(f.manager.state.available, true)
  assert.equal(f.manager.state.status, 'stopped')
  assert.equal(f.manager.state.error, undefined)
})

test('a missing runtime stays unavailable after probing', async (t) => {
  const f = fixture(t, { resolve: async () => undefined })
  await f.manager.probe({})
  assert.equal(f.manager.state.available, false)
  assert.equal(f.manager.state.status, 'stopped')
  assert.equal(f.manager.state.error, undefined, 'probing reports availability, not a startup failure')
})

test('a broken explicit runtime path is reported unavailable instead of an error', async (t) => {
  const f = fixture(t, { resolve: async () => { throw new Error('Electron executable must be an existing absolute executable path') } })
  await f.manager.probe({ electronPath: '/missing/electron' })
  assert.equal(f.manager.state.available, false)
  assert.equal(f.manager.state.status, 'stopped')
  assert.equal(f.manager.state.error, undefined)
})

test('probing never races an in-flight preparation', async (t) => {
  const calls = []
  let finish
  const f = fixture(t, { resolve: (value) => { calls.push(value); return new Promise((resolve) => { finish = resolve }) } })
  const preparing = f.manager.prepare({})
  await flush()
  await f.manager.probe({})
  assert.equal(calls.length, 1, 'preparation already owns the resolution')
  finish('/test/electron')
  await preparing
  assert.equal(f.manager.state.available, true)
})

test('a failed runtime download keeps the error and drops the progress bar', async (t) => {
  const manager = new HelperManager({
    bridge: { url: 'http://127.0.0.1:1234', token: 'private-token' },
    onChange() {},
    resolve: async (options) => {
      options.onProgress?.({ phase: 'download', percent: 10, received: 10, total: 100 })
      throw new Error('network down')
    },
  })
  t.after(() => manager.dispose())
  await manager.prepare(disabled)
  assert.equal(manager.state.status, 'error')
  assert.equal(manager.state.error, 'network down')
  assert.equal(manager.state.progress, undefined)
})

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
  assert.deepEqual(f.resolutions.map(({ onProgress, ...rest }) => rest), [{ electronPath: '/configured/electron', download: true }])
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

test('disabling both surfaces keeps an installed runtime marked available', async (t) => {
  const f = fixture(t)
  await f.manager.configure({}, disabled)
  assert.equal(f.manager.state.available, true, 'availability must not depend on the surfaces being enabled')
  assert.equal(f.manager.state.status, 'stopped')
  assert.equal(f.launches.length, 0)
  assert.equal(f.resolutions.at(-1).download, false)
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

const activeOnlyIsland = { ...disabled, islandEnabled: true, islandIdle: false }

test('an activity-only island skips the idle boot, releases its helper, and wakes again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t)
  await f.manager.configure({}, activeOnlyIsland)
  assert.equal(f.manager.state.available, true)
  assert.deepEqual(f.resolutions.map(({ download }) => download), [false])
  assert.equal(f.launches.length, 0)

  await f.manager.setActivity(activeOnlyIsland, true)
  const [child] = f.children
  child.stdout.emit('data', '{"type":"ready"}\n')
  await f.manager.setActivity(activeOnlyIsland, false)
  t.mock.timers.tick(29_999)
  assert.deepEqual(child.signals, [])
  await f.manager.setActivity(activeOnlyIsland, true)
  t.mock.timers.tick(30_000)
  assert.deepEqual(child.signals, [], 'returning activity cancels the shutdown')

  await f.manager.setActivity(activeOnlyIsland, false)
  t.mock.timers.tick(20_000)
  await f.manager.setActivity(activeOnlyIsland, false)
  t.mock.timers.tick(10_000)
  await flush()
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.deepEqual(f.manager.state, { status: 'stopped', available: true, error: undefined, progress: undefined })
  await f.manager.setActivity(activeOnlyIsland, true)
  assert.equal(f.launches.length, 2)
})

test('new activity waits for a sleeping helper to finish exiting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t)
  await f.manager.configure({}, activeOnlyIsland, true)
  const [child] = f.children
  child.stdout.emit('data', '{"type":"ready"}\n')
  child.kill = (signal) => { child.signals.push(signal); return true }
  await f.manager.setActivity(activeOnlyIsland, false)
  t.mock.timers.tick(30_000)
  const waking = f.manager.setActivity(activeOnlyIsland, true)
  await flush()
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(f.launches.length, 1)
  child.emit('exit', 0)
  await waking
  assert.equal(f.launches.length, 2)
  assert.equal(f.manager.state.status, 'starting')
})

test('persistent surfaces keep the helper when the session list is empty', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture(t)
  for (const settings of [{ ...activeOnlyIsland, petEnabled: true }, { ...activeOnlyIsland, islandIdle: true }]) {
    await f.manager.configure({}, settings)
    f.children[0].stdout.emit('data', '{"type":"ready"}\n')
    await f.manager.setActivity(settings, false)
    t.mock.timers.tick(60_000)
    assert.equal(f.launches.length, 1)
    assert.deepEqual(f.children[0].signals, [])
  }
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

test('volatile configuration references reach Electron resolution as plain strings', async (t) => {
  const f = fixture(t)
  const volatile = (value) => ({ get: () => value, [Symbol.for('cosmokit.volatile.write')]: () => {} })
  await f.manager.configure({ electronPath: volatile('/from/reference') }, enabled)
  assert.deepEqual(f.resolutions.map(({ onProgress, ...rest }) => rest), [{ electronPath: '/from/reference', download: true }])
  assert.equal(typeof f.resolutions[0].onProgress, 'function', 'the download reports progress into the published state')
  assert.equal(f.manager.state.status, 'starting')
  assert.equal(f.manager.state.error, undefined)
})
