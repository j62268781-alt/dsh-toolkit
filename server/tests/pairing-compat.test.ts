import { createHash, createPrivateKey, createPublicKey, randomUUID, type KeyObject } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRemoteServer, type Config } from '../src/server.js'
import { deviceKeys, pairingProof, proofKey, serverKeyObject } from './pairing-helpers.js'

/**
 * Interoperability tests against the *official* pairing material:
 *
 * - `tests/fixtures/pairing-proof-v1.json` is vendored verbatim from
 *   `ds-harness-remote/fixtures/pairing/v1/proof.json` (MIT). It was generated
 *   with Python `cryptography` and verified independently with NSec, so it is an
 *   external ground truth for the proof algorithm rather than our own derivation.
 * - The zod schemas below are copied from the official desktop client
 *   `packages/plugin/src/pairing-contract.ts` and are `.strict()`, so they also
 *   prove the server emits no extra fields.
 * - The host descriptor used here mirrors `packages/plugin/src/service.ts`: the
 *   desktop sends no `clientVersion`, which the server has to default.
 */

const account = 'owner@example.com'
const password = 'local-test-password'

const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

interface ProofVector {
  side: 'host' | 'mobile'
  path: string
  body: string
  proofKey: string
  message: string
  proof: string
}

interface ProofFixture {
  sessionId: string
  devicePrivateKey: string
  devicePublicKey: string
  serverPrivateKey: string
  serverPublicKey: string
  vectors: ProofVector[]
}

const fixture: ProofFixture = JSON.parse(
  readFileSync(new URL('./fixtures/pairing-proof-v1.json', import.meta.url), 'utf8'),
) as ProofFixture

function x25519Private(raw: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_X25519_PREFIX, Buffer.from(raw, 'base64url')]),
    format: 'der',
    type: 'pkcs8',
  })
}

const fixtureDeviceKey = (): KeyObject => x25519Private(fixture.devicePrivateKey)
const fixtureServerKey = (): KeyObject => x25519Private(fixture.serverPrivateKey)

/** Official desktop schemas (`packages/plugin/src/pairing-contract.ts`). */
const officialDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: z.string().max(128),
  role: z.enum(['host', 'client']),
  platform: z.string().max(32),
  identityKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  clientVersion: z.string().nullable().optional(),
  harnessVersion: z.string().nullable().optional(),
}).strict()

const officialTokensSchema = z.object({
  accessToken: z.string().min(16),
  accessTokenExpiresAt: z.number(),
  refreshToken: z.string().min(16),
  refreshTokenExpiresAt: z.number(),
}).strict()

const officialCredentialsSchema = z.object({
  account: z.string().min(1).max(254),
  accountKind: z.enum(['standard', 'device_only']),
  device: officialDeviceSchema,
  inboundOnly: z.boolean(),
  pairingRestricted: z.boolean(),
  tokens: officialTokensSchema,
}).strict()

const officialCreatedSchema = z.object({
  v: z.literal(1),
  sessionId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  serverPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  scanSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  host: officialDeviceSchema,
}).strict()

const officialStatusSchema = z.object({
  v: z.literal(1),
  sessionId: z.string().uuid(),
  state: z.enum(['created', 'claimed', 'approved', 'completed', 'failed', 'cancelled', 'expired']),
  expiresAt: z.number().int().positive(),
  recoverUntil: z.number().int().positive(),
  failureReason: z.string().nullable(),
  attemptConsumed: z.boolean(),
  submissionId: z.string().nullable(),
  host: officialDeviceSchema,
  mobile: officialDeviceSchema.nullable(),
  credentials: officialCredentialsSchema.nullable(),
}).strict()

const MAX_LIMITS = { create: 10_000, resolve: 10_000, request: 10_000, discovery: 10_000 }

type App = ReturnType<typeof createRemoteServer>
let app: App, dir: string, base: string

async function start(overrides: Partial<Config> = {}): Promise<void> {
  app = createRemoteServer({
    account,
    password,
    dataFile: join(dir, 'state.json'),
    publicUrl: 'http://localhost:8080',
    pairingRateLimits: MAX_LIMITS,
    ...overrides,
  })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
}

