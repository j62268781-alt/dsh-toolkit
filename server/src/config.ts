/**
 * Gateway timing configuration: one normalization path for every entry point.
 *
 * Both the CLI (`main.ts` / `server.ts` parsing env vars) and programmatic
 * construction (`new Gateway(...)`, `createRemoteServer({ ... })`) must funnel
 * through these helpers. A raw `NaN`, `Infinity`, negative or absurdly large
 * value reaching `setTimeout`/`setInterval` is silently coerced by Node into
 * 1ms, which turns a misconfiguration into a connection storm, so every value
 * is range-checked and replaced with a documented fallback.
 */

export interface GatewayTimingOptions {
  helloTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatDisconnectMs?: number
  forceTerminateGraceMs?: number
}

export type NormalizedGatewayOptions = Required<GatewayTimingOptions>

export const HELLO_TIMEOUT_MS_RANGE = { min: 1000, max: 60_000, fallback: 5000 } as const
export const HEARTBEAT_INTERVAL_MS_RANGE = { min: 5000, max: 120_000, fallback: 25_000 } as const
export const FORCE_TERMINATE_GRACE_MS_RANGE = { min: 100, max: 10_000, fallback: 1000 } as const
export const MAX_FRAMES_PER_SEC_RANGE = { min: 64, max: 65_536, fallback: 512 } as const
/**
 * Bytes allowed to queue in one peer's socket before it is treated as gone
 * (`SLOW_CONSUMER`). Frames are up to 1 MiB, so a short stall on a cellular
 * downlink used to fill the hardcoded 4 MiB in a couple of seconds and close
 * the socket, turning a hiccup into a full reconnect. A genuinely dead peer is
 * still caught by the heartbeat. The upper bound keeps worst-case memory at
 * 64 MiB per connection.
 */
export const SLOW_CONSUMER_BYTES_RANGE = { min: 1024 * 1024, max: 64 * 1024 * 1024, fallback: 16 * 1024 * 1024 } as const
/** A heartbeat disconnect threshold below two intervals drops healthy peers. */
export const HEARTBEAT_DISCONNECT_MS_MIN_FACTOR = 2
export const HEARTBEAT_DISCONNECT_MS_MAX = 600_000
export const HEARTBEAT_DISCONNECT_MS_FLOOR = 75_000
export const HEARTBEAT_DISCONNECT_MS_FACTOR = 3

type Range = { readonly min: number; readonly max: number; readonly fallback: number }

/**
 * Coerce one timing value. Accepts numbers and numeric strings (env vars), and
 * rejects everything that is not a finite integer inside [min, max].
 */
function normalizeMs(value: unknown, range: Range, label: string): number {
  if (value === undefined || value === null) return range.fallback
  let candidate = Number.NaN
  try {
    if (typeof value === 'number') candidate = value
    else if (typeof value === 'string' && value.trim() !== '') candidate = Number(value)
  } catch {
    candidate = Number.NaN
  }
  if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < range.min || candidate > range.max) {
    // Never echo the offending input: it can be copy/pasted text that would
    // otherwise be injected into logs verbatim.
    console.warn(`[config] Invalid ${label}. Must be an integer between ${range.min} and ${range.max}. Falling back to ${range.fallback}.`)
    return range.fallback
  }
  return candidate
}

export function normalizeHelloTimeoutMs(value: unknown): number {
  return normalizeMs(value, HELLO_TIMEOUT_MS_RANGE, 'DSH_SERVER_HELLO_TIMEOUT_MS')
}

export function normalizeHeartbeatIntervalMs(value: unknown): number {
  return normalizeMs(value, HEARTBEAT_INTERVAL_MS_RANGE, 'DSH_SERVER_HEARTBEAT_INTERVAL_MS')
}

/** Fallback scales with the interval so a slower heartbeat still tolerates two missed rounds. */
export function heartbeatDisconnectFallback(heartbeatIntervalMs: number): number {
  return Math.min(
    HEARTBEAT_DISCONNECT_MS_MAX,
    Math.max(HEARTBEAT_DISCONNECT_MS_FLOOR, heartbeatIntervalMs * HEARTBEAT_DISCONNECT_MS_FACTOR),
  )
}

export function normalizeHeartbeatDisconnectMs(value: unknown, heartbeatIntervalMs: number): number {
  const min = heartbeatIntervalMs * HEARTBEAT_DISCONNECT_MS_MIN_FACTOR
  const fallback = heartbeatDisconnectFallback(heartbeatIntervalMs)
  if (value === undefined || value === null) return fallback
  let candidate = Number.NaN
  try {
    if (typeof value === 'number') candidate = value
    else if (typeof value === 'string' && value.trim() !== '') candidate = Number(value)
  } catch {
    candidate = Number.NaN
  }
  if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < min || candidate > HEARTBEAT_DISCONNECT_MS_MAX) {
    console.warn(
      `[config] Invalid DSH_SERVER_HEARTBEAT_DISCONNECT_MS. Must be an integer between ${min} and ${HEARTBEAT_DISCONNECT_MS_MAX} (at least ${HEARTBEAT_DISCONNECT_MS_MIN_FACTOR}x the heartbeat interval). Falling back to ${fallback}.`,
    )
    return fallback
  }
  return candidate
}

