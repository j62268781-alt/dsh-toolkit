import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHmac } from 'node:crypto'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { request as httpRequest } from 'node:http'
import { WebSocket } from 'ws'
import { MAX_CONTROL_FRAME_BYTES, createControlFrame } from '../src/protocol/index.js'
import {
  createRemoteServer,
  normalizeGatewayOptions,
  normalizeMaxFramesPerSec,
  normalizeIp,
  normalizeTrustedProxyIps,
  parseHelloTimeout,
  parseHeartbeatInterval,
  parseHeartbeatDisconnect,
  parseMaxFramesPerSec,
  type Config,
} from '../src/server.js'
import { Logger, redactSensitive, parseLogLevel, type LogEntry } from '../src/logger.js'
import { MAX_ICE_CANDIDATES_PER_CONNECTION } from '../src/gateway.js'
import { parseIceConfig } from '../src/ice.js'
import { deviceKeys } from './pairing-helpers.js'

/**
 * Server level port of the upstream `apps/server/tests/server.test.ts` suite.
 *
 * The upstream file also exercises the client stack (Noise IK, the WebRTC data
 * channel and the Plugin's HTTP client) through `packages/{crypto,webrtc,plugin}`.
 * Those packages are not vendored here: this standalone server only depends on
 * `ws` and `zod`, so the scenarios that require the client stack (real Noise
 * ciphertext relay, tamper/replay of the secure channel, the Plugin credential
 * recovery flow) are covered by the raw HTTP/WebSocket level equivalents below.
 * Everything that only needs the control plane is preserved verbatim.
 */

const account = 'owner@example.com'
const password = 'local-test-password'
let app: ReturnType<typeof createRemoteServer>, dir: string, base: string, accountToken: string
const sockets: WebSocket[] = []

async function request(path: string, method = 'GET', body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, data: await response.json() as any, headers: response.headers }
}

async function rawJsonRequest(path: string, body: string | Uint8Array, token?: string) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  })
  return { status: response.status, data: await response.json() as any }
}

async function start(pass = password, trustedProxyIps: readonly string[] = [], configOverrides: Partial<Config> = {}) {
  app = createRemoteServer({ account, password: pass, dataFile: join(dir, 'state.json'), publicUrl: 'http://localhost:8080', trustedProxyIps, ...configOverrides })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
}

/** Send a raw HTTP/1.1 request so duplicate header lines stay separate (fetch merges them). */
async function rawStatus(headerLines: string[]): Promise<number> {
  const port = (app.server.address() as { port: number }).port
  const crlf = String.fromCharCode(13, 10)
  const lines = ['GET /api/v1/auth/me HTTP/1.1', `Host: 127.0.0.1:${port}`, ...headerLines, 'Connection: close', '', '']
  return await new Promise<number>((resolve, reject) => {
    const socket = createConnection(port, '127.0.0.1')
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('raw request timed out')) }, 5000)
    let buffer = ''
    socket.on('connect', () => socket.write(lines.join(crlf)))
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const match = /^HTTP[/]1[.][01] ([0-9]{3})/.exec(buffer)
      if (!match) return
      clearTimeout(timer); socket.destroy(); resolve(Number(match[1]))
    })
    socket.on('error', error => { clearTimeout(timer); reject(error) })
  })
}

async function device(role: 'host' | 'client' = 'client') {
  const keys = deviceKeys()
  const descriptor = { deviceId: randomUUID(), identityKey: keys.identityKey, name: 'test-device', role, platform: 'linux', clientVersion: '0.4.15' }
  const result = await request('/devices/register', 'POST', { v: 1, device: descriptor }, accountToken)
  expect(result.status).toBe(200)
  return { ...descriptor, keys, ...result.data }
}

class Wire {
  messages: any[] = []
  waiters: (() => void)[] = []
  constructor(readonly ws: WebSocket) {
    ws.on('message', raw => {
      this.messages.push(JSON.parse(raw.toString()))
      for (const notify of this.waiters.splice(0)) notify()
    })
  }
  send(type: Parameters<typeof createControlFrame>[0], payload: unknown) {
    this.ws.send(JSON.stringify(createControlFrame(type, payload)))
  }
  async next(type: string): Promise<any> {
    const until = Date.now() + 3000
    while (Date.now() < until) {
      const idx = this.messages.findIndex(m => m.type === type)
      if (idx >= 0) return this.messages.splice(idx, 1)[0].payload
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 50)
        this.waiters.push(() => { clearTimeout(timer); resolve() })
      })
    }
    throw new Error(`Missing frame ${type}`)
  }
}

const fullCapabilities = ['transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay']
const fullPreferredTransports = ['lan', 'p2p', 'turn', 'relay']

async function socket(d: Awaited<ReturnType<typeof device>>, overrides: Record<string, unknown> = {}) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
  sockets.push(ws)
  const wire = new Wire(ws)
  await once(ws, 'open')
  wire.send('hello', { role: d.role, deviceId: d.deviceId, accessToken: d.accessToken, protocols: [1], capabilities: fullCapabilities, clientVersion: d.clientVersion, ...overrides })
  return wire
}

async function connection(options: { hostCapabilities?: string[]; clientCapabilities?: string[]; preferredTransports?: string[] } = {}) {
  const h = await device('host'), c = await device()
  const host = await socket(h, options.hostCapabilities === undefined ? {} : { capabilities: options.hostCapabilities })
  const client = await socket(c, options.clientCapabilities === undefined ? {} : { capabilities: options.clientCapabilities })
  const ack = await host.next('hello.ack')
  expect(ack).toMatchObject({ webrtcEnabled: true })
  expect(ack.capabilities).toEqual(expect.arrayContaining(['transport.relay']))
  await client.next('hello.ack')
  client.send('connect.request', { hostDeviceId: h.deviceId, preferredTransports: options.preferredTransports ?? ['relay'] })
  const incoming = await host.next('connect.incoming')
  expect(incoming.clientIdentityKey).toBe(c.identityKey)
  host.send('connect.accepted', { connectionId: incoming.connectionId })
  const { connectionId } = await client.next('connect.accepted')
  return { h, c, host, client, connectionId, incoming }
}