async function post(path: string, body: string, proof?: string): Promise<{ status: number; value: any }> {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(proof ? { 'X-DSH-Pairing-Proof': proof } : {}) },
    body,
  })
  const text = await response.text()
  return { status: response.status, value: JSON.parse(text) }
}

function sessionPath(sessionId: string, action: string): string {
  return `/api/v1/device-pairing/sessions/${sessionId}/${action}`
}

async function createSession(host: Record<string, unknown>): Promise<any> {
  const { value } = await post('/api/v1/device-pairing/sessions', JSON.stringify({ v: 1, device: host }))
  return officialCreatedSchema.parse(value)
}

function signed(
  key: KeyObject,
  session: { sessionId: string; serverPublicKey: string },
  side: 'host' | 'mobile',
  path: string,
  body: string,
): string {
  return pairingProof(key, session.serverPublicKey, session.sessionId, side, path, body)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pairing-compat-'))
})

afterEach(async () => {
  try { await app?.close() } catch {}
  rmSync(dir, { recursive: true, force: true })
})

describe('vendored upstream proof fixture', () => {
  it('matches the desktop algorithm byte for byte', () => {
    // The fixture is self consistent: the private key derives the published public key.
    const derivedPublic = Buffer.from(
      createPublicKey(fixtureServerKey()).export({ format: 'der', type: 'spki' }),
    ).subarray(-32).toString('base64url')
    expect(derivedPublic).toBe(fixture.serverPublicKey)
    expect(Buffer.from(
      createPublicKey(fixtureDeviceKey()).export({ format: 'der', type: 'spki' }),
    ).subarray(-32).toString('base64url')).toBe(fixture.devicePublicKey)

    for (const vector of fixture.vectors) {
      const key = proofKey(fixtureDeviceKey(), fixture.serverPublicKey, fixture.sessionId, vector.side)
      expect(key.toString('base64url')).toBe(vector.proofKey)
      const digest = createHash('sha256').update(vector.body, 'utf8').digest('hex')
      expect(`POST\n${vector.path}\n${digest}`).toBe(vector.message)
      expect(pairingProof(
        fixtureDeviceKey(), fixture.serverPublicKey, fixture.sessionId, vector.side, vector.path, vector.body,
      )).toBe(vector.proof)
    }
  })
})

