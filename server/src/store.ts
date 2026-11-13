import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  accountDeviceDescriptorSchema,
  type AccountDeviceDescriptor,
  type DeviceTokenPair,
} from './protocol/index.js'
import { z } from 'zod'

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
export const secret = (): string => randomBytes(32).toString('base64url')
export const equal = (left: string, right: string): boolean => timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)))
const tokenSchema = z.object({
  kind: z.enum(['access', 'refresh']), deviceId: z.string(), expires: z.number(), used: z.boolean(),
  recovery: z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), accessExpires: z.number().int().positive() }).optional(),
})
const savedDeviceSchema = z.object({ descriptor: accountDeviceDescriptorSchema, revoked: z.boolean(), lastSeenAt: z.number() })
/**
 * `pairs` records the host/client link created by a successful device pairing.
 * Unbinding one side has to reach the other side, and the pairing session is
 * long gone by then, so the relation needs to live on disk.
 */
const pairSchema = z.tuple([z.string(), z.string()])
const stateSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  salt: z.string(),
  verifier: z.string(),
  devices: z.record(z.string(), savedDeviceSchema),
  tokens: z.record(z.string(), tokenSchema),
  // Added after the first release: absent in older state files.
  pairs: pairSchema.array().default([]),
})
type SavedDevice = z.infer<typeof savedDeviceSchema>
type SavedToken = z.infer<typeof tokenSchema>
type StoreState = z.infer<typeof stateSchema>

// Domain-separated HMACs keyed by the presented bearer, NOT its stored digest.
// The nonce alone cannot recover credentials from a copy of state.json.
function successor(token: string, nonce: string, deviceId: string) {
  const derive = (kind: string) => createHmac('sha256', token)
    .update(JSON.stringify(['ds-harness-remote/refresh/v1', deviceId, nonce, kind])).digest('base64url')
  return { accessToken: derive('access'), refreshToken: derive('refresh') }
}

/**
 * Mint a bearer pair into `state.tokens` without touching disk, so callers can
 * commit several devices as one atomic state swap (see `registerPairing`).
 */
function issueTokensInto(
  state: StoreState,
  deviceId: string,
  refreshTokenExpiresAt = Date.now() + 30 * 86400_000,
  previous?: { token: string; record: SavedToken },
): DeviceTokenPair {
  const tokens = { ...state.tokens }
  for (const [key, value] of Object.entries(tokens)) if (value.expires <= Date.now()) delete tokens[key]
  if (Object.keys(tokens).length + 2 > 16384) throw new ApiError('RATE_LIMITED', 429)
  const accessTokenExpiresAt = Date.now() + 60 * 60_000
  const nonce = secret()
  const { accessToken, refreshToken } = previous
    ? successor(previous.token, nonce, deviceId)
    : { accessToken: secret(), refreshToken: secret() }
  if (previous) tokens[hash(previous.token)] = {
    ...previous.record, used: true, recovery: { nonce, accessExpires: accessTokenExpiresAt },
  }
  tokens[hash(accessToken)] = { kind: 'access', deviceId, expires: accessTokenExpiresAt, used: false }
  tokens[hash(refreshToken)] = { kind: 'refresh', deviceId, expires: refreshTokenExpiresAt, used: false }
  state.tokens = tokens
  return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
}

