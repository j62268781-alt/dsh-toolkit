import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ELECTRON_VERSION, executableIn, helperEnvironment, resolveElectron, runtimeDirectory } from '../../src/modules/pet/host/electron.js'
import { readSettings } from '../../src/modules/pet/host/config.js'

async function temporaryHome(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'toolkit-pet-test-'))
  const previous = { DSH_HOME: process.env.DSH_HOME, DSH_TOOLKIT_ELECTRON_PATH: process.env.DSH_TOOLKIT_ELECTRON_PATH }
  process.env.DSH_HOME = directory
  delete process.env.DSH_TOOLKIT_ELECTRON_PATH
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    assert.equal(path.dirname(directory), path.resolve(tmpdir()))
    assert.match(path.basename(directory), /^toolkit-pet-test-/)
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

async function executable(file) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, '#!/bin/sh\nexit 0\n')
  await chmod(file, 0o755)
  return file
}

test('runtime resolution uses explicit paths before environment overrides and never downloads when disabled', async (t) => {
  const directory = await temporaryHome(t)
  assert.equal(await resolveElectron(), undefined)
  const fromEnvironment = await executable(path.join(directory, 'environment-electron'))
  const explicit = await executable(path.join(directory, 'explicit-electron'))
  process.env.DSH_TOOLKIT_ELECTRON_PATH = fromEnvironment
  assert.equal(await resolveElectron(), fromEnvironment)
  assert.equal(await resolveElectron({ electronPath: explicit }), explicit)
  await assert.rejects(resolveElectron({ electronPath: 'relative/electron' }), /absolute executable path/)
  await assert.rejects(resolveElectron({ electronPath: path.join(directory, 'missing') }), /absolute executable path/)
})

test('runtime cache is platform/version scoped and reused without a network request', async (t) => {
  const directory = await temporaryHome(t)
  assert.equal(runtimeDirectory(), path.join(directory, 'toolkit', 'pet', 'electron', `${ELECTRON_VERSION}-${process.platform}-${process.arch}`))
  const cached = await executable(executableIn(runtimeDirectory()))
  assert.equal(await resolveElectron({ download: false }), cached)
  assert.equal(await resolveElectron({ download: true }), cached, 'a valid cache bypasses downloader dependencies')
  if (process.platform !== 'win32') {
    await chmod(cached, 0o644)
    assert.equal(await resolveElectron({ download: false }), undefined)
  }
})

test('runtime paths identify each supported platform executable', () => {
  assert.equal(executableIn('/cache', 'darwin'), path.join('/cache', 'Electron.app/Contents/MacOS/Electron'))
  assert.equal(executableIn('/cache', 'win32'), path.join('/cache', 'electron.exe'))
  assert.equal(executableIn('/cache', 'linux'), path.join('/cache', 'electron'))
})

test('runtime rejects a directory passed as an explicit executable', async (t) => {
  const directory = await temporaryHome(t)
  await assert.rejects(resolveElectron({ electronPath: directory }), /executable/)
})

test('helper environment removes Node mode without mutating caller state', () => {
  const original = { ELECTRON_RUN_AS_NODE: '1', KEEP: 'value', DSH_TOOLKIT_PET_TOKEN: 'stale' }
  const result = helperEnvironment('http://127.0.0.1:1234', 'new-token', original)
  assert.deepEqual(original, { ELECTRON_RUN_AS_NODE: '1', KEEP: 'value', DSH_TOOLKIT_PET_TOKEN: 'stale' })
  assert.equal(result.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(result.KEEP, 'value')
  assert.equal(result.DSH_TOOLKIT_PET_TOKEN, 'new-token')
  assert.equal(result.DSH_TOOLKIT_HOST_PID, String(process.pid))
})

test('settings default to disabled desktop surfaces and exclude the private executable setting', () => {
  assert.deepEqual(readSettings(), { activePet: 'deepseek-whale', petEnabled: false, petSize: 100, bubbleWidth: 280, islandEnabled: false, islandIdle: true, islandAllDisplays: true, islandWidth: 100, islandHeight: 100 })
  assert.equal('electronPath' in readSettings({ electronPath: '/private/runtime' }), false)
})

test('settings clamp finite dimensions and reject coercion and nonfinite numbers', () => {
  assert.deepEqual(readSettings({ activePet: 123, petEnabled: 'true', islandEnabled: 1, petSize: -1, bubbleWidth: 900, islandWidth: 200, islandHeight: 2, islandIdle: false, islandAllDisplays: false }), {
    activePet: 'deepseek-whale', petEnabled: false, petSize: 50, bubbleWidth: 480, islandEnabled: false, islandIdle: false, islandAllDisplays: false, islandWidth: 150, islandHeight: 75,
  })
  for (const invalid of [NaN, Infinity, -Infinity, '80', null]) {
    const settings = readSettings({ petSize: invalid, bubbleWidth: invalid, islandWidth: invalid, islandHeight: invalid })
    assert.equal(settings.petSize, 100)
    assert.equal(settings.bubbleWidth, 280)
    assert.equal(settings.islandWidth, 100)
    assert.equal(settings.islandHeight, 100)
  }
  const original = { activePet: 'custom', petEnabled: true, islandEnabled: true, petSize: 75, bubbleWidth: 320, islandWidth: 90, islandHeight: 110 }
  const settings = readSettings(original)
  assert.equal(settings.activePet, 'custom')
  assert.equal(settings.petEnabled, true)
  assert.equal(settings.islandEnabled, true)
  assert.equal(original.petSize, 75)
  assert.equal(settings.petSize, 75)
})
