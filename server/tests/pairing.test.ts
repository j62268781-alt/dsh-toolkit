import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createRemoteServer, type Config } from '../src/server.js'
import { deviceKeys, pairingProof, type DeviceKeys } from './pairing-helpers.js'

/**
 * End to end tests for device pairing v1 against a real HTTP server on port 0.
 * The peer side (X25519 keys, HKDF proof) is implemented with node:crypto only,
 * mirroring the official desktop and phone clients byte for byte.
 */

const account = 'owner@example.com'
const password = 'local-test-password'

type App = ReturnType<typeof createRemoteServer>
let app: App, dir: string, base: string

const MAX_LIMITS = { create: 10_000, resolve: 10_000, request: 10_000, discovery: 10_000 }

async function start(overrides: Partial<Config> = {}): Promise<void> {
  app = createRemoteServer({
    account,
    password,
    dataFile: join(dir, 'state.json'),
    publicUrl: 'http://localhost:8080',
    // The protocol limits are far too tight for a test process that runs dozens
    // of sessions from 127.0.0.1; the limiters themselves are tested separately.
    pairingRateLimits: MAX_LIMITS,
    ...overrides,
  })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
}

async function stop(): Promise<void> {
  // A test may have closed and restarted the app already.
  try { await app.close() } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true })
}

async function post(path: string, body: string | object, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: text,
  })
  return { status: response.status, data: await response.json() as any, text }
}

async function get(path: string) {
  const response = await fetch(`${base}${path}`)
  const text = await response.text()
  const isJson = response.headers.get('content-type')?.includes('json') ?? false
  return { status: response.status, text, data: isJson ? JSON.parse(text) as any : undefined }
}

interface Peer { keys: DeviceKeys; device: Record<string, unknown> }

function hostPeer(overrides: Record<string, unknown> = {}): Peer {
  const keys = deviceKeys()
  return {
    keys,
    device: {
      deviceId: randomUUID(), name: 'Studio Desktop', role: 'host', platform: 'macOS',
      identityKey: keys.identityKey, clientVersion: '0.6.4', harnessVersion: '0.6.4', ...overrides,
    },
  }
}

function mobilePeer(overrides: Record<string, unknown> = {}): Peer {
  const keys = deviceKeys()
  return {
    keys,
    device: {
      deviceId: randomUUID(), name: 'Pixel Phone', role: 'client', platform: 'iOS',
      identityKey: keys.identityKey, clientVersion: '0.1.0', ...overrides,
    },
  }
}

interface Created {
  v: number
  sessionId: string
  expiresAt: number
  serverPublicKey: string
  scanSecret: string
  host: Record<string, any>
}

async function createSession(host: Peer = hostPeer()): Promise<{ host: Peer; created: Created }> {
  const result = await post('/api/v1/device-pairing/sessions', { v: 1, device: host.device })
  expect(result.status).toBe(200)
  return { host, created: result.data as Created }
}

const sessionPath = (sessionId: string, action: string) => `/api/v1/device-pairing/sessions/${sessionId}/${action}`

/** POST as one pairing side, proof computed over the exact bytes being sent. */
async function signedPost(path: string, body: object, session: Created, peer: Peer, side: 'host' | 'mobile', headers: Record<string, string> = {}) {
  const text = JSON.stringify(body)
  return post(path, text, {
    'X-DSH-Pairing-Proof': pairingProof(peer.keys.privateKey, session.serverPublicKey, session.sessionId, side, path, text),
    ...headers,
  })
}

async function claimSession(session: Created, peer: Peer, overrides: Record<string, unknown> = {}) {
  return signedPost(sessionPath(session.sessionId, 'claim'), { scanSecret: session.scanSecret, device: { ...peer.device, ...overrides } }, session, peer, 'mobile')
}

async function claimedSession() {
  const { host, created } = await createSession()
  const mobile = mobilePeer()
  const claim = await claimSession(created, mobile)
  expect(claim.status).toBe(200)
  return { host, mobile, created, code: claim.data.verificationCode as string }
}

const statusBody = (session: Created, peer: Peer, side: 'host' | 'mobile') =>
  signedPost(sessionPath(session.sessionId, side === 'host' ? 'host/status' : 'mobile/status'), {}, session, peer, side)

function hostStatus(session: Created, host: Peer) { return statusBody(session, host, 'host') }
function mobileStatus(session: Created, mobile: Peer) { return statusBody(session, mobile, 'mobile') }