const prepareScenario = async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-server-'))
  await start()
  accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
}

const cleanupScenario = async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  try { await app.close() } catch { /* a test may have closed it already */ }
  rmSync(dir, { recursive: true, force: true })
}

beforeEach(prepareScenario)
afterEach(cleanupScenario)

describe('account and device authorization', () => {
  it('rejects duplicate REST fields before authentication or state changes', async () => {
    const d = await device()
    const registration = JSON.stringify({ v: 1, device: {
      deviceId: randomUUID(), identityKey: deviceKeys().identityKey,
      name: 'new-device', role: 'client', platform: 'linux', clientVersion: '0.6.4',
    } })
    const cases: { path: string; body: string | Uint8Array; token?: string }[] = [
      { path: '/auth/login', body: JSON.stringify({ email: account, password }).replace('"password":', '"password":"wrong","password":') },
      { path: '/auth/login', body: JSON.stringify({ email: account, password }).replace('"password":', '"pass\\u0077ord":"wrong","password":') },
      { path: '/devices/register', body: registration.replace('"identityKey":', '"identityKey":"wrong","identityKey":'), token: accountToken },
      { path: '/auth/refresh', body: JSON.stringify({ deviceId: d.deviceId, refreshToken: d.refreshToken }).replace('"refreshToken":', '"refreshToken":"wrong","refreshToken":') },
      { path: `/devices/${d.deviceId}/name`, body: '{"name":"first","name":"second"}', token: accountToken },
      { path: '/auth/login', body: Uint8Array.from([0xc0, 0xaf]) },
    ]
    for (const entry of cases) {
      const result = await rawJsonRequest(entry.path, entry.body, entry.token)
      expect(result.status).toBe(400)
      expect(result.data.error.code).toBe('INVALID_MESSAGE')
    }
    const devices = await request('/account/devices', 'GET', undefined, accountToken)
    expect(devices.data.items).toHaveLength(1)
    expect(devices.data.items[0].name).toBe('test-device')
  })

  it('rejects a noncanonical registered X25519 public key', async () => {
    const keys = deviceKeys()
    const descriptor = {
      deviceId: randomUUID(), identityKey: `${keys.identityKey.slice(0, -1)}B`,
      name: 'invalid-key', role: 'client', platform: 'linux', clientVersion: '0.6.4',
    }
    const result = await request('/devices/register', 'POST', { v: 1, device: descriptor }, accountToken)
    expect(result.status).toBe(400)
    expect(result.data.error.code).toBe('INVALID_MESSAGE')
  })

  it('separates account, cookie and device credentials; rejects cross-origin requests', async () => {
    expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' })).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, { Origin: 'https://attacker.example' })).status).toBe(403)
    const d = await device()
    expect((await request('/auth/me', 'GET', undefined, d.accessToken)).status).toBe(401)
    expect((await request('/devices', 'GET', undefined, accountToken)).status).toBe(401)
    expect((await request('/devices/register', 'POST', { v: 1, device: d })).status).toBe(401)
    const login = await request('/auth/login', 'POST', { email: account, password })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    expect(login.headers.get('set-cookie')).toContain('HttpOnly')
    expect((await request('/account/devices', 'GET', undefined, undefined, { Cookie: cookie })).status).toBe(200)
    await request('/auth/logout', 'POST', {}, undefined, { Cookie: cookie })
    expect((await request('/auth/me', 'GET', undefined, login.data.token)).status).toBe(401)
  })

  it('pins identity and requires distinct opposite-role registration', async () => {
    const h = await device('host'), c = await device()
    const changed = { deviceId: h.deviceId, name: h.name, role: h.role, platform: h.platform, clientVersion: h.clientVersion, identityKey: c.identityKey }
    expect((await request('/devices/register', 'POST', { v: 1, device: changed }, accountToken)).data.error.code).toBe('PEER_IDENTITY_MISMATCH')
    expect((await request(`/devices/${h.deviceId}`, 'GET', undefined, c.accessToken)).data.identityKey).toBe(h.identityKey)
    expect((await request(`/devices/${c.deviceId}`, 'GET', undefined, c.accessToken)).status).toBe(403)
    const descriptor = { ...changed, deviceId: randomUUID() }
    expect((await request('/devices/register-owned-role', 'POST', { v: 1, device: descriptor }, h.accessToken)).status).toBe(409)
    expect((await request('/devices/register-owned-role', 'POST', { v: 1, device: descriptor }, c.accessToken)).status).toBe(200)
  })

  it('recovers a lost refresh response across restart without invalidating the successor', async () => {
    const d = await device()
    const saved = readFileSync(join(dir, 'state.json'), 'utf8')
    expect(saved).not.toContain(d.refreshToken); expect(saved).not.toContain(d.accessToken); expect(saved).not.toContain(password)
    await app.close(); await start()
    expect((await request('/devices', 'GET', undefined, d.accessToken)).status).toBe(200)
    // Discard the successful response body, as when the link drops after commit.
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(base + '/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        const status = res.statusCode
        res.destroy()
        if (status === 200) resolve()
        else reject(new Error('Expected successful rotation before response loss'))
      })
      req.on('error', reject)
      req.end(JSON.stringify({ deviceId: d.deviceId, refreshToken: d.refreshToken }))
    })
    await app.close(); await start()
    const rotated = await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })
    expect(rotated.status).toBe(200)
    expect(rotated.data.refreshTokenExpiresAt).toBe(d.refreshTokenExpiresAt)
    const retries = await Promise.all(Array.from({ length: 3 }, () => request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })))
    for (const retry of retries) { expect(retry.status).toBe(200); expect(retry.data).toEqual(rotated.data) }
    expect((await request('/devices', 'GET', undefined, rotated.data.accessToken)).status).toBe(200)
    const next = await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: rotated.data.refreshToken })
    expect(next.status).toBe(200)
    expect((await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })).status).toBe(401)
    expect((await request('/devices', 'GET', undefined, next.data.accessToken)).status).toBe(200)
    const persisted = readFileSync(join(dir, 'state.json'), 'utf8')
    for (const value of [d.accessToken, d.refreshToken, rotated.data.accessToken, rotated.data.refreshToken, next.data.refreshToken]) {
      expect(persisted).not.toContain(value)
    }
  })

  it('invalidates credentials when the configured password changes', async () => {
    const d = await device(); await app.close(); await start('a-different-password')
    expect((await request('/devices', 'GET', undefined, d.accessToken)).status).toBe(401)
    expect((await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })).status).toBe(401)
  })
})

