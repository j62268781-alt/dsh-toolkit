import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readElectronPath, readField, readSettings } from '../../src/modules/pet/host/config.js'

/** Mirrors the frozen reference DSH hands to `apply()` for a `.volatile()` field. */
const reference = (value) => ({ get: () => value })
const defaults = {
  activePet: 'qoduck-lab', petEnabled: false, petSize: 100, bubbleWidth: 280,
  islandEnabled: false, islandIdle: true, islandAllDisplays: true, islandWidth: 100, islandHeight: 100,
}

test('volatile references are unwrapped while plain values pass through untouched', () => {
  const config = {
    activePet: reference('neon-cat'),
    petEnabled: reference(true),
    islandEnabled: reference(false),
    islandWidth: reference(150),
    petSize: 80,
  }
  assert.equal(readField(config, 'petEnabled'), true)
  assert.equal(readField(config, 'petSize'), 80)
  assert.deepEqual(readSettings(config), { ...defaults, activePet: 'neon-cat', petEnabled: true, petSize: 80, islandWidth: 150 })
  assert.deepEqual(readSettings({}), defaults)
  assert.deepEqual(readSettings(), defaults)
})

test('references are re-read on every access, so an in-place settings edit is visible', () => {
  let islandWidth = 100
  const config = { islandWidth: { get: () => islandWidth } }
  assert.equal(readSettings(config).islandWidth, 100)
  islandWidth = 130
  assert.equal(readSettings(config).islandWidth, 130)
})

test('a throwing reference or a wrong shape falls back to defaults instead of throwing', () => {
  const config = {
    petEnabled: { get() { throw new Error('boom') } },
    petSize: {},
    islandWidth: 'wide',
    activePet: '',
    electronPath: {},
  }
  assert.deepEqual(readSettings(config), defaults)
  assert.equal(readElectronPath(config), '')
  assert.equal(readElectronPath(undefined), '')
})

test('the configured Electron path is trimmed for volatile, plain and empty inputs', () => {
  assert.equal(readElectronPath({ electronPath: reference('/opt/electron') }), '/opt/electron')
  assert.equal(readElectronPath({ electronPath: reference('  /opt/electron  ') }), '/opt/electron')
  assert.equal(readElectronPath({ electronPath: '/opt/plain' }), '/opt/plain')
  assert.equal(readElectronPath({ electronPath: reference('') }), '')
  assert.equal(readElectronPath({}), '')
})
