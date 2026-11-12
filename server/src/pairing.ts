import {
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  accountDeviceDescriptorSchema,
  parseWireJson,
  type AccountDeviceDescriptor,
  type DeviceTokenPair,
} from './protocol/index.js'
import { ApiError, Store, equal } from './store.js'

/**
 * Device pairing v1 (`docs/device-pairing-v1.md` upstream).
 *
 * Self-hosted server vendored from liguobao/ds-harness-remote, which ships the
 * protocol document but no pairing implementation. Everything below follows the
 * document and the byte-level expectations of the official clients
 * (`packages/plugin/src/host-pairing.ts`, `packages/dsh_remote/...`):
 *
 *   desktop shows QR -> phone scans and claims -> phone shows an 8 digit code ->
 *   the user types it on the desktop -> both sides read their credentials.
 *
 * The server never stores a plaintext secret in a response it can avoid: the
 * scan secret is only compared, the verification code is cleared as soon as it
 * is consumed, and credentials are handed out per side (host never sees the
 * phone token and vice versa).
 */

export const PAIRING_PROTOCOL_VERSION = 1 as const
export const PAIRING_SESSION_TTL_MS = 180_000
export const PAIRING_RECOVERY_MS = 300_000
export const MAX_PAIRING_BODY_BYTES = 8192
export const MAX_ACTIVE_PAIRING_SESSIONS = 1000
export const PAIRING_CAPABILITIES = Object.freeze({
  devicePairing: 'dsh-pairing-v1',
  devicePairingQr: 'fragment-ticket-v1',
})

const SESSION_PATH = /^\/api\/v1\/device-pairing\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(claim|host\/status|mobile\/status|host\/confirm|host\/cancel|mobile\/cancel)$/u
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

/** A 32 byte X25519 key or scan secret in canonical, unpadded base64url. */
const base64UrlKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)

/**
 * Device descriptor as carried by pairing requests. Deliberately separate from
 * `accountDeviceDescriptorSchema`: pairing accepts any bounded opaque device id
 * and platform, while the stored descriptor keeps the stricter registration
 * shape (validated when the transaction runs, see `toStoreDescriptor`).
 */
const pairingDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: z.string().max(128),
  role: z.enum(['host', 'client']),
  platform: z.string().min(1).max(32),
  identityKey: base64UrlKeySchema,
  clientVersion: z.string().max(64).nullable().optional(),
  harnessVersion: z.string().max(64).nullable().optional(),
}).strict()

const noDataSchema = z.object({}).strict()
const createSessionSchema = z.object({
  v: z.literal(PAIRING_PROTOCOL_VERSION),
  device: pairingDeviceSchema,
  deepseekUserId: z.string().min(1).max(256).optional(),
}).strict()
const claimSchema = z.object({
  scanSecret: base64UrlKeySchema,
  device: pairingDeviceSchema,
  deepseekUserId: z.string().min(1).max(256).optional(),
}).strict()
const confirmSchema = z.object({
  submissionId: z.string().min(1).max(128),
  verificationCode: z.string().regex(/^[0-9]{8}$/u),
}).strict()
const resolveSchema = z.object({ ticket: base64UrlKeySchema }).strict()

export type PairingDeviceRole = 'host' | 'client'
export type PairingSide = 'host' | 'mobile'
export type PairingState = 'created' | 'claimed' | 'approved' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface PairingDevice {
  deviceId: string
  name: string
  role: PairingDeviceRole
  platform: string
  identityKey: string
  clientVersion: string | null
  harnessVersion: string | null
}

export interface PairingCredentials {
  account: string
  accountKind: 'device_only'
  device: PairingDevice
  inboundOnly: boolean
  pairingRestricted: true
  tokens: DeviceTokenPair
}

export interface PairingCreatedResponse {
  v: typeof PAIRING_PROTOCOL_VERSION
  sessionId: string
  expiresAt: number
  serverPublicKey: string
  scanSecret: string
  host: PairingDevice
}

export interface PairingStatusResponse {
  v: typeof PAIRING_PROTOCOL_VERSION
  sessionId: string
  state: PairingState
  expiresAt: number
  recoverUntil: number
  failureReason: string | null
  attemptConsumed: boolean
  submissionId: string | null
  host: PairingDevice
  mobile: PairingDevice | null
  credentials: PairingCredentials | null
}