describe('control authorization and relay routing', () => {
  it('rejects invalid Control messages at the WebSocket boundary', async () => {
    const reasons = ['unsupported-version', 'binary-control', 'oversized-control', 'unknown-frame-type', 'duplicate-payload-field', 'noncanonical-handshake'] as const
    for (const reason of reasons) {
      const wire = await socket(await device())
      await wire.next('hello.ack')
      const closed = once(wire.ws, 'close')
      const frame = {
        ...createControlFrame(
          reason === 'noncanonical-handshake' ? 'secure.handshake' : 'ping',
          reason === 'noncanonical-handshake'
            ? { connectionId: randomUUID(), targetDeviceId: randomUUID(), step: 1, data: 'AQIDBB' }
            : { nonce: reason === 'oversized-control' ? 'a'.repeat(MAX_CONTROL_FRAME_BYTES) : 'test' },
        ),
        ...(reason === 'unsupported-version' ? { v: 2 } : {}),
        ...(reason === 'unknown-frame-type' ? { type: 'unknown' } : {}),
      }
      const encoded = JSON.stringify(frame)
      wire.ws.send(
        reason === 'duplicate-payload-field' ? encoded.replace('"nonce":', '"nonce":"other","nonce":') : encoded,
        { binary: reason === 'binary-control' },
      )
      expect((await wire.next('error')).code).toBe(reason === 'unsupported-version' ? 'UNSUPPORTED_VERSION' : 'INVALID_MESSAGE')
      expect((await closed)[0]).toBe(4001)
    }
  })

  it('rejects unauthorized relay routes', async () => {
    for (const reason of ['wrong-target', 'third-device', 'unknown-connection', 'before-handshake'] as const) {
      const ctx = await connection()
      const attacker = reason === 'third-device' ? await socket(await device()) : ctx.client
      if (reason === 'third-device') await attacker.next('hello.ack')
      attacker.send('relay', {
        connectionId: reason === 'unknown-connection' ? randomUUID() : ctx.connectionId,
        targetDeviceId: reason === 'wrong-target' ? randomUUID() : ctx.h.deviceId,
        counter: 0,
        ciphertext: 'AQIDBA',
      })
      expect((await attacker.next('error')).code).toBe(reason === 'before-handshake' ? 'INVALID_MESSAGE' : 'CONNECTION_NOT_FOUND')
      ctx.host.send('ping', { nonce: 'route-check' })
      await ctx.host.next('pong')
      expect(ctx.host.messages.filter((m) => m.type === 'relay')).toHaveLength(0)
    }
  })

  it('rejects account tokens and mismatched device roles in hello', async () => {
    const d = await device()
    expect((await (await socket(d, { accessToken: accountToken })).next('error')).code).toBe('AUTH_INVALID')
    expect((await (await socket(d, { role: 'host' })).next('error')).code).toBe('AUTH_INVALID')
  })

  it('replaces a device socket without removing the new connection', async () => {
    const d = await device(), old = await socket(d); await old.next('hello.ack')
    const closed = once(old.ws, 'close'), current = await socket(d)
    await current.next('hello.ack'); expect((await closed)[0]).toBe(4003)
    current.send('ping', { nonce: 'new-socket' }); expect(await current.next('pong')).toEqual({ nonce: 'new-socket' })
  })

  it('keeps concurrent clients isolated and tears down revoked connections', async () => {
    const ctx = await connection(), second = await device(), wire = await socket(second); await wire.next('hello.ack')
    wire.send('connect.request', { hostDeviceId: ctx.h.deviceId, preferredTransports: ['relay'] })
    const incoming = await ctx.host.next('connect.incoming')
    ctx.host.send('connect.accepted', { connectionId: incoming.connectionId }); await wire.next('connect.accepted')
    expect(ctx.client.messages.filter(m => m.type === 'error')).toHaveLength(0)
    const closed = once(wire.ws, 'close')
    expect((await request('/devices/self', 'DELETE', undefined, second.accessToken)).status).toBe(200)
    await closed
    expect(await ctx.host.next('error')).toMatchObject({ connectionId: incoming.connectionId })
    // The revoked device keeps a dead token so it can be told why it is gone.
    expect((await request('/devices', 'GET', undefined, second.accessToken)).status).toBe(403)
  })
})