function confirm(session: Created, host: Peer, submissionId: string, verificationCode: string) {
  return signedPost(sessionPath(session.sessionId, 'host/confirm'), { submissionId, verificationCode }, session, host, 'host')
}

// ---------------------------------------------------------------------------

describe('device pairing v1: discovery and session creation', () => {
  it('advertises the pairing capability on both discovery endpoints', async () => {
    const providers = await get('/api/v1/auth/oauth/providers')
    expect(providers.status).toBe(200)
    expect(providers.data).toEqual({
      capabilities: { devicePairing: 'dsh-pairing-v1', devicePairingQr: 'fragment-ticket-v1' },
      items: [],
    })
    const capabilities = await get('/api/v1/device-pairing/capabilities')
    expect(capabilities.status).toBe(200)
    expect(capabilities.data.capabilities).toEqual(providers.data.capabilities)
  })

  it('serves a script free guidance page for the QR target', async () => {
    const page = await get('/pair')
    expect(page.status).toBe(200)
    expect(page.text).toContain('DSH')
    expect(page.text).not.toContain('<script')
  })

  it('creates a 180 second session with canonical 32 byte keys', async () => {
    const before = Date.now()
    const { created, host } = await createSession()
    expect(created.v).toBe(1)
    expect(created.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
    expect(created.expiresAt).toBeGreaterThanOrEqual(before + 179_000)
    expect(created.expiresAt).toBeLessThanOrEqual(Date.now() + 181_000)
    for (const key of [created.serverPublicKey, created.scanSecret]) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u)
      expect(Buffer.from(key, 'base64url')).toHaveLength(32)
    }
    expect(created.host).toMatchObject({ deviceId: host.device.deviceId, role: 'host', identityKey: host.keys.identityKey })
  })

  it('resolves an unclaimed ticket and rejects anything else', async () => {
    const { created } = await createSession()
    const resolved = await post('/api/v1/device-pairing/resolve', { ticket: created.scanSecret })
    expect(resolved.status).toBe(200)
    expect(resolved.data).toMatchObject({ sessionId: created.sessionId, scanSecret: created.scanSecret, expiresAt: created.expiresAt })

    const unknown = await post('/api/v1/device-pairing/resolve', { ticket: 'A'.repeat(43) })
    expect(unknown.status).toBe(404)
    expect(unknown.data.error.code).toBe('PAIRING_NOT_FOUND')
  })

  it('rejects malformed and oversized pairing payloads', async () => {
    const host = hostPeer()
    const extra = await post('/api/v1/device-pairing/sessions', { v: 1, device: host.device, extra: true })
    expect(extra.status).toBe(422)
    expect(extra.data.error.code).toBe('INVALID_MESSAGE')

    const wrongRole = await post('/api/v1/device-pairing/sessions', { v: 1, device: { ...host.device, role: 'client' } })
    expect(wrongRole.status).toBe(422)

    for (const identityKey of ['A'.repeat(42), 'A'.repeat(44), 'A'.repeat(43), `${'A'.repeat(42)}=`]) {
      const invalid = await post('/api/v1/device-pairing/sessions', { v: 1, device: { ...host.device, identityKey } })
      expect(invalid.status).toBe(422)
    }

    const duplicate = await post('/api/v1/device-pairing/sessions',
      `{"v":1,"v":1,"device":${JSON.stringify(host.device)}}`)
    expect(duplicate.status).toBe(422)

    const huge = await post('/api/v1/device-pairing/sessions', JSON.stringify({ v: 1, device: host.device, pad: 'x'.repeat(9000) }))
    expect(huge.status).toBe(413)
  })
})

