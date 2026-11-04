import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { apply, inject, registerNotificationSoundRoutes, SOUND_PATH, SOUNDS_PATH } from '../../src/modules/notification/host/index.js'
import { createSoundService, MAX_SOUND_BYTES } from '../../src/modules/notification/host/sounds.js'

function wav(value = 0) {
  const bytes = Buffer.alloc(46)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(2, 40); bytes.writeInt16LE(value, 44)
  return bytes
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sound-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const system = path.join(root, 'system'), user = path.join(root, 'user'), temporary = path.join(root, 'temporary')
  await Promise.all([system, user, temporary].map((directory) => mkdir(directory)))
  return { root, system, user, temporary }
}

function boundedOptions(options) {
  assert.equal(options.timeout, 3000)
  assert.equal(options.maxBuffer, 65536)
  assert.equal(options.windowsHide, true)
  assert.equal(options.shell, undefined)
}

test('mac catalog includes both sound directories, hides paths, and follows current alert preference', async (t) => {
  const { root, system, user, temporary } = await fixture(t)
  const funk = path.join(system, 'Funk.aiff'), chosen = path.join(user, 'Personal.caf')
  await Promise.all([writeFile(funk, 'AIFF'), writeFile(chosen, 'CAF'), writeFile(path.join(system, 'ignored.txt'), 'text')])
  let preference = chosen
  const calls = []
  const service = createSoundService({ platform: 'darwin', directories: [system, user], tempDirectory: temporary,
    async execFile(command, args, options) {
      boundedOptions(options); calls.push([command, args])
      if (command === '/usr/bin/defaults') {
        assert.deepEqual(args, ['read', '-g', 'com.apple.sound.beep.sound'])
        return { stdout: `${preference}\n` }
      }
      assert.equal(command, '/usr/bin/afconvert')
      assert.deepEqual(args.slice(0, 4), ['-f', 'WAVE', '-d', 'LEI16'])
      assert.ok(args[4].startsWith(temporary + path.sep))
      assert.notEqual(args[4], chosen, 'converter receives a private copy')
      await writeFile(args[5], wav(await readFile(args[4], 'utf8') === 'CAF' ? 1 : 2))
      return { stdout: '' }
    },
  })
  const catalog = await service.getCatalog()
  assert.deepEqual(catalog.sounds.map(({ label }) => label), ['System default', 'Funk', 'Personal'])
  assert.equal(catalog.platform, 'darwin')
  assert.equal(JSON.stringify(catalog).includes(root), false)
  assert.ok(catalog.sounds.slice(1).every(({ id }) => /^[a-f0-9]{32}$/.test(id)))
  assert.deepEqual(await service.getCatalog(), catalog)
  assert.deepEqual(await service.readSound('system'), { bytes: wav(1), contentType: 'audio/wav' })
  preference = '/outside/not-a-catalog-sound.aiff'
  assert.deepEqual((await service.readSound('system')).bytes, wav(2), 'invalid preference uses real Funk fallback')
  assert.equal(calls.filter(([command]) => command === '/usr/bin/defaults').length, 2)
  assert.deepEqual(await readdir(temporary), [])
})

test('Windows reads current notification registry event, older fallback, and standard media fallback', async (t) => {
  const { root } = await fixture(t)
  const system = path.join(root, 'Media')
  await mkdir(system)
  const chosen = path.join(system, 'Chosen.wav'), fallback = path.join(system, 'WinNotifySystemGeneric.wav')
  await Promise.all([writeFile(chosen, wav(3)), writeFile(fallback, wav(4)), writeFile(path.join(system, 'Track.mp3'), Buffer.from('ID3sound'))])
  const queries = []
  let mode = 'current'
  const service = createSoundService({ platform: 'win32', env: { WINDIR: root, SOUND_ROOT: system },
    async execFile(command, args, options) {
      boundedOptions(options); assert.equal(command, 'reg.exe'); assert.equal(args[0], 'query'); assert.equal(args[2], '/ve')
      queries.push(args[1])
      if (mode === 'absent' || (mode === 'legacy' && args[1].includes('Notification.Default'))) throw new Error('missing registry value')
      return { stdout: '\n    (Default)    REG_EXPAND_SZ    %SOUND_ROOT%/Chosen.wav\n' }
    },
  })
  assert.deepEqual((await service.readSound('system')).bytes, wav(3))
  assert.equal(queries[0], 'HKCU\\AppEvents\\Schemes\\Apps\\.Default\\Notification.Default\\.Current')
  mode = 'legacy'
  assert.deepEqual((await service.readSound('system')).bytes, wav(3))
  assert.equal(queries.at(-1), 'HKCU\\AppEvents\\Schemes\\Apps\\.Default\\.Default\\.Current')
  mode = 'absent'
  assert.deepEqual((await service.readSound('system')).bytes, wav(4))
  const track = (await service.getCatalog()).sounds.find(({ label }) => label === 'Track')
  assert.equal((await service.readSound(track.id)).contentType, 'audio/mpeg')
})