describe('webrtc signaling and TURN credentials', () => {
  const candidate = (index: number) => ({
    candidate: `candidate:${index} 1 udp 2122260223 192.0.2.1 ${50000 + index} typ host`,
    sdpMid: '0',
    sdpMLineIndex: 0,
  })

  it('advertises the negotiated WebRTC transports and only enables TURN when configured', async () => {
    const partial = await socket(await device(), { capabilities: ['transport.p2p', 'transport.relay'] })
    expect(await partial.next('hello.ack')).toMatchObject({
      capabilities: ['transport.p2p', 'transport.relay'],
      webrtcEnabled: true,
      webrtcFallbackTimeoutMs: 12_000,
    })
    const withoutTurn = await socket(await device(), { capabilities: fullCapabilities })
    expect(await withoutTurn.next('hello.ack')).toMatchObject({
      capabilities: ['transport.lan', 'transport.p2p', 'transport.relay'],
    })
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: ['stun:stun.example.test:3478'],
        turnUrls: ['turn:turn.example.test:3478?transport=udp'],
        turnSecret: 'test-turn-secret',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const withTurn = await socket(await device(), { capabilities: fullCapabilities })
    expect(await withTurn.next('hello.ack')).toMatchObject({ capabilities: fullCapabilities })
  })

  it('forwards ordered WebRTC signaling and transport selection', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('signal.offer', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, sdp: 'v=0 offer' })
    expect(await ctx.host.next('signal.offer')).toMatchObject({ connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId })
    ctx.host.send('signal.answer', { connectionId: ctx.connectionId, targetDeviceId: ctx.c.deviceId, sdp: 'v=0 answer' })
    expect(await ctx.client.next('signal.answer')).toMatchObject({ sdp: 'v=0 answer' })
    for (let index = 0; index < 3; index++) {
      ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(index) })
    }
    for (let index = 0; index < 3; index++) {
      expect((await ctx.host.next('signal.ice')).candidate).toEqual(candidate(index))
    }
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'lan' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'lan' })
  })

  it('downgrades LAN to P2P for a host that did not negotiate transport.lan', async () => {
    const ctx = await connection({ hostCapabilities: ['transport.p2p', 'transport.relay'], clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'lan' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'p2p' })
  })

  it('tolerates a responder transport selection without dropping the link', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'lan' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'lan' })
    // The Host (responder) also announces its own selection; it must be
    // ignored rather than treated as an invalid frame that drops the link.
    ctx.host.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.c.deviceId, transport: 'p2p' })
    ctx.client.send('ping', { nonce: 'responder-selection' })
    expect(await ctx.client.next('pong')).toEqual({ nonce: 'responder-selection' })
    expect(ctx.client.messages.filter(message => message.type === 'error')).toHaveLength(0)
  })

  it('does not forward signaling to a host that cannot use WebRTC', async () => {
    const ctx = await connection({ hostCapabilities: ['transport.relay'], clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('signal.offer', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, sdp: 'v=0 offer' })
    ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(0) })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(ctx.host.messages.filter(message => message.type === 'signal.offer' || message.type === 'signal.ice')).toHaveLength(0)
    // The link survives: the relay path is still available.
    ctx.client.send('ping', { nonce: 'relay-only-host' })
    expect(await ctx.client.next('pong')).toEqual({ nonce: 'relay-only-host' })
  })

  it('drops signaling on a relay-only link without closing the connection', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: ['relay'] })
    ctx.client.send('signal.offer', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, sdp: 'v=0 offer' })
    ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(0) })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(ctx.host.messages.filter(message => message.type === 'signal.offer' || message.type === 'signal.ice')).toHaveLength(0)
    expect(ctx.client.messages.filter(message => message.type === 'error')).toHaveLength(0)
    ctx.client.send('ping', { nonce: 'force-relay' })
    expect(await ctx.client.next('pong')).toEqual({ nonce: 'force-relay' })
  })

  it('narrows connect.incoming to the transports both peers support', async () => {
    const ctx = await connection({ hostCapabilities: ['transport.lan', 'transport.p2p', 'transport.relay'], clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    // The TURN transport is also absent because this test Server has no TURN
    // deployment configured, so the intersection cannot include it.
    expect(ctx.incoming.preferredTransports).toEqual(['lan', 'p2p', 'relay'])
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'turn' })
    expect((await ctx.client.next('error')).code).toBe('CAPABILITY_NOT_SUPPORTED')
  })

  it('enforces the per-connection ICE candidate limit', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    for (let index = 0; index < MAX_ICE_CANDIDATES_PER_CONNECTION; index++) {
      ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(index) })
    }
    ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(MAX_ICE_CANDIDATES_PER_CONNECTION) })
    expect((await ctx.client.next('error')).code).toBe('INVALID_MESSAGE')
  })

  it('issues short-lived STUN/TURN credentials only to connection participants', async () => {
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: ['stun:stun.example.test:3478'],
        turnUrls: ['turn:turn.example.test:3478?transport=udp'],
        turnSecret: 'test-turn-secret',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    // Negotiate TURN before selecting it; the diagnostic must survive forwarding.
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'turn', turnNode: 'turn.example.test:3478' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'turn', turnNode: 'turn.example.test:3478' })
    const before = Date.now()
    const result = await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.c.accessToken)
    expect(result.status).toBe(200)
    const [stun, turn] = result.data.iceServers as Array<{ urls: string; username?: string; credential?: string }>
    expect(stun).toEqual({ urls: 'stun:stun.example.test:3478' })
    const expiresAt = Number(String(turn!.username).split(':')[0])
    expect(expiresAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) + 120)
    expect(expiresAt).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 120)
    expect(turn!.credential).toBe(createHmac('sha1', 'test-turn-secret').update(turn!.username!).digest('base64'))
    expect((await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.h.accessToken)).status).toBe(200)

    const stranger = await device()
    expect((await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, stranger.accessToken)).status).toBe(404)
    expect((await request(`/turn/credentials?connection_id=${randomUUID()}`, 'GET', undefined, ctx.c.accessToken)).status).toBe(404)
    expect((await request('/turn/credentials', 'GET', undefined, ctx.c.accessToken)).status).toBe(400)
  })

  it('issues configured static TURN credentials', async () => {
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: [],
        turnUrls: ['turn:turn.example.test:3478'],
        turnSecret: undefined,
        turnUsername: 'remote',
        turnPassword: 'static-turn-password',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities })
    const result = await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.c.accessToken)
    expect(result.status).toBe(200)
    expect(result.data.iceServers).toEqual([{ urls: 'turn:turn.example.test:3478', username: 'remote', credential: 'static-turn-password' }])
  })

  it('rejects partial TURN credential configuration at startup', () => {
    expect(() => parseIceConfig({ DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478' })).toThrow(/DSH_SERVER_TURN_URLS requires/)
    expect(() => parseIceConfig({
      DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478',
      DSH_SERVER_TURN_SECRET: 'secret',
      DSH_SERVER_TURN_USERNAME: 'remote',
      DSH_SERVER_TURN_PASSWORD: 'password',
    })).toThrow(/not both/)
    expect(() => parseIceConfig({
      DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478',
      DSH_SERVER_TURN_USERNAME: 'remote',
    })).toThrow(/together/)
    expect(() => parseIceConfig({ DSH_SERVER_TURN_USERNAME: 'remote', DSH_SERVER_TURN_PASSWORD: 'password' })).toThrow(/DSH_SERVER_TURN_URLS is required/)
    expect(() => parseIceConfig({ DSH_SERVER_TURN_SECRET: 'secret' })).toThrow(/DSH_SERVER_TURN_URLS is required/)
    expect(parseIceConfig({
      DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478',
      DSH_SERVER_TURN_USERNAME: 'remote',
      DSH_SERVER_TURN_PASSWORD: 'password',
    })).toMatchObject({ turnUsername: 'remote', turnPassword: 'password', turnSecret: undefined })
  })

  it('does not issue TURN credentials before the host accepts the connection', async () => {
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: [],
        turnUrls: ['turn:turn.example.test:3478'],
        turnSecret: 'test-turn-secret',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const h = await device('host'), c = await device(), host = await socket(h), client = await socket(c)
    await host.next('hello.ack'); await client.next('hello.ack')
    client.send('connect.request', { hostDeviceId: h.deviceId, preferredTransports: ['relay'] })
    const incoming = await host.next('connect.incoming')
    expect((await request(`/turn/credentials?connection_id=${incoming.connectionId}`, 'GET', undefined, c.accessToken)).status).toBe(404)
  })
})

describe('reverse-proxy client IP rate limiting', () => {
  const trusted = ['127.0.0.1', '::ffff:127.0.0.1']
  const forwarded = (ip: string) => ({ 'x-forwarded-for': ip })
  const restart = async (ips: readonly string[] = trusted) => { await app.close(); await start(password, ips) }

  it('normalizes IPv4, IPv6 and IPv4-mapped IPv6 to one canonical form', () => {
    expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::ffff:7f00:1')).toBe('127.0.0.1')
    expect(normalizeIp('0:0:0:0:0:ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    expect([...normalizeTrustedProxyIps(['127.0.0.1', '::ffff:127.0.0.1', '2001:db8::2'])]).toEqual(['127.0.0.1', '2001:db8::2'])
    for (const invalid of ['', '10.0.0.0/8', '10.0.0.1:8080', '[::1]:8080', 'client.example.com', '1.2.3.4, 5.6.7.8', 'fe80::1%eth0']) {
      expect(normalizeIp(invalid)).toBeNull()
    }
  })

  it('rejects invalid trusted proxy IP lists at startup', () => {
    for (const invalid of ['10.0.0.0/8', 'proxy.example.com', '127.0.0.1:8080', '999.1.1.1', '::1/128', '']) {
      expect(() => createRemoteServer({ account, password, dataFile: join(dir, 'invalid.json'), publicUrl: 'http://localhost:8080', trustedProxyIps: [invalid] })).toThrow(/DSH_SERVER_TRUSTED_PROXY_IPS/)
    }
  })

  it('keeps client B working after client A exhausts the 20/min login limit', async () => {
    await restart()
    const A = forwarded('10.20.0.1'), B = forwarded('10.20.0.2')
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, B)).status).toBe(200)
    for (let i = 0; i < 20; i++) expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' }, undefined, A)).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, A)).status).toBe(429)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, B)).status).toBe(200)
  }, 15000)

  it('keeps client B working after client A exhausts the 240/min API limit', async () => {
    await restart()
    const A = forwarded('10.30.0.1'), B = forwarded('10.30.0.2')
    for (let i = 0; i < 240; i++) expect((await request('/auth/me', 'GET', undefined, undefined, A)).status).toBe(401)
    expect((await request('/auth/me', 'GET', undefined, undefined, A)).status).toBe(429)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, B)).status).toBe(200)
  }, 30000)

  it('ignores spoofed X-Forwarded-For from an untrusted peer and limits by socket IP', async () => {
    await restart([])
    for (let i = 0; i < 20; i++) expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' }, undefined, forwarded('10.40.0.1'))).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, forwarded('10.40.0.2'))).status).toBe(429)
    expect(await rawStatus(['X-Forwarded-For: 10.40.0.1', 'x-forwarded-for: 10.40.0.2'])).toBe(401)
  }, 15000)

  it('rejects missing, duplicate and malformed X-Forwarded-For from a trusted peer', async () => {
    await restart()
    const missing = await request('/auth/me')
    expect(missing.status).toBe(400)
    expect(missing.data.error.code).toBe('INVALID_MESSAGE')
    for (const value of ['10.0.0.1, 10.0.0.2', '10.0.0.1:8080', 'client.example.com', '10.0.0.0/8', '[::1]']) {
      const result = await request('/auth/me', 'GET', undefined, undefined, forwarded(value))
      expect(result.status).toBe(400)
      expect(result.data.error.code).toBe('INVALID_MESSAGE')
    }
    expect(await rawStatus(['X-Forwarded-For: 10.0.0.1', 'x-forwarded-for: 10.0.0.2'])).toBe(400)
    expect((await request('/auth/me', 'GET', undefined, undefined, forwarded('10.0.0.9'))).status).toBe(401)
  }, 15000)

  it('shares a rate bucket between IPv4 and IPv4-mapped IPv6 forwarded addresses', async () => {
    await restart(['127.0.0.1'])
    const mapped = forwarded('::ffff:10.50.0.1'), plain = forwarded('10.50.0.1'), other = forwarded('10.50.0.2')
    for (let i = 0; i < 20; i++) expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' }, undefined, mapped)).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, plain)).status).toBe(429)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, other)).status).toBe(200)
  }, 15000)
})