describe('official desktop client contract', () => {
  it('accepts the official host descriptor (no clientVersion) and the fixture host proof', async () => {
    await start({
      // Pin the session identity so the published fixture vector replays exactly.
      pairingSessionKeys: () => ({
        sessionId: fixture.sessionId,
        privateKey: fixtureServerKey(),
        publicKey: fixture.serverPublicKey,
      }),
    })

    const desktop = {
      deviceId: randomUUID(),
      name: 'Joseon MacBook',
      role: 'host',
      platform: 'darwin', // process.platform on macOS
      identityKey: fixture.devicePublicKey,
      harnessVersion: '0.6.4',
    }
    const created = await createSession(desktop)
    expect(created.sessionId).toBe(fixture.sessionId)
    expect(created.serverPublicKey).toBe(fixture.serverPublicKey)
    expect(created.host.identityKey).toBe(desktop.identityKey)
    expect(created.expiresAt).toBeGreaterThan(Date.now())

    // host/status with the published proof and body "{}" must be accepted.
    const vector = fixture.vectors.find(v => v.side === 'host' && v.path.endsWith('/host/status'))!
    const status = await post(vector.path, vector.body, vector.proof)
    expect(status.status).toBe(200)
    const parsed = officialStatusSchema.parse(status.value)
    expect(parsed.state).toBe('created')
    expect(parsed.host.deviceId).toBe(desktop.deviceId)

    // A phone that recomputes the proof still works: our side of the algorithm is
    // the same code path the fixture validated.
    const phone = deviceKeys()
    const claimText = JSON.stringify({
      scanSecret: created.scanSecret,
      device: { deviceId: randomUUID(), name: 'Pixel', role: 'client', platform: 'android', identityKey: phone.identityKey },
    })
    const claimPath = sessionPath(created.sessionId, 'claim')
    const claim = await post(claimPath, claimText, signed(phone.privateKey, created, 'mobile', claimPath, claimText))
    expect(claim.status).toBe(200)
    expect(claim.value.verificationCode).toMatch(/^[0-9]{8}$/)
  })

  it('accepts the fixture mobile status and confirm proofs on a claimed session', async () => {
    await start({
      pairingSessionKeys: () => ({
        sessionId: fixture.sessionId,
        privateKey: fixtureServerKey(),
        publicKey: fixture.serverPublicKey,
      }),
    })

    const host = deviceKeys()
    const created = await createSession({
      deviceId: randomUUID(), name: 'Host', role: 'host', platform: 'linux',
      identityKey: host.identityKey, clientVersion: '0.6.4',
    })

    // The phone is the fixture device, so its published "{}" proof is valid.
    const claimText = JSON.stringify({
      scanSecret: created.scanSecret,
      device: {
        deviceId: randomUUID(), name: 'Phone', role: 'client', platform: 'ios',
        identityKey: fixture.devicePublicKey,
      },
    })
    const claimPath = sessionPath(created.sessionId, 'claim')
    const claim = await post(claimPath, claimText, signed(fixtureDeviceKey(), created, 'mobile', claimPath, claimText))
    expect(claim.status).toBe(200)
    expect(claim.value.state).toBe('claimed')

    const mobileVector = fixture.vectors.find(v => v.side === 'mobile')!
    const mobileStatus = await post(mobileVector.path, mobileVector.body, mobileVector.proof)
    expect(mobileStatus.status).toBe(200)
    const parsed = officialStatusSchema.parse(mobileStatus.value)
    expect(parsed.state).toBe('claimed')
    expect(parsed.mobile?.identityKey).toBe(fixture.devicePublicKey)
    expect(parsed.submissionId).toBeNull() // host-only field

  })

  it('accepts the fixture confirm proof and consumes the attempt', async () => {
    await start({
      pairingSessionKeys: () => ({
        sessionId: fixture.sessionId,
        privateKey: fixtureServerKey(),
        publicKey: fixture.serverPublicKey,
      }),
    })

    // The fixture signs confirm as the *host*, so the host of this session is the
    // fixture device; an independent phone claims it first.
    const created = await createSession({
      deviceId: randomUUID(), name: 'Host', role: 'host', platform: 'linux',
      identityKey: fixture.devicePublicKey,
    })
    const phone = deviceKeys()
    const claimText = JSON.stringify({
      scanSecret: created.scanSecret,
      device: { deviceId: randomUUID(), name: 'Phone', role: 'client', platform: 'android', identityKey: phone.identityKey },
    })
    const claimPath = sessionPath(created.sessionId, 'claim')
    expect((await post(claimPath, claimText, signed(phone.privateKey, created, 'mobile', claimPath, claimText))).status).toBe(200)

    // The published confirm body carries a stale code: the proof must be accepted
    // and the attempt consumed, with the documented failure reasons.
    const confirmVector = fixture.vectors.find(v => v.path.endsWith('/host/confirm'))!
    const confirm = await post(confirmVector.path, confirmVector.body, confirmVector.proof)
    expect(confirm.status).toBe(200)
    const afterConfirm = officialStatusSchema.parse(confirm.value)
    expect(afterConfirm.attemptConsumed).toBe(true)
    expect(['failed', 'completed']).toContain(afterConfirm.state)
    if (afterConfirm.state === 'failed') expect(afterConfirm.failureReason).toBe('verification_failed')
  })

  it('keeps official error bodies machine readable', async () => {
    await start()
    const { status, value } = await post('/api/v1/device-pairing/sessions', JSON.stringify({ v: 1, device: { bad: true } }))
    expect(status).toBe(422)
    // `host-pairing.ts` only propagates errors whose code matches this pattern.
    expect(value.error.code).toMatch(/^[A-Z_]{1,80}$/)
    expect(typeof value.error.message).toBe('string')

    // Existing session, garbage proof: rejected without leaking details.
    const host = deviceKeys()
    const created = await createSession({
      deviceId: randomUUID(), name: 'Host', role: 'host', platform: 'linux', identityKey: host.identityKey,
    })
    const rejected = await post(sessionPath(created.sessionId, 'host/status'), '{}', 'a'.repeat(43))
    expect(rejected.status).toBe(403)
    expect(rejected.value.error.code).toMatch(/^[A-Z_]{1,80}$/)
    expect(rejected.value.error.message).not.toContain('a'.repeat(43))
  })
})