/** Single-process store. Only token digests and public identities reach disk. */
export class Store {
  private state: StoreState
  /** `reason` is the disconnect code surfaced to the peer's control connection. */
  onInvalidate: (id: string, reason: string) => void = () => {}
  constructor(private readonly file: string, readonly account: string, password: string) {
    const previous = existsSync(file) ? stateSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : undefined
    const salt = previous?.salt ?? secret()
    const verifier = scryptSync(password, salt, 32).toString('hex')
    this.state = previous ?? { version: 1, account, salt, verifier, devices: {}, tokens: {}, pairs: [] }
    if (this.state.account !== account) {
      this.state.devices = {}
      this.state.pairs = []
    }
    if (this.state.account !== account || !equal(this.state.verifier, verifier)) this.state.tokens = {}
    Object.assign(this.state, { account, verifier })
    this.save()
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
  get(id: string): SavedDevice {
    const d = Object.hasOwn(this.state.devices, id) ? this.state.devices[id] : undefined
    if (!d) throw new ApiError('DEVICE_NOT_FOUND', 404)
    if (d.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    return d
  }
  list(): SavedDevice[] { return Object.values(this.state.devices).filter(d => !d.revoked) }
  register(descriptor: AccountDeviceDescriptor): DeviceTokenPair {
    this.reserveDevice(this.state, descriptor)
    this.invalidate(descriptor.deviceId, 'AUTH_INVALID')
    return this.issue(descriptor.deviceId)
  }
  /**
   * Claim a device slot in `state`, rejecting revoked slots, identity changes and
   * overflow. Shared by `register` and the pairing transaction.
   */
  private reserveDevice(state: StoreState, descriptor: AccountDeviceDescriptor): void {
    const old = state.devices[descriptor.deviceId]
    // A revoked slot may be claimed again by the SAME identity: revocation ends
    // the authorization, not the device identity, and re-pairing proves the key.
    if (old && (old.descriptor.identityKey !== descriptor.identityKey || old.descriptor.role !== descriptor.role)) throw new ApiError('PEER_IDENTITY_MISMATCH', 409)
    if (!old && Object.keys(state.devices).length >= 256) throw new ApiError('RATE_LIMITED', 429)
    state.devices[descriptor.deviceId] = { descriptor, revoked: false, lastSeenAt: old?.lastSeenAt ?? 0 }
  }
  /**
   * Register several devices as one transaction: either every descriptor is
   * accepted and every token pair is minted and persisted, or nothing changes.
   * Device pairing needs this so a half-issued credential can never be observed.
   */
  registerPairing(descriptors: readonly AccountDeviceDescriptor[], pair?: readonly [string, string]): DeviceTokenPair[] {
    if (descriptors.length === 0) return []
    const previous = this.state
    const draft = structuredClone(previous)
    const tokens: DeviceTokenPair[] = []
    try {
      for (const descriptor of descriptors) {
        this.reserveDevice(draft, descriptor)
        for (const [key, value] of Object.entries(draft.tokens)) if (value.deviceId === descriptor.deviceId) delete draft.tokens[key]
        tokens.push(issueTokensInto(draft, descriptor.deviceId))
      }
      if (pair) {
        // Every device belongs to at most one active pair: the newest pairing
        // supersedes an older link for either end.
        const [hostId, clientId] = pair
        draft.pairs = draft.pairs.filter(([h, c]) => h !== hostId && c !== clientId && h !== clientId && c !== hostId)
        draft.pairs.push([hostId, clientId])
      }
      this.state = draft
      this.save()
    } catch (error) {
      this.state = previous
      throw error
    }
    for (const descriptor of descriptors) this.onInvalidate(descriptor.deviceId, 'AUTH_INVALID')
    return tokens
  }

  /** Devices paired with `id` (the opposite side of a device pairing). */
  peersOf(id: string): string[] {
    const peers: string[] = []
    for (const [hostId, clientId] of this.state.pairs) {
      const peer = hostId === id ? clientId : clientId === id ? hostId : undefined
      // Tokens and links can outlive a device slot (account change, manual
      // cleanup); only revoke peers that still have a record.
      if (peer !== undefined && peer !== id && Object.hasOwn(this.state.devices, peer)) peers.push(peer)
    }
    return peers
  }
  private issue(deviceId: string, refreshTokenExpiresAt = Date.now() + 30 * 86400_000, previous?: { token: string; record: SavedToken }): DeviceTokenPair {
    const before = this.state.tokens
    const tokens = issueTokensInto(this.state, deviceId, refreshTokenExpiresAt, previous)
    // Commit consumption, recovery metadata and the successor together. A failed
    // write must leave the previous token usable both in memory and after restart.
    try { this.save() } catch (error) { this.state.tokens = before; throw error }
    return tokens
  }
  authenticate(token: string): SavedDevice {
    const record = this.state.tokens[hash(token)]
    if (!record || record.kind !== 'access') throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    return this.get(record.deviceId)
  }
  refresh(deviceId: string, token: string) {
    this.get(deviceId)
    const record = this.state.tokens[hash(token)]
    if (!record || record.kind !== 'refresh' || record.deviceId !== deviceId) throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    if (!record.used) return this.issue(deviceId, record.expires, { token, record })
    // Legacy consumed tokens have no recovery record. Reject them without
    // invalidating credentials that may already be in use by this device.
    if (!record.recovery) throw new ApiError('AUTH_INVALID', 401)
    const pair = successor(token, record.recovery.nonce, deviceId)
    const next = this.state.tokens[hash(pair.refreshToken)]
    if (!next || next.kind !== 'refresh' || next.deviceId !== deviceId || next.expires !== record.expires) {
      throw new ApiError('INTERNAL_ERROR', 503)
    }
    if (next.used) throw new ApiError('AUTH_INVALID', 401)
    const access = this.state.tokens[hash(pair.accessToken)]
    if (access ? access.kind !== 'access' || access.deviceId !== deviceId || access.expires !== record.recovery.accessExpires
      : record.recovery.accessExpires > Date.now()) throw new ApiError('INTERNAL_ERROR', 503)
    // Return the original expiry, including an expired access bearer. The
    // recovered, still-valid refresh token can then rotate normally.
    return { ...pair, accessTokenExpiresAt: record.recovery.accessExpires, refreshTokenExpiresAt: next.expires }
  }
  invalidate(deviceId: string, reason = 'AUTH_INVALID'): void {
    for (const [key, value] of Object.entries(this.state.tokens)) if (value.deviceId === deviceId) delete this.state.tokens[key]
    this.onInvalidate(deviceId, reason)
    this.save()
  }
  /**
   * Revoke a device: the slot keeps its (now dead) token records on purpose.
   * A revoked device that tries again must be told `DEVICE_REVOKED`, not
   * `AUTH_INVALID` — the Host only clears its local authorization on the
   * former, so dropping the tokens here would silence the revocation.
   */
  revoke(id: string, reason = 'DEVICE_REVOKED'): void {
    this.get(id).revoked = true
    this.onInvalidate(id, reason)
    this.save()
  }
  rename(id: string, name: string): void {
    this.get(id).descriptor.name = name
    this.save()
  }
  touch(id: string, clientVersion?: string, harnessVersion?: string): void {
    const d = this.get(id)
    d.lastSeenAt = Date.now()
    if (clientVersion) d.descriptor.clientVersion = clientVersion.slice(0, 64)
    if (d.descriptor.role === 'host' && harnessVersion) d.descriptor.harnessVersion = harnessVersion.slice(0, 64)
    this.save()
  }
}