describe('gateway hello timeout and state machine', () => {
  it('terminates unresponsive client with HELLO_TIMEOUT error frame and 4001 CONNECTION_FAILED close', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000 })
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    const closePromise = once(ws, 'close')

    const errorPayload = await wire.next('error')
    expect(errorPayload).toMatchObject({ code: 'HELLO_TIMEOUT', retryable: true })
    expect(errorPayload.message).toContain('1000ms')

    const [closeCode, closeReason] = await closePromise
    expect(closeCode).toBe(4001)
    expect(closeReason.toString()).toBe('CONNECTION_FAILED')
  })

  it('succeeds handshake when hello arrives within extended hello timeout', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')

    // Delay 200ms before sending hello: well inside the 1000ms deadline.
    await new Promise(r => setTimeout(r, 200))
    wire.send('hello', { role: d.role, deviceId: d.deviceId, accessToken: d.accessToken, protocols: [1], capabilities: ['transport.relay'], clientVersion: d.clientVersion })

    const ack = await wire.next('hello.ack')
    expect(ack.protocol).toBe(1)
    expect(ack.heartbeatIntervalMs).toBe(25000)
  })

  it('discards a hello that arrives after the deadline without authenticating', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000, forceTerminateGraceMs: 200 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    const closed = once(ws, 'close')

    expect((await wire.next('error')).code).toBe('HELLO_TIMEOUT')

    // The deadline already fired: this late hello must not authenticate, must
    // not register a peer and must not touch the store.
    await new Promise<void>(resolve => ws.send(JSON.stringify(createControlFrame('hello', {
      role: d.role, deviceId: d.deviceId, accessToken: d.accessToken,
      protocols: [1], capabilities: ['transport.relay'], clientVersion: d.clientVersion,
    })), () => resolve()))

    const [closeCode] = await closed
    expect(closeCode).toBe(4001)
    expect(wire.messages.filter(message => message.type === 'hello.ack')).toHaveLength(0)
    expect(app.gateway.peers.has(d.deviceId)).toBe(false)
    expect(app.store.get(d.deviceId).lastSeenAt).toBe(0)
  }, 15000)

  it('keeps a fresh connection authenticated after a timed-out sibling', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const stalled = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(stalled)
    await once(stalled, 'open')
    const closed = once(stalled, 'close')

    const live = await socket(d)
    expect((await live.next('hello.ack')).protocol).toBe(1)
    await closed
    expect(app.gateway.peers.get(d.deviceId)).toBeDefined()
    live.send('ping', { nonce: 'still-authenticated' })
    expect(await live.next('pong')).toEqual({ nonce: 'still-authenticated' })
  }, 15000)
})