interface PairingSession {
  sessionId: string
  createdAt: number
  expiresAt: number
  recoverUntil: number
  serverPrivateKey: KeyObject
  serverPublicKey: string
  scanSecret: string
  host: PairingDevice
  mobile: PairingDevice | null
  state: PairingState
  failureReason: string | null
  attemptConsumed: boolean
  submissionId: string | null
  submissionBody: string | null
  verificationCode: string | null
  claimBodyHash: string | null
  claimProof: string | null
  credentials: { host: PairingCredentials; mobile: PairingCredentials } | null
  lastTouchedAt: number
}

/** The per-session X25519 key material handed out by a session factory. */
export interface PairingSessionKeys {
  /** Override only from tests that replay deterministic protocol fixtures. */
  sessionId?: string
  privateKey: KeyObject
  /** Canonical 43 character base64url encoding of the raw public key. */
  publicKey: string
}

export interface PairingServiceOptions {
  store: Store
  /** Per-IP limiter shared with the HTTP layer (60s sliding window). */
  rate: (key: string, max: number) => void
  /** Session lifetime; tests lower it. Production uses the protocol's 180s. */
  sessionTtlMs?: number
  now?: () => number
  /** Requests per minute per address; the protocol documents these defaults. */
  limits?: Partial<Record<'create' | 'resolve' | 'request' | 'discovery', number>>
  /** Test hook: pin the session identity so published protocol fixtures replay. */
  keys?: () => PairingSessionKeys
}

const DEFAULT_LIMITS = Object.freeze({ create: 5, resolve: 30, request: 120, discovery: 120 })

/** Decode a canonical 43 character base64url value holding exactly 32 bytes. */
export function decodeBase64UrlKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return null
  const raw = Buffer.from(value, 'base64url')
  if (raw.length !== 32 || raw.toString('base64url') !== value) return null
  return raw
}

export function encodeBase64UrlKey(raw: Buffer): string {
  return raw.toString('base64url')
}

function publicKeyObject(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
}

/** Fresh per-session X25519 keypair with the public half in wire encoding. */
export function generateSessionKeys(): PairingSessionKeys {
  const pair = generateKeyPairSync('x25519')
  const der = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }))
  return { privateKey: pair.privateKey, publicKey: encodeBase64UrlKey(der.subarray(-32)) }
}

/**
 * Reject identity keys that are not a usable X25519 public key: wrong length,
 * non canonical encoding, or a low order point (OpenSSL refuses to derive a
 * shared secret for those, which is exactly the check the protocol asks for).
 */
export function isValidIdentityKey(value: string): boolean {
  const raw = decodeBase64UrlKey(value)
  if (!raw) return false
  const ephemeral = generateKeyPairSync('x25519')
  try {
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyObject(raw) })
    return shared.length === 32 && !shared.every(byte => byte === 0)
  } catch { return false }
}

function sharedSecret(privateKey: KeyObject, identityKey: string): Buffer {
  const raw = decodeBase64UrlKey(identityKey)
  if (!raw) throw new ApiError('PAIRING_FORBIDDEN', 403)
  try {
    return diffieHellman({ privateKey, publicKey: publicKeyObject(raw) })
  } catch { throw new ApiError('PAIRING_FORBIDDEN', 403) }
}

function normalizeDevice(input: z.infer<typeof pairingDeviceSchema>): PairingDevice {
  return {
    deviceId: input.deviceId,
    name: input.name,
    role: input.role,
    platform: input.platform,
    identityKey: input.identityKey,
    clientVersion: input.clientVersion ?? null,
    harnessVersion: input.harnessVersion ?? null,
  }
}

function toStoreDescriptor(device: PairingDevice): AccountDeviceDescriptor {
  const parsed = accountDeviceDescriptorSchema.safeParse({
    deviceId: device.deviceId,
    name: device.name,
    role: device.role,
    platform: device.platform,
    identityKey: device.identityKey,
    // The stored descriptor always carries a concrete client version; the
    // credential echo keeps `harnessVersion` null when the peer did not send one.
    clientVersion: device.clientVersion ?? '0.0.0',
    ...(device.role === 'host' && device.harnessVersion ? { harnessVersion: device.harnessVersion } : {}),
  })
  if (!parsed.success) throw new ApiError('PAIRING_DEVICE_INVALID', 422)
  return parsed.data
}

function credentialDevice(device: PairingDevice): PairingDevice {
  return { ...device, clientVersion: device.clientVersion ?? '0.0.0' }
}

