import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/store.js'
import { deviceKeys } from './pairing-helpers.js'

/**
 * A successful pairing links a Host and a phone, and one Host may hold several
 * phones. The server routes decide which side an unbind reaches (`server.ts`
 * revokes a Host together with all its phones, a phone only together with the
 * last remaining client); the store only records the edges and reports peers.
 */

const account = 'owner@example.com', password = 'test-only-password'
let dir: string, file: string, store: Store
const invalidated: Array<[string, string]> = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pairing-link-'))
  file = join(dir, 'state.json')
  store = new Store(file, account, password)
  invalidated.length = 0
  store.onInvalidate = (id, reason) => invalidated.push([id, reason])
})
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

function descriptors() {
  const host = {
    deviceId: randomUUID(), name: 'Desktop', identityKey: deviceKeys().identityKey,
    role: 'host' as const, platform: 'macOS', clientVersion: '0.6.4',
  }
  const phone = {
    deviceId: randomUUID(), name: 'Phone', identityKey: deviceKeys().identityKey,
    role: 'client' as const, platform: 'Android', clientVersion: '0.6.4',
  }
  return { host, phone }
}

it('remembers the pairing link across restarts and reports it from both ends', () => {
  const { host, phone } = descriptors()
  store.registerPairing([host, phone], [host.deviceId, phone.deviceId])
  expect(store.peersOf(host.deviceId)).toEqual([phone.deviceId])
  expect(store.peersOf(phone.deviceId)).toEqual([host.deviceId])

  const reopened = new Store(file, account, password)
  expect(reopened.peersOf(host.deviceId)).toEqual([phone.deviceId])
  expect(JSON.parse(readFileSync(file, 'utf8')).pairs).toEqual([[host.deviceId, phone.deviceId]])
})

it('revoking one side revokes the peer with DEVICE_REVOKED and drops both token families', () => {
  const { host, phone } = descriptors()
  const [hostTokens, phoneTokens] = store.registerPairing([host, phone], [host.deviceId, phone.deviceId])
  expect(store.authenticate(hostTokens.accessToken).descriptor.deviceId).toBe(host.deviceId)
  const peers = store.peersOf(phone.deviceId)
  store.revoke(phone.deviceId)
  for (const peer of peers) store.revoke(peer)

  // Revocation keeps the (dead) token records so the Host hears DEVICE_REVOKED.
  expect(() => store.authenticate(hostTokens.accessToken)).toThrow('DEVICE_REVOKED')
  expect(() => store.authenticate(phoneTokens.accessToken)).toThrow('DEVICE_REVOKED')
  // …and the device slots themselves carry the revocation.
  expect(() => store.get(host.deviceId)).toThrow('DEVICE_REVOKED')
  expect(() => store.get(phone.deviceId)).toThrow('DEVICE_REVOKED')
  expect(invalidated).toContainEqual([phone.deviceId, 'DEVICE_REVOKED'])
  expect(invalidated).toContainEqual([host.deviceId, 'DEVICE_REVOKED'])
  expect(store.peersOf(phone.deviceId)).toEqual([host.deviceId])
})

it('lets the same identity claim a revoked slot again so re-pairing works', () => {
  const { host, phone } = descriptors()
  store.registerPairing([host, phone], [host.deviceId, phone.deviceId])
  store.revoke(phone.deviceId)
  const [tokens] = store.registerPairing([host, phone], [host.deviceId, phone.deviceId])
  expect(tokens).toBeDefined()
  expect(store.get(host.deviceId).revoked).toBe(false)
  // A different identity must not take over the revoked slot.
  const impostor = { ...host, identityKey: deviceKeys().identityKey }
  expect(() => store.registerPairing([impostor, phone], [host.deviceId, phone.deviceId])).toThrow('PEER_IDENTITY_MISMATCH')
})

it('binds one host to several phones and keeps the earlier links', () => {
  const host = descriptors().host, one = descriptors().phone, two = descriptors().phone
  store.registerPairing([host, one], [host.deviceId, one.deviceId])
  store.registerPairing([host, two], [host.deviceId, two.deviceId])
  expect(new Set(store.peersOf(host.deviceId))).toEqual(new Set([one.deviceId, two.deviceId]))
  expect(new Set(store.clientsOf(host.deviceId))).toEqual(new Set([one.deviceId, two.deviceId]))
  expect(JSON.parse(readFileSync(file, 'utf8')).pairs).toHaveLength(2)
  // Re-pairing the same two devices refreshes nothing and must not duplicate.
  store.registerPairing([host, one], [host.deviceId, one.deviceId])
  expect(JSON.parse(readFileSync(file, 'utf8')).pairs).toHaveLength(2)
})

it('answers pair lookups from either end and never across unrelated devices', () => {
  const host = descriptors().host, phone = descriptors().phone, other = descriptors().phone
  store.registerPairing([host, phone], [host.deviceId, phone.deviceId])
  expect(store.hasPair(host.deviceId, phone.deviceId)).toBe(true)
  expect(store.hasPair(phone.deviceId, host.deviceId)).toBe(true)
  expect(store.hasPair(host.deviceId, other.deviceId)).toBe(false)
  expect(store.hasPair(host.deviceId, host.deviceId)).toBe(false)
  expect(store.isActive(host.deviceId)).toBe(true)
  store.revoke(phone.deviceId)
  expect(store.isActive(phone.deviceId)).toBe(false)
  expect(store.isActive(other.deviceId)).toBe(false)
})