describe('gateway frame limits', () => {
  it('enforces configured maxFramesPerSec on active frames and immediately reaps a heartbeat-expired host on connect.request', async () => {
    await app.close()
    await start(password, [], { maxFramesPerSec: 64 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    expect(app.gateway.maxFramesPerSec).toBe(64)

    const h = await device('host')
    const c = await device('client')
    const rateLimitedClient = await device('client')
    const hostWire = await socket(h)
    const clientWire = await socket(c)
    const noisyWire = await socket(rateLimitedClient)
    await hostWire.next('hello.ack')
    await clientWire.next('hello.ack')
    await noisyWire.next('hello.ack')

    // Simulate a Host whose last pong is older than heartbeatDisconnectMs before
    // the next periodic interval tick runs.
    const hostPeer = app.gateway.peers.get(h.deviceId)!
    hostPeer.lastPong = Date.now() - (app.gateway.heartbeatDisconnectMs + 1000)

    clientWire.send('connect.request', { hostDeviceId: h.deviceId, preferredTransports: ['relay'] })
    expect(await clientWire.next('error')).toMatchObject({ code: 'HOST_OFFLINE', retryable: true })
    expect(app.gateway.peers.has(h.deviceId)).toBe(false)

    // Active frames exceeding the configured 64 frames/sec threshold trigger RATE_LIMITED (4001).
    const noisyClosed = once(noisyWire.ws, 'close')
    for (let i = 0; i < 70; i++) {
      noisyWire.send('ping', { nonce: `active-${i}` })
    }
    expect(await noisyWire.next('error')).toMatchObject({ code: 'RATE_LIMITED', retryable: false })
    const [closeCode] = await noisyClosed
    expect(closeCode).toBe(4001)
  })
})

describe('structured logger and sensitive data redaction', () => {
  it('redacts sensitive fields in nested objects and arrays', () => {
    const raw = {
      deviceId: 'dev-1',
      role: 'client',
      accessToken: 'token-secret-123',
      password: 'mypassword',
      refreshToken: 'refresh-secret-456',
      ciphertext: 'opaque-ciphertext-abc',
      sdp: 'v=0\r\no=...',
      headers: { authorization: 'Bearer token-secret-789', cookie: 'dsh_session=abc123xyz', host: 'example.com' },
      tokens: [{ id: 1, token: 'token-in-array' }, { id: 2, access_token: 'access-token-in-array' }],
    }
    const redacted = redactSensitive(raw) as any
    expect(redacted.deviceId).toBe('dev-1')
    expect(redacted.role).toBe('client')
    expect(redacted.accessToken).toBe('[REDACTED]')
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.refreshToken).toBe('[REDACTED]')
    expect(redacted.ciphertext).toBe('[REDACTED]')
    expect(redacted.sdp).toBe('[REDACTED]')
    expect(redacted.headers.host).toBe('example.com')
    expect(redacted.headers.authorization).toBe('[REDACTED]')
    expect(redacted.headers.cookie).toBe('[REDACTED]')
    expect(redacted.tokens[0].token).toBe('[REDACTED]')
    expect(redacted.tokens[1].access_token).toBe('[REDACTED]')
  })

  it('redacts sensitive parameters in URLs and bearer strings', () => {
    const url = 'https://server.example.com/ws/v1/connect?accessToken=secret123&other=safe'
    expect(redactSensitive(url)).toBe('https://server.example.com/ws/v1/connect?accessToken=[REDACTED]&other=safe')
    const bearer = 'Bearer super_secret_token_val== other'
    expect(redactSensitive(bearer)).toBe('Bearer [REDACTED] other')
  })

  it('handles circular references and errors safely', () => {
    const circular: Record<string, unknown> = { key: 'safe' }
    circular.self = circular
    const clean = redactSensitive(circular) as any
    expect(clean.key).toBe('safe')
    expect(clean.self).toBe('[CIRCULAR]')

    const err = new Error('Failed to parse accessToken=secret123')
    const cleanErr = redactSensitive(err) as any
    expect(cleanErr.name).toBe('Error')
    expect(cleanErr.message).toContain('accessToken=[REDACTED]')
  })

  it('emits single-line JSON log entries filtered by log level', () => {
    const entries: LogEntry[] = []
    const lines: string[] = []
    const logger = new Logger('test-scope', 'warn', (line, entry) => { lines.push(line); entries.push(entry) })

    logger.debug('debug_ignored', { info: 'hidden' })
    logger.info('info_ignored', { info: 'hidden' })
    expect(entries).toHaveLength(0)

    logger.warn('warning_logged', { user: 'alice', accessToken: 'my-token' })
    logger.error('error_logged', { password: 'pass', reason: 'failed' })

    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe('warn')
    expect(entries[0].scope).toBe('test-scope')
    expect(entries[0].event).toBe('warning_logged')
    expect(entries[0].meta.user).toBe('alice')
    expect(entries[0].meta.accessToken).toBe('[REDACTED]')
    expect(entries[1].level).toBe('error')
    expect(entries[1].event).toBe('error_logged')
    expect(entries[1].meta.password).toBe('[REDACTED]')
    expect(entries[1].meta.reason).toBe('failed')

    expect(lines).toHaveLength(2)
    expect(lines[0]).not.toContain('\n')
    const parsed = JSON.parse(lines[0])
    expect(parsed.event).toBe('warning_logged')
    expect(parsed.meta.accessToken).toBe('[REDACTED]')
  })

  it('parses and validates environment configuration with fallback warnings', () => {
    expect(parseHelloTimeout(undefined)).toBe(5000)
    expect(parseHelloTimeout('10000')).toBe(10000)
    expect(parseHelloTimeout('500')).toBe(5000)
    expect(parseHelloTimeout('70000')).toBe(5000)
    expect(parseHelloTimeout('invalid')).toBe(5000)

    expect(parseHeartbeatInterval(undefined)).toBe(25000)
    expect(parseHeartbeatInterval('30000')).toBe(30000)
    expect(parseHeartbeatInterval('1000')).toBe(25000)
    expect(parseHeartbeatInterval('150000')).toBe(25000)

    expect(parseHeartbeatDisconnect(undefined, 25000)).toBe(75000)
    expect(parseHeartbeatDisconnect('80000', 25000)).toBe(80000)
    expect(parseHeartbeatDisconnect('40000', 25000)).toBe(75000)
    expect(parseHeartbeatDisconnect('50000', 30000)).toBe(90000)

    expect(parseLogLevel(undefined)).toBe('info')
    expect(parseLogLevel('debug')).toBe('debug')
    expect(parseLogLevel('WARN')).toBe('warn')
    expect(parseLogLevel('silent')).toBe('silent')
    expect(parseLogLevel('invalid_level')).toBe('info')

    expect(parseMaxFramesPerSec(undefined)).toBe(512)
    expect(parseMaxFramesPerSec('4096')).toBe(4096)
    expect(parseMaxFramesPerSec('32')).toBe(512)
    expect(parseMaxFramesPerSec('100000')).toBe(512)
    expect(normalizeMaxFramesPerSec(Number.NaN)).toBe(512)
  })
})

describe('defensive logger hardening', () => {
  it('redacts secrets inside serialized JSON documents and URLs', () => {
    const document = JSON.stringify({ access_token: 'CANARY-A', sdp: 'v=0 o=alice 1234', nested: { refreshToken: 'CANARY-B' }, keep: 'visible' })
    const redacted = redactSensitive(document) as string
    expect(redacted).not.toContain('CANARY-A')
    expect(redacted).not.toContain('CANARY-B')
    expect(redacted).not.toContain('v=0')
    expect(redacted).toContain('visible')
    expect(redacted).toContain('[REDACTED]')
    expect(redactSensitive('wss://host/ws?token=CANARY-C&sdp=CANARY-D&keep=1'))
      .toBe('wss://host/ws?token=[REDACTED]&sdp=[REDACTED]&keep=1')
    expect(redactSensitive('Authorization: Bearer CANARY-TOKEN')).not.toContain('CANARY-TOKEN')
    expect(redactSensitive('basic CANARY-BASIC')).not.toContain('CANARY-BASIC')
  })

  it('redacts ciphertext, cookie and authorization keys in every spelling', () => {
    const clean = redactSensitive({
      'x-ciphertext': 'CANARY-E', cipher_text: 'CANARY-F', cookie: 'CANARY-G', authorization: 'CANARY-H',
      'refresh-token': 'CANARY-I', secret: 'CANARY-J', sibling: 'kept',
    }) as Record<string, string>
    for (const key of Object.keys(clean)) {
      if (key === 'sibling') expect(clean[key]).toBe('kept')
      else expect(clean[key]).toBe('[REDACTED]')
    }
  })

  it('never throws on BigInt, NaN, throwing getters or hostile proxies', () => {
    const entries: LogEntry[] = []
    const logger = new Logger('test-scope', 'debug', (_line, entry) => entries.push(entry))
    const withGetter = { ok: 'fine', get boom(): string { throw new Error('getter exploded') } }
    const hostile = new Proxy({}, {
      ownKeys() { throw new Error('blocked') },
      getOwnPropertyDescriptor() { throw new Error('blocked') },
      get() { throw new Error('blocked') },
    })

    expect(() => logger.info('bigint_logged', { size: 9007199254740993n, ratio: Number.NaN, list: [1n, 2n] })).not.toThrow()
    expect(() => logger.warn('getter_logged', withGetter as unknown as Record<string, unknown>)).not.toThrow()
    expect(() => logger.error('hostile_logged', hostile as Record<string, unknown>)).not.toThrow()

    expect(entries[0].meta.size).toBe('9007199254740993')
    expect(entries[0].meta.ratio).toBe('NaN')
    expect(entries[0].meta.list).toEqual(['1', '2'])
    expect(entries[1].meta.ok).toBe('fine')
    expect(entries[1].meta.boom).toBe('[UNSERIALIZABLE]')
    expect(entries[2].meta).toEqual({ value: '[UNSERIALIZABLE]' })
    for (const entry of entries) expect(() => JSON.stringify(entry)).not.toThrow()
  })

  it('replaces unsanitized event and scope labels', () => {
    const entries: LogEntry[] = []
    const logger = new Logger('bad scope {"injected":true}', 'info', (_line, entry) => entries.push(entry))
    logger.info('event with spaces {"leak":1}', { ok: 1 })
    expect(entries[0].scope).toBe('server')
    expect(entries[0].event).toBe('invalid_event')
    expect(entries[0].meta).toEqual({ ok: 1 })
  })

  it('rejects prototype members when parsing log levels', () => {
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
    try {
      for (const candidate of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
        expect(parseLogLevel(candidate)).toBe('info')
      }
      expect(parseLogLevel('constructor', 'warn')).toBe('warn')
    } finally {
      spy.mockRestore()
    }
    expect(warnings.join('\n')).not.toContain('__proto__')
  })
})

describe('gateway diagnostics redaction', () => {
  it('never logs query parameters from a rejected upgrade', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { lines.push(String(message)) })
    try {
      const port = (app.server.address() as { port: number }).port
      const crlf = String.fromCharCode(13, 10)
      await new Promise<void>(resolve => {
        const socket = createConnection(port, '127.0.0.1')
        socket.on('connect', () => socket.write([
          'GET /ws/v1/connect?access_token=CANARY-URL HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join(crlf)))
        socket.on('data', () => {})
        socket.on('close', () => resolve())
        socket.on('error', () => resolve())
      })
    } finally {
      spy.mockRestore()
    }
    const log = lines.join('\n')
    expect(log).toContain('ws_upgrade_rejected')
    expect(log).toContain('invalid_url')
    expect(log).not.toContain('CANARY-URL')
    expect(log).not.toContain('access_token')
  })

  it('never logs credentials from a rejected hello', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { lines.push(String(message)) })
    try {
      const wire = await socket(await device(), { accessToken: 'CANARY-HELLO' })
      expect((await wire.next('error')).code).toBe('AUTH_INVALID')
    } finally {
      spy.mockRestore()
    }
    expect(lines.join('\n')).toContain('ws_message_error')
    expect(lines.join('\n')).not.toContain('CANARY-HELLO')
  })

  it('never logs a client-supplied close reason', async () => {
    await app.close()
    await start(password, [], { logLevel: 'debug' })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    wire.send('hello', {
      role: d.role, deviceId: d.deviceId, accessToken: d.accessToken,
      protocols: [1], capabilities: ['transport.relay'], clientVersion: d.clientVersion,
    })
    await wire.next('hello.ack')

    const lines: string[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => { lines.push(String(message)) })
    try {
      const closed = once(ws, 'close')
      ws.close(4000, 'CANARY-REASON')
      await closed
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      spy.mockRestore()
    }
    const log = lines.join('\n')
    expect(log).toContain('ws_connection_closed')
    expect(log).toContain('"hasReason":true')
    expect(log).not.toContain('CANARY-REASON')
  })
})