describe('device pairing v1: claim and verification', () => {
  it('issues an eight digit code to the first phone and echoes it on replay', async () => {
    const { created } = await createSession()
    const mobile = mobilePeer()
    const first = await claimSession(created, mobile)
    expect(first.status).toBe(200)
    expect(first.data.state).toBe('claimed')
    expect(first.data.verificationCode).toMatch(/^[0-9]{8}$/u)
    expect(first.data.expiresAt).toBe(created.expiresAt)

    const replay = await claimSession(created, mobile)
    expect(replay.status).toBe(200)
    expect(replay.data.verificationCode).toBe(first.data.verificationCode)

    // A different phone (or different bytes) after the claim is a conflict.
    const other = await claimSession(created, mobilePeer())
    expect(other.status).toBe(409)
    expect(other.data.error.code).toBe('PAIRING_DEVICE_CONFLICT')

    // The ticket is consumed: resolve no longer finds the session.
    const resolved = await post('/api/v1/device-pairing/resolve', { ticket: created.scanSecret })
    expect(resolved.status).toBe(404)
  })

  it('refuses a wrong scan secret and reports the claim to both sides', async () => {
    const { host, created } = await createSession()
    const mobile = mobilePeer()
    const denied = await signedPost(sessionPath(created.sessionId, 'claim'), {
      scanSecret: 'A'.repeat(43), device: mobile.device,
    }, created, mobile, 'mobile')
    expect(denied.status).toBe(403)
    expect(denied.data.error.code).toBe('PAIRING_SCAN_INVALID')

    const beforeClaim = await mobileStatus(created, mobile)
    expect(beforeClaim.status).toBe(409)
    expect(beforeClaim.data.error.code).toBe('PAIRING_NOT_CLAIMED')

    const claim = await claimSession(created, mobile)
    expect(claim.status).toBe(200)

    const hostView = await hostStatus(created, host)
    expect(hostView.status).toBe(200)
    expect(hostView.data).toMatchObject({
      v: 1, sessionId: created.sessionId, state: 'claimed', attemptConsumed: false,
      failureReason: null, submissionId: null, mobile: { deviceId: mobile.device.deviceId }, credentials: null,
    })
    expect(hostView.data.recoverUntil).toBe(created.expiresAt + 300_000)
    expect(hostView.data.host).toMatchObject({ deviceId: host.device.deviceId, role: 'host' })

    const mobileView = await mobileStatus(created, mobile)
    expect(mobileView.status).toBe(200)
    expect(mobileView.data.submissionId).toBeNull()
  })

  it('fails the session on a wrong code and never allows a second attempt', async () => {
    const { host, created, code } = await claimedSession()
    const wrong = code === '00000000' ? '11111111' : '00000000'
    const failed = await confirm(created, host, randomUUID(), wrong)
    expect(failed.status).toBe(200)
    expect(failed.data).toMatchObject({
      state: 'failed', failureReason: 'verification_failed', attemptConsumed: true, credentials: null,
    })
    expect(JSON.stringify(failed.data)).not.toContain(code)

    const retry = await confirm(created, host, randomUUID(), code)
    expect(retry.status).toBe(409)
    expect(retry.data.error.code).toBe('PAIRING_ATTEMPT_USED')
  })

  it('completes the transaction and hands each side its own credentials', async () => {
    const { host, mobile, created, code } = await claimedSession()
    const submissionId = randomUUID()
    const done = await confirm(created, host, submissionId, code)
    expect(done.status).toBe(200)
    expect(done.data).toMatchObject({ state: 'completed', attemptConsumed: true, submissionId, failureReason: null })

    const hostCredentials = done.data.credentials
    expect(hostCredentials).toMatchObject({
      accountKind: 'device_only', inboundOnly: true, pairingRestricted: true,
    })
    expect(hostCredentials.account).toMatch(/^dsh-device:[0-9a-f-]{36}$/u)
    expect(hostCredentials.device).toMatchObject({ deviceId: host.device.deviceId, role: 'host' })
    expect(hostCredentials.tokens.accessToken).toHaveLength(43)
    expect(hostCredentials.tokens.refreshToken).toHaveLength(43)
    expect(hostCredentials.tokens.accessTokenExpiresAt).toBeGreaterThan(Date.now())
    expect(hostCredentials.tokens.refreshTokenExpiresAt).toBeGreaterThan(hostCredentials.tokens.accessTokenExpiresAt)

    const mobileView = await mobileStatus(created, mobile)
    expect(mobileView.status).toBe(200)
    expect(mobileView.data.state).toBe('completed')
    const mobileCredentials = mobileView.data.credentials
    expect(mobileCredentials).toMatchObject({ accountKind: 'device_only', inboundOnly: false, pairingRestricted: true })
    expect(mobileCredentials.device).toMatchObject({ deviceId: mobile.device.deviceId, role: 'client' })
    expect(mobileCredentials.tokens.accessToken).not.toBe(hostCredentials.tokens.accessToken)

    // The host token is a working device credential.
    const me = await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${hostCredentials.tokens.accessToken}` } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ deviceId: host.device.deviceId, role: 'host' })

    // The phone token can list hosts and refresh itself.
    const devices = await fetch(`${base}/api/v1/devices`, { headers: { Authorization: `Bearer ${mobileCredentials.tokens.accessToken}` } })
    expect(devices.status).toBe(200)
    const listed = await devices.json() as { items: { deviceId: string }[] }
    expect(listed.items.map(item => item.deviceId)).toContain(host.device.deviceId)

    const refresh = await post('/api/v1/auth/refresh', { deviceId: mobile.device.deviceId, refreshToken: mobileCredentials.tokens.refreshToken })
    expect(refresh.status).toBe(200)
    expect(refresh.data.accessToken).toHaveLength(43)

    // The pairing state survives a server restart (state.json is on disk).
    expect(app.store.list().map(d => d.descriptor.deviceId)).toEqual(expect.arrayContaining([host.device.deviceId, mobile.device.deviceId]))
  })

  it('is idempotent for the same submission and rejects a fresh one', async () => {
    const { host, created, code } = await claimedSession()
    const submissionId = randomUUID()
    const first = await confirm(created, host, submissionId, code)
    expect(first.status).toBe(200)
    const replay = await confirm(created, host, submissionId, code)
    expect(replay.status).toBe(200)
    expect(replay.data.credentials).toEqual(first.data.credentials)

    const fresh = await confirm(created, host, randomUUID(), code)
    expect(fresh.status).toBe(409)
    expect(fresh.data.error.code).toBe('PAIRING_ATTEMPT_USED')
  })

  it('lets the phone cancel and freezes the session afterwards', async () => {
    const { host, mobile, created, code } = await claimedSession()
    const cancelled = await signedPost(sessionPath(created.sessionId, 'mobile/cancel'), {}, created, mobile, 'mobile')
    expect(cancelled.status).toBe(200)
    expect(cancelled.data.state).toBe('cancelled')

    const confirmAfter = await confirm(created, host, randomUUID(), code)
    expect(confirmAfter.status).toBe(409)
    expect(confirmAfter.data.error.code).toBe('PAIRING_CLOSED')

    const twice = await hostStatus(created, host)
    expect(twice.status).toBe(200)
    expect(twice.data.state).toBe('cancelled')
    expect(twice.data.credentials).toBeNull()
  })
})

describe('device pairing v1: proof enforcement', () => {
  it('rejects missing, malformed and misplaced proofs', async () => {
    const { host, mobile, created } = await claimedSession()
    const path = sessionPath(created.sessionId, 'host/status')

    const missing = await post(path, {})
    expect(missing.status).toBe(403)
    expect(missing.data.error.code).toBe('PAIRING_FORBIDDEN')

    const garbage = await post(path, {}, { 'X-DSH-Pairing-Proof': 'not-a-proof' })
    expect(garbage.status).toBe(403)

    // A valid proof for a different path must not be reusable.
    const otherPath = sessionPath(created.sessionId, 'host/cancel')
    const text = '{}'
    const mismatched = await post(path, text, {
      'X-DSH-Pairing-Proof': pairingProof(host.keys.privateKey, created.serverPublicKey, created.sessionId, 'host', otherPath, text),
    })
    expect(mismatched.status).toBe(403)

    // The phone cannot sign host requests.
    const wrongSide = await post(path, text, {
      'X-DSH-Pairing-Proof': pairingProof(mobile.keys.privateKey, created.serverPublicKey, created.sessionId, 'mobile', path, text),
    })
    expect(wrongSide.status).toBe(403)
  })
})

describe('device pairing v1: expiry and limits', () => {
  it('expires sessions after their lifetime and refuses late claims', async () => {
    await app.close()
    await start({ pairingSessionTtlMs: 40 })
    const { host, created } = await createSession()
    const mobile = mobilePeer()
    await new Promise(resolve => setTimeout(resolve, 80))
    const late = await claimSession(created, mobile)
    expect(late.status).toBe(410)
    expect(late.data.error.code).toBe('PAIRING_EXPIRED')

    const view = await hostStatus(created, host)
    expect(view.status).toBe(200)
    expect(view.data.state).toBe('expired')
    expect(view.data.credentials).toBeNull()
  })

  it('applies the configured creation rate limit', async () => {
    await app.close()
    await start({ pairingRateLimits: { create: 2, resolve: 10_000, request: 10_000, discovery: 10_000 } })
    const host = hostPeer()
    expect((await post('/api/v1/device-pairing/sessions', { v: 1, device: host.device })).status).toBe(200)
    expect((await post('/api/v1/device-pairing/sessions', { v: 1, device: hostPeer().device })).status).toBe(200)
    const limited = await post('/api/v1/device-pairing/sessions', { v: 1, device: hostPeer().device })
    expect(limited.status).toBe(429)
    expect(limited.data.error.code).toBe('RATE_LIMITED')
  })
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pairing-'))
  await start()
})

afterEach(async () => { await stop() })