export function normalizeForceTerminateGraceMs(value: unknown): number {
  return normalizeMs(value, FORCE_TERMINATE_GRACE_MS_RANGE, 'DSH_SERVER_FORCE_TERMINATE_GRACE_MS')
}

export function normalizeMaxFramesPerSec(value: unknown): number {
  return normalizeMs(value, MAX_FRAMES_PER_SEC_RANGE, 'DSH_SERVER_MAX_FRAMES_PER_SEC')
}

/**
 * `normalizeMs` is a generic "finite integer inside [min, max]" check; the unit
 * only lives in the range constant and the warning label, so it also covers the
 * byte-valued setting below.
 */
export function normalizeSlowConsumerBytes(value: unknown): number {
  return normalizeMs(value, SLOW_CONSUMER_BYTES_RANGE, 'DSH_SERVER_SLOW_CONSUMER_BYTES')
}

/**
 * Single normalization point shared by the Gateway constructor and
 * `createRemoteServer`, so no caller can inject an unsafe timer value.
 */
export function normalizeGatewayOptions(options?: GatewayTimingOptions | null): NormalizedGatewayOptions {
  const source: GatewayTimingOptions = options ?? {}
  const heartbeatIntervalMs = normalizeHeartbeatIntervalMs(source.heartbeatIntervalMs)
  return {
    helloTimeoutMs: normalizeHelloTimeoutMs(source.helloTimeoutMs),
    heartbeatIntervalMs,
    heartbeatDisconnectMs: normalizeHeartbeatDisconnectMs(source.heartbeatDisconnectMs, heartbeatIntervalMs),
    forceTerminateGraceMs: normalizeForceTerminateGraceMs(source.forceTerminateGraceMs),
  }
}

/**
 * Transport capabilities a peer may negotiate. `relay` is mandatory: the
 * protocol requires every connection to offer it, and dropping it would make
 * `hello.ack` negotiation fail for clients that insist on it.
 *
 * Operators disable direct transports to make phones skip ICE entirely: a
 * phone that keeps trying P2P/TURN on a network where neither can work spends
 * two full WebRTC deadlines (12s each, `webrtcFallbackTimeoutMs`) before it
 * falls back to the relay it will end up using anyway.
 */
export const TRANSPORT_NAMES = ['lan', 'p2p', 'turn', 'relay'] as const
export type TransportName = (typeof TRANSPORT_NAMES)[number]
/**
 * Shipped default: LAN (same Wi-Fi) plus the relay. `p2p` and `turn` are opt-in
 * because hole punching fails on most carrier networks (CGNAT) and TURN needs a
 * server of one's own; advertising them only costs the peer two 12s WebRTC
 * deadlines per connection attempt.
 *
 *   DSH_SERVER_TRANSPORTS=lan,p2p,relay   both ends have public IPv6
 *   DSH_SERVER_TRANSPORTS=lan,turn,relay  you run your own TURN server
 */
export const DEFAULT_TRANSPORTS: readonly TransportName[] = ['lan', 'relay']

function isTransportName(value: string): value is TransportName {
  return (TRANSPORT_NAMES as readonly string[]).includes(value)
}

/**
 * Parse `DSH_SERVER_TRANSPORTS` / programmatic `transports`. Empty or absent
 * means all four; unknown entries are dropped (never echoed: the value can be
 * copy/pasted text) and `relay` is appended when an operator leaves it out.
 */
export function normalizeTransports(value: unknown): TransportName[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const names: TransportName[] = []
  let unknown = false
  for (const item of items) {
    if (typeof item !== 'string') continue
    const name = item.trim().toLowerCase()
    if (name === '') continue
    if (!isTransportName(name)) {
      unknown = true
      continue
    }
    if (!names.includes(name)) names.push(name)
  }
  if (unknown) console.warn('[config] Ignoring unknown entry in DSH_SERVER_TRANSPORTS. Valid names: lan, p2p, turn, relay.')
  if (names.length === 0) return [...DEFAULT_TRANSPORTS]
  if (!names.includes('relay')) names.push('relay')
  return names
}

const LOCAL_ATTENTION_WEBHOOK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Validate the optional target without echoing a URL that may contain secrets. */
export function parseAttentionWebhookUrl(value: unknown): URL | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error('Invalid DSH_SERVER_ATTENTION_WEBHOOK_URL: expected a URL string.')
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid DSH_SERVER_ATTENTION_WEBHOOK_URL: malformed URL.')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Invalid DSH_SERVER_ATTENTION_WEBHOOK_URL: embedded credentials are not allowed.')
  }
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:' && LOCAL_ATTENTION_WEBHOOK_HOSTS.has(parsed.hostname)) return parsed
  throw new Error(
    'Invalid DSH_SERVER_ATTENTION_WEBHOOK_URL: must use https: (or http://127.0.0.1, http://localhost, or http://[::1]).',
  )
}