describe('gateway timing configuration normalization', () => {
  it('maps NaN, Infinity and out-of-range programmatic values to safe defaults', () => {
    expect(normalizeGatewayOptions({})).toEqual({
      helloTimeoutMs: 5000, heartbeatIntervalMs: 25000, heartbeatDisconnectMs: 75000, forceTerminateGraceMs: 1000,
    })
    expect(normalizeGatewayOptions({
      helloTimeoutMs: Number.NaN, heartbeatIntervalMs: Number.POSITIVE_INFINITY,
      heartbeatDisconnectMs: -1, forceTerminateGraceMs: 0,
    })).toEqual({
      helloTimeoutMs: 5000, heartbeatIntervalMs: 25000, heartbeatDisconnectMs: 75000, forceTerminateGraceMs: 1000,
    })
    expect(normalizeGatewayOptions({ helloTimeoutMs: 59 }).helloTimeoutMs).toBe(5000)
    expect(normalizeGatewayOptions({ helloTimeoutMs: 60001 }).helloTimeoutMs).toBe(5000)
    expect(normalizeGatewayOptions({ helloTimeoutMs: '2500' as unknown as number }).helloTimeoutMs).toBe(2500)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 300_000 }).heartbeatIntervalMs).toBe(25000)
    expect(normalizeGatewayOptions({ forceTerminateGraceMs: 50 }).forceTerminateGraceMs).toBe(1000)
    expect(normalizeGatewayOptions({ forceTerminateGraceMs: 10001 }).forceTerminateGraceMs).toBe(1000)
  })

  it('keeps the disconnect threshold at twice the interval and inside its ceiling', () => {
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000 }).heartbeatDisconnectMs).toBe(90000)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000, heartbeatDisconnectMs: 59000 }).heartbeatDisconnectMs).toBe(90000)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000, heartbeatDisconnectMs: 60001 }).heartbeatDisconnectMs).toBe(60001)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000, heartbeatDisconnectMs: 600_001 }).heartbeatDisconnectMs).toBe(90000)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 120_000 }).heartbeatDisconnectMs).toBe(360_000)
  })

  it('normalizes unsafe values handed to createRemoteServer', () => {
    const unsafe = createRemoteServer({
      account, password, dataFile: join(dir, 'unsafe.json'), publicUrl: 'http://localhost:8080',
      helloTimeoutMs: Number.NaN, heartbeatIntervalMs: Number.POSITIVE_INFINITY,
      heartbeatDisconnectMs: -1, forceTerminateGraceMs: Number.NaN,
    })
    try {
      expect(unsafe.gateway.helloTimeoutMs).toBe(5000)
      expect(unsafe.gateway.heartbeatIntervalMs).toBe(25000)
      expect(unsafe.gateway.heartbeatDisconnectMs).toBe(75000)
      expect(unsafe.gateway.forceTerminateGraceMs).toBe(1000)
    } finally {
      unsafe.gateway.close()
    }
  })

  it('never echoes the rejected value in a configuration warning', () => {
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
    try {
      expect(parseHelloTimeout('not-a-number-CANARY7')).toBe(5000)
      expect(parseHeartbeatInterval('CANARY7')).toBe(25000)
      expect(parseHeartbeatDisconnect('CANARY7', 25000)).toBe(75000)
      expect(parseLogLevel('CANARY7')).toBe('info')
    } finally {
      spy.mockRestore()
    }
    expect(warnings).toHaveLength(4)
    for (const warning of warnings) expect(warning).not.toContain('CANARY7')
    expect(warnings[0]).toContain('1000 and 60000')
  })
})