test('catalog excludes symlink escapes, arbitrary paths and oversized files; IDs expire with removed choices', async (t) => {
  const { root, system } = await fixture(t)
  const outside = path.join(root, 'private.wav'), safe = path.join(system, 'Safe.wav')
  await Promise.all([writeFile(outside, wav(5)), writeFile(safe, wav(6)), writeFile(path.join(system, 'Huge.wav'), Buffer.alloc(MAX_SOUND_BYTES + 1))])
  await symlink(outside, path.join(system, 'Escape.wav'))
  const service = createSoundService({ platform: 'win32', directories: [system] })
  const catalog = await service.getCatalog()
  assert.deepEqual(catalog.sounds.map(({ label }) => label), ['System default', 'Safe'])
  for (const id of ['../private.wav', outside, '%2e%2e%2fprivate.wav', 'f'.repeat(32), null]) {
    await assert.rejects(service.readSound(id), { statusCode: 404 })
  }
  assert.deepEqual((await service.readSound(catalog.sounds[1].id)).bytes, wav(6))
  await rm(safe)
  await assert.rejects(service.readSound(catalog.sounds[1].id), { statusCode: 404 })
})

test('conversion removes temporary files after command failure and oversized or invalid output', async (t) => {
  const { system, temporary } = await fixture(t)
  await writeFile(path.join(system, 'Funk.aiff'), 'AIFF')
  for (const mode of ['failure', 'oversized', 'invalid']) {
    const service = createSoundService({ platform: 'darwin', directories: [system], tempDirectory: temporary,
      async execFile(command, args) {
        if (command === '/usr/bin/defaults') throw new Error('no preference')
        if (mode === 'failure') throw new Error('conversion failed')
        await writeFile(args.at(-1), mode === 'oversized' ? Buffer.alloc(MAX_SOUND_BYTES + 1) : 'not WAV')
        return { stdout: '' }
      },
    })
    await assert.rejects(service.readSound('system'), { statusCode: 503 })
    assert.deepEqual(await readdir(temporary), [], mode)
  }
})

test('unsupported platforms return no fake sounds, and missing system defaults report unavailability', async (t) => {
  const { system } = await fixture(t)
  const unsupported = createSoundService({ platform: 'linux', directories: [system], execFile() { throw new Error('must not run') } })
  assert.deepEqual(await unsupported.getCatalog(), { platform: 'linux', sounds: [] })
  await assert.rejects(unsupported.readSound('system'), { statusCode: 404 })
  const empty = createSoundService({ platform: 'win32', directories: [system], async execFile() { throw new Error('absent') } })
  await assert.rejects(empty.readSound('system'), { statusCode: 503 })
})

function response() {
  return { statusCode: 0, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = value },
  }
}

test('routes require shared authentication, return catalog/audio/error receipts, and guard missing services', async () => {
  assert.deepEqual(inject, ['webServer', 'connection'])
  apply({}); apply({ webServer: { register() { assert.fail('connection required') } } })
  const routes = [], disposals = []
  let rejection = 401, calls = 0
  const ctx = { effect(fn) { disposals.push(fn()) }, webServer: { register(route) { routes.push(route); return () => {} } },
    connection: { requestRejection() { return rejection } },
  }
  registerNotificationSoundRoutes(ctx, {
    async getCatalog() { calls++; return { platform: 'darwin', sounds: [{ id: 'system', label: 'System default' }] } },
    async readSound(id) {
      calls++
      if (id !== 'system') throw Object.assign(new Error('secret /private/path'), { statusCode: id === 'missing' ? 404 : 503 })
      return { bytes: wav(), contentType: 'audio/wav' }
    },
  })
  assert.deepEqual(routes.map(({ path: pathname, kind }) => [pathname, kind]), [[SOUNDS_PATH, 'exact'], [SOUND_PATH, 'exact']])
  async function request(index, query = '', method = 'GET') {
    const res = response()
    await routes[index].handler({ method, url: routes[index].path + query }, res)
    return res
  }
  for (const index of [0, 1]) assert.equal((await request(index, '?id=system')).statusCode, 401)
  assert.equal(calls, 0)
  rejection = undefined
  assert.equal(JSON.parse((await request(0)).body).sounds[0].id, 'system')
  const sound = await request(1, '?id=system')
  assert.equal(sound.statusCode, 200); assert.equal(sound.headers['content-type'], 'audio/wav')
  assert.equal(sound.headers['cache-control'], 'no-store'); assert.deepEqual(sound.body, wav())
  for (const [id, status] of [['missing', 404], ['bad', 503]]) {
    const res = await request(1, `?id=${id}`)
    assert.equal(res.statusCode, status)
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.body.includes('/private/path'), false)
  }
  assert.equal((await request(0, '', 'POST')).statusCode, 404)
  assert.equal(disposals.length, 2)
  disposals.forEach((dispose) => dispose())
})