function failureCode(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'DEVICE_REVOKED':
      case 'PEER_IDENTITY_MISMATCH':
      case 'PAIRING_DEVICE_INVALID':
        return 'PAIRING_DEVICE_CONFLICT'
      case 'RATE_LIMITED':
        return 'HOST_DEVICE_LIMIT_REACHED'
      default:
        return error.code
    }
  }
  return 'INTERNAL_ERROR'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function readRequestBody(req: IncomingMessage): Promise<{ text: string; value: unknown }> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ApiError('INVALID_MESSAGE', 415)
  let length = 0, tooLarge = false
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    length += buffer.length
    // Keep draining oversized bodies so the 413 response is not truncated by a
    // reset, but stop buffering them and never hold more than the cap.
    if (length > MAX_PAIRING_BODY_BYTES) { tooLarge = true; chunks.length = 0; continue }
    chunks.push(buffer)
  }
  if (tooLarge) throw new ApiError('FRAME_TOO_LARGE', 413)
  const raw = Buffer.concat(chunks)
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw) } catch { throw new ApiError('INVALID_MESSAGE', 422) }
  let value: unknown
  try { value = parseWireJson(raw) } catch { throw new ApiError('INVALID_MESSAGE', 422) }
  return { text, value }
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiError('INVALID_MESSAGE', 422)
  return parsed.data
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export class PairingService {
  private readonly sessions = new Map<string, PairingSession>()
  private readonly store: Store
  private readonly rate: (key: string, max: number) => void
  private readonly limits: Record<'create' | 'resolve' | 'request' | 'discovery', number>
  private readonly sessionTtlMs: number
  private readonly now: () => number
  private readonly keys: (() => PairingSessionKeys) | undefined
  private readonly cleanupTimer: NodeJS.Timeout

  constructor(options: PairingServiceOptions) {
    this.store = options.store
    this.rate = options.rate
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    this.sessionTtlMs = options.sessionTtlMs ?? PAIRING_SESSION_TTL_MS
    this.now = options.now ?? (() => Date.now())
    this.keys = options.keys
    // Sessions keep their encrypted key material until the recovery window ends.
    this.cleanupTimer = setInterval(() => this.prune(), 60_000)
    this.cleanupTimer.unref()
  }

  close(): void {
    clearInterval(this.cleanupTimer)
    this.sessions.clear()
  }

  /**
   * Handle one pairing endpoint. Returns false when the path does not belong to
   * the pairing API so the caller can continue its own routing. Errors are
   * thrown as `ApiError` and rendered by the HTTP layer in the usual shape.
   */
  async handle(req: IncomingMessage, res: ServerResponse, path: string, client: string): Promise<boolean> {
    const method = req.method
    if (path === '/api/v1/auth/oauth/providers' || path === '/api/v1/device-pairing/capabilities') {
      if (method !== 'GET') return false
      this.rate(`pair-discovery:${client}`, this.limits.discovery)
      json(res, 200, { capabilities: { ...PAIRING_CAPABILITIES }, items: [] })
      return true
    }
    if (path === '/api/v1/device-pairing/sessions') {
      if (method !== 'POST') return false
      await this.create(req, res, client)
      return true
    }
    if (path === '/api/v1/device-pairing/resolve') {
      if (method !== 'POST') return false
      await this.resolve(req, res, client)
      return true
    }
    const match = SESSION_PATH.exec(path)
    if (!match || method !== 'POST') return false
    const sessionId = match[1]!
    const action = match[2]!
    const session = this.sessions.get(sessionId)
    if (!session) throw new ApiError('PAIRING_NOT_FOUND', 404)
    this.rate(`pair-request:${client}`, this.limits.request)
    switch (action) {
      case 'claim': await this.claim(req, res, path, session); break
      case 'host/status': await this.status(req, res, path, session, 'host'); break
      case 'mobile/status': await this.status(req, res, path, session, 'mobile'); break
      case 'host/confirm': await this.confirm(req, res, path, session); break
      case 'host/cancel': await this.cancel(req, res, path, session, 'host'); break
      case 'mobile/cancel': await this.cancel(req, res, path, session, 'mobile'); break
      default: return false
    }
    return true
  }

  // --- endpoints ---------------------------------------------------------

  private async create(req: IncomingMessage, res: ServerResponse, client: string): Promise<void> {
    this.rate(`pair-create:${client}`, this.limits.create)
    const { value } = await readRequestBody(req)
    const body = parseBody(createSessionSchema, value)
    if (body.device.role !== 'host') throw new ApiError('INVALID_MESSAGE', 422)
    if (!isValidIdentityKey(body.device.identityKey)) throw new ApiError('INVALID_MESSAGE', 422)
    this.prune()
    if (this.activeCount() >= MAX_ACTIVE_PAIRING_SESSIONS) throw new ApiError('PAIRING_BUSY', 429)
    const session = this.newSession(normalizeDevice(body.device))
    json(res, 200, this.createdResponse(session))
  }

  private async claim(req: IncomingMessage, res: ServerResponse, path: string, session: PairingSession): Promise<void> {
    const { text, value } = await readRequestBody(req)
    const body = parseBody(claimSchema, value)
    if (body.device.role !== 'client') throw new ApiError('INVALID_MESSAGE', 422)
    if (!isValidIdentityKey(body.device.identityKey)) throw new ApiError('INVALID_MESSAGE', 422)
    this.refreshLifecycle(session)
    this.assertRecoverable(session)
    if (session.state === 'expired') throw new ApiError('PAIRING_EXPIRED', 410)
    if (!equal(body.scanSecret, session.scanSecret)) throw new ApiError('PAIRING_SCAN_INVALID', 403)
    this.assertProof(req, session, 'mobile', path, text, body.device.identityKey)
    const proof = this.proofHeader(req)!
    if (session.state === 'claimed') {
      // Only the exact same request bytes may recover the code, and only while
      // the session is still awaiting the host's confirmation.
      if (session.claimBodyHash === sha256Hex(text) && session.claimProof === proof) {
        json(res, 200, { state: 'claimed', verificationCode: session.verificationCode, expiresAt: session.expiresAt })
        return
      }
      throw new ApiError('PAIRING_DEVICE_CONFLICT', 409)
    }
    if (session.state !== 'created') {
      if (session.state === 'failed' || session.state === 'cancelled' || session.state === 'completed') throw new ApiError('PAIRING_CLOSED', 409)
      throw new ApiError('PAIRING_CLOSED', 409)
    }
    if (body.device.deviceId === session.host.deviceId || body.device.identityKey === session.host.identityKey) {
      throw new ApiError('PAIRING_DEVICE_CONFLICT', 409)
    }
    session.mobile = normalizeDevice(body.device)
    session.state = 'claimed'
    session.verificationCode = String(randomInt(0, 100_000_000)).padStart(8, '0')
    session.claimBodyHash = sha256Hex(text)
    session.claimProof = proof
    session.lastTouchedAt = this.now()
    json(res, 200, { state: 'claimed', verificationCode: session.verificationCode, expiresAt: session.expiresAt })
  }

  private async status(req: IncomingMessage, res: ServerResponse, path: string, session: PairingSession, side: PairingSide): Promise<void> {
    const { text, value } = await readRequestBody(req)
    parseBody(noDataSchema, value)
    if (side === 'mobile' && !session.mobile) throw new ApiError('PAIRING_NOT_CLAIMED', 409)
    this.assertProof(req, session, side, path, text)
    this.refreshLifecycle(session)
    this.assertRecoverable(session)
    json(res, 200, this.statusResponse(session, side))
  }

  private async confirm(req: IncomingMessage, res: ServerResponse, path: string, session: PairingSession): Promise<void> {
    const { text, value } = await readRequestBody(req)
    const body = parseBody(confirmSchema, value)
    this.assertProof(req, session, 'host', path, text)
    this.refreshLifecycle(session)
    this.assertRecoverable(session)
    if (session.submissionId !== null) {
      // A repeat is only accepted for the frozen bytes of the first submission.
      if (session.submissionId !== body.submissionId || session.submissionBody !== text) throw new ApiError('PAIRING_ATTEMPT_USED', 409)
      if (session.state === 'approved') this.complete(session)
      json(res, 200, this.statusResponse(session, 'host'))
      return
    }
    if (session.state === 'expired') throw new ApiError('PAIRING_EXPIRED', 410)
    if (session.state !== 'claimed') {
      throw new ApiError(session.state === 'created' ? 'PAIRING_NOT_CLAIMED' : 'PAIRING_CLOSED', 409)
    }
    // The one and only attempt: persist the submission before comparing so a
    // crash, timeout or retry can never buy a second guess.
    session.submissionId = body.submissionId
    session.submissionBody = text
    session.attemptConsumed = true
    session.lastTouchedAt = this.now()
    if (!equal(body.verificationCode, session.verificationCode ?? '')) {
      session.verificationCode = null
      session.state = 'failed'
      session.failureReason = 'verification_failed'
      json(res, 200, this.statusResponse(session, 'host'))
      return
    }
    this.complete(session)
    json(res, 200, this.statusResponse(session, 'host'))
  }

  private async cancel(req: IncomingMessage, res: ServerResponse, path: string, session: PairingSession, side: PairingSide): Promise<void> {
    const { text, value } = await readRequestBody(req)
    parseBody(noDataSchema, value)
    if (side === 'mobile' && !session.mobile) throw new ApiError('PAIRING_NOT_CLAIMED', 409)
    this.assertProof(req, session, side, path, text)
    this.refreshLifecycle(session)
    this.assertRecoverable(session)
    if (session.state === 'created' || session.state === 'claimed' || session.state === 'approved') {
      session.state = 'cancelled'
      session.verificationCode = null
      session.credentials = null
      session.lastTouchedAt = this.now()
    }
    // Terminal sessions are never rewritten; repeated cancels observe the
    // current state instead of failing.
    json(res, 200, this.statusResponse(session, side))
  }

  private async resolve(req: IncomingMessage, res: ServerResponse, client: string): Promise<void> {
    this.rate(`pair-resolve:${client}`, this.limits.resolve)
    const { value } = await readRequestBody(req)
    const body = parseBody(resolveSchema, value)
    this.prune()
    for (const session of this.sessions.values()) {
      if (!equal(body.ticket, session.scanSecret)) continue
      this.refreshLifecycle(session)
      if (session.state !== 'created') throw new ApiError('PAIRING_NOT_FOUND', 404)
      json(res, 200, this.createdResponse(session))
      return
    }
    throw new ApiError('PAIRING_NOT_FOUND', 404)
  }

  // --- session lifecycle -------------------------------------------------

  private newSession(host: PairingDevice): PairingSession {
    const pair = this.keys ? this.keys() : generateSessionKeys()
    const now = this.now()
    const sessionId = pair.sessionId ?? randomUUID()
    const session: PairingSession = {
      sessionId,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      recoverUntil: now + this.sessionTtlMs + PAIRING_RECOVERY_MS,
      serverPrivateKey: pair.privateKey,
      serverPublicKey: pair.publicKey,
      scanSecret: randomBytes(32).toString('base64url'),
      host,
      mobile: null,
      state: 'created',
      failureReason: null,
      attemptConsumed: false,
      submissionId: null,
      submissionBody: null,
      verificationCode: null,
      claimBodyHash: null,
      claimProof: null,
      credentials: null,
      lastTouchedAt: now,
    }
    this.sessions.set(sessionId, session)
    return session
  }

  private createdResponse(session: PairingSession): PairingCreatedResponse {
    return {
      v: PAIRING_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      serverPublicKey: session.serverPublicKey,
      scanSecret: session.scanSecret,
      host: session.host,
    }
  }

  private statusResponse(session: PairingSession, side: PairingSide): PairingStatusResponse {
    this.refreshLifecycle(session)
    return {
      v: PAIRING_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      state: session.state,
      expiresAt: session.expiresAt,
      recoverUntil: session.recoverUntil,
      failureReason: session.failureReason,
      attemptConsumed: session.attemptConsumed,
      // The submission id is host-only state; a phone must never see it.
      submissionId: side === 'host' ? session.submissionId : null,
      host: session.host,
      mobile: session.mobile,
      credentials: session.state === 'completed' && session.credentials ? session.credentials[side] : null,
    }
  }

  /** Move an abandoned active session to `expired` once its lifetime is over. */
  private refreshLifecycle(session: PairingSession): void {
    if (session.state !== 'created' && session.state !== 'claimed' && session.state !== 'approved') return
    if (this.now() < session.expiresAt) return
    session.state = 'expired'
    session.verificationCode = null
    session.submissionBody = null
    session.credentials = null
  }

  private assertRecoverable(session: PairingSession): void {
    if (this.now() > session.recoverUntil) {
      this.sessions.delete(session.sessionId)
      throw new ApiError('PAIRING_NOT_FOUND', 404)
    }
  }

  private activeCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      this.refreshLifecycle(session)
      if (session.state !== 'failed' && session.state !== 'cancelled' && session.state !== 'expired') count++
    }
    return count
  }

  private prune(): void {
    const now = this.now()
    for (const [id, session] of this.sessions) if (now > session.recoverUntil) this.sessions.delete(id)
  }

  /**
   * Register both devices and issue both credentials as one transaction. On any
   * failure the session ends `failed` with a stable reason and no token is left
   * behind (the store commits its state atomically).
   */
  private complete(session: PairingSession): void {
    const mobile = session.mobile
    if (!mobile) {
      session.state = 'failed'
      session.failureReason = 'PAIRING_NOT_CLAIMED'
      return
    }
    session.state = 'approved'
    session.verificationCode = null
    try {
      const hostDescriptor = toStoreDescriptor(session.host)
      const mobileDescriptor = toStoreDescriptor(mobile)
      const [hostTokens, mobileTokens] = this.store.registerPairing([hostDescriptor, mobileDescriptor])
      if (!hostTokens || !mobileTokens) throw new ApiError('INTERNAL_ERROR', 500)
      const account = `dsh-device:${randomUUID()}`
      session.credentials = {
        host: {
          account, accountKind: 'device_only', device: credentialDevice(session.host),
          inboundOnly: true, pairingRestricted: true, tokens: hostTokens,
        },
        mobile: {
          account, accountKind: 'device_only', device: credentialDevice(mobile),
          inboundOnly: false, pairingRestricted: true, tokens: mobileTokens,
        },
      }
      session.state = 'completed'
      session.failureReason = null
      session.lastTouchedAt = this.now()
    } catch (error) {
      session.state = 'failed'
      session.failureReason = failureCode(error)
      session.credentials = null
    }
  }

  // --- proof -------------------------------------------------------------

  private proofHeader(req: IncomingMessage): string | null {
    const header = req.headers['x-dsh-pairing-proof']
    if (typeof header !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(header)) return null
    return header
  }

  /**
   * proofKey = HKDF-SHA256(X25519(server private key, device identity key),
   * salt = sessionId, info = "dsh-pairing-v1/<side>") and the MAC covers the
   * exact request path plus the SHA-256 of the exact request bytes.
   */
  private assertProof(req: IncomingMessage, session: PairingSession, side: PairingSide, path: string, bodyText: string, identityKey?: string): void {
    const header = this.proofHeader(req)
    if (!header) throw new ApiError('PAIRING_FORBIDDEN', 403)
    const deviceIdentity = identityKey ?? (side === 'host' ? session.host.identityKey : session.mobile?.identityKey)
    if (!deviceIdentity) throw new ApiError('PAIRING_FORBIDDEN', 403)
    let expected: Buffer
    try {
      const shared = sharedSecret(session.serverPrivateKey, deviceIdentity)
      const proofKey = Buffer.from(hkdfSync('sha256', shared, Buffer.from(session.sessionId, 'utf8'), Buffer.from(`dsh-pairing-v1/${side}`, 'utf8'), 32))
      expected = createHmac('sha256', proofKey).update(`POST\n${path}\n${sha256Hex(bodyText)}`, 'utf8').digest()
    } catch {
      throw new ApiError('PAIRING_FORBIDDEN', 403)
    }
    const provided = Buffer.from(header, 'base64url')
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new ApiError('PAIRING_FORBIDDEN', 403)
  }
}

/** Guidance page served by `GET /pair` (the QR fragment is never parsed here). */
export const PAIRING_GUIDE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>DSH 设备配对</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #0b1220; color: #e6edf7; }
  main { max-width: 30rem; margin: 0 auto; padding: 3rem 1.5rem; line-height: 1.6; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { margin: 0 0 .75rem; color: #b6c2d4; }
  code { background: #16213a; padding: .1rem .35rem; border-radius: .25rem; }
</style>
</head>
<body>
<main>
  <h1>请在 DSH Go 应用内完成配对</h1>
  <p>当前页面是由电脑端 DeepSeek Harness 生成的配对地址。二维码内容只包含一个配对票据，手机必须在 DSH Go 应用里扫码，本页面不会绑定设备。</p>
  <p>如果二维码已过期（创建后 180 秒），请在电脑上重新生成。</p>
  <p>配对链接形如 <code>/pair#v1.&lt;ticket&gt;</code>，票据不会发送到本页面。</p>
</main>
</body>
</html>
`
