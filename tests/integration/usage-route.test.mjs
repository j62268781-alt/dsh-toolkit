/**
 * Integration test: the usage Host module mounted on a real Cordis Context.
 *
 * Contract: docs/usage/README.md ("HTTP 快照"). This test drives the real module
 * entry (`src/modules/usage/host/index.js`) through `ctx.plugin`, with a fixture
 * DSH_HOME so the route, the zstd scan, pricing and payload assembly all run
 * together. It deliberately does not import internal helpers, so a rename of
 * host/*.js does not break it while a contract violation does.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import * as usage from '../../src/modules/usage/host/index.js'

const SNAPSHOT_PATH = '/_dsh/dsh-toolkit/usage/snapshot'
const SESSION_ID = 'session-fixture-0001'
// Numbers are chosen so every field is distinguishable from every other field.
const MESSAGE_USAGE = [
  { inputTokens: 100, outputTokens: 20, cacheReadTokens: 1000, cacheWriteTokens: 0 },
  { inputTokens: 50, outputTokens: 30, cacheReadTokens: 2000, cacheWriteTokens: 0 },
]
const EXPECTED_TOTALS = {
  inputTokens: 150,
  outputTokens: 50,
  cacheReadTokens: 3000,
  cacheWriteTokens: 0,
  totalTokens: 3200,
}
const TOP_LEVEL_KEYS = [
  'budget',
  'cost',
  'cpu',
  'generatedAt',
  'ok',
  'pricing',
  'refreshMs',
  'scan',
  'sessionCount',
  'sessions',
  'timeline',
  'totals',
]

// One JSONL line per event; the file is written as SEVERAL concatenated zstd
// frames exactly like DSH does on real disk (a single whole-buffer decompress
// would return only the first frame).
function sessionLogLines(now) {
  return [
    { type: 'session', version: 4, id: SESSION_ID, createdAt: now - 60_000, cwd: 'D:\\fixture\\project', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' },
    { type: 'request/context', seq: 0, time: now - 60_000, data: { provider: 'turing', model: 'deepseek-flash', contextWindow: 1_000_000 } },
    { type: 'turn/start', seq: 1, time: now - 50_000, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: now - 40_000, data: { turn: 1, step: 1 } },
    { type: 'request/header', seq: 3, time: now - 40_000, data: { header: { config: { provider: 'turing', model: 'deepseek-flash', reasoningEffort: 'max', maxTokens: 393216 } } } },
    // Real DSH logs carry the model source on the assistant message itself.
    { type: 'assistant/message', seq: 4, time: now - 30_000, data: { turn: 1, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'turing', model: 'deepseek-flash' } }, usage: MESSAGE_USAGE[0] } },
    { type: 'step/end', seq: 5, time: now - 25_000, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 6, time: now - 20_000, data: { turn: 1, step: 2 } },
    { type: 'assistant/message', seq: 7, time: now - 10_000, data: { turn: 1, step: 2, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'turing', model: 'deepseek-flash' } }, usage: MESSAGE_USAGE[1] } },
    { type: 'session/title', seq: 8, time: now - 10_000, data: { title: 'Fixture session', messageSeqs: [1], source: { kind: 'fallback' } } },
    { type: 'step/end', seq: 9, time: now - 5_000, data: { turn: 1, step: 2 } },
    { type: 'turn/end', seq: 10, time: now - 4_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n') + '\n'
}

function concatenatedFrames(text, frameCount = 3) {
  const lines = text.match(/[^\n]*\n/g)
  const perFrame = Math.ceil(lines.length / frameCount)
  const frames = []
  for (let i = 0; i < lines.length; i += perFrame) {
    frames.push(zstdCompressSync(Buffer.from(lines.slice(i, i + perFrame).join(''), 'utf8')))
  }
  return Buffer.concat(frames)
}

async function fixtureHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-usage-route-'))
  const dir = join(home, 'sessions', '--D-fixture-project--', SESSION_ID)
  await mkdir(dir, { recursive: true })
  const now = Date.now()
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), concatenatedFrames(sessionLogLines(now)))
  // Real homes have a projection cache next to the logs; the scan must not
  // require it, and a corrupt entry must never break the route.
  const projcache = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(projcache, { recursive: true })
  await writeFile(join(projcache, `${SESSION_ID}.json`), '{not json')
  t.after(async () => {
    await rm(home, { recursive: true, force: true })
  })
  return { home, now }
}

function responseStub() {
  const headers = {}
  const res = {
    statusCode: 200,
    headers,
    body: undefined,
    ended: false,
    setHeader(name, value) { headers[String(name).toLowerCase()] = value },
    writeHead(status, values) {
      res.statusCode = status
      for (const [name, value] of Object.entries(values ?? {})) headers[name.toLowerCase()] = value
      return res
    },
    end(body) { res.body = body; res.ended = true; return res },
  }
  return res
}

function parseBody(res) {
  assert.equal(typeof res.body, 'string', 'handler must end the response with a JSON string')
  return JSON.parse(res.body)
}

async function boot(t, { methods = true } = {}) {
  const { home, now } = await fixtureHome(t)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  const mounted = new Map()
  const listCalls = { count: 0 }
  const ctx = new Context()
  const server = {
    register(route) {
      assert.equal(mounted.has(route.path), false, 'a reload must not leave a duplicate route')
      mounted.set(route.path, route)
      return () => mounted.delete(route.path)
    },
  }
  const sessions = {
    list() {
      listCalls.count += 1
      return []
    },
  }
  let rejection
  const connection = {
    requestRejection(req) {
      assert.equal(this, connection, 'host request binding must be preserved')
      assert.ok(req && typeof req === 'object')
      return rejection
    },
  }
  const disposeServices = [
    ctx.provide('webServer', server),
    ctx.provide('sessions', sessions),
    ctx.provide('connection', connection),
  ]
  t.after(() => {
    for (const dispose of disposeServices) dispose()
  })

  const fiber = ctx.plugin(usage, {})
  t.after(() => fiber.dispose())
  await fiber
  return { home, now, mounted, listCalls, route: mounted.get(SNAPSHOT_PATH), setRejection: (status) => { rejection = status } }
}

test('the usage module registers exactly one authenticated exact GET route', async (t) => {
  const { mounted, route } = await boot(t)
  assert.equal(mounted.size, 1)
  assert.ok(route, `expected ${SNAPSHOT_PATH} to be registered`)
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, SNAPSHOT_PATH)
  assert.equal(typeof route.handler, 'function')
})

test('GET returns the documented snapshot computed from real session files', async (t) => {
  const { route, home, now, setRejection } = await boot(t)
  setRejection(undefined)
  const res = responseStub()
  await route.handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.ended, true)
  assert.match(String(res.headers['cache-control'] ?? ''), /no-store/)
  assert.match(String(res.headers['content-type'] ?? ''), /application\/json/)

  const payload = parseBody(res)
  assert.deepEqual(Object.keys(payload).sort(), TOP_LEVEL_KEYS)

  assert.equal(payload.ok, true)
  assert.equal(typeof payload.generatedAt, 'number')
  assert.ok(Math.abs(payload.generatedAt - Date.now()) < 60_000)
  assert.equal(typeof payload.refreshMs, 'number')
  assert.ok(payload.refreshMs >= 2000 && payload.refreshMs <= 120_000)

  assert.equal(payload.sessionCount, 1)
  assert.deepEqual(payload.totals, EXPECTED_TOTALS)

  // Default pricing must price this model (turing/deepseek-flash) with no unpriced tokens.
  assert.equal(payload.cost.currency, 'CNY')
  assert.ok(payload.cost.amount > 0, 'cost must be positive for priced tokens')
  assert.equal(payload.cost.unpricedTokens, 0)
  assert.deepEqual(payload.pricing.currency, 'CNY')
  assert.equal(payload.pricing.source, 'default')
  assert.ok(payload.pricing.models.length > 0)

  // Budget defaults to 100 CNY / month and is expressed against the same cost.
  assert.equal(payload.budget.amount, 100)
  assert.equal(payload.budget.currency, 'CNY')
  assert.equal(payload.budget.period, 'month')
  assert.equal(payload.budget.configured, true)
  assert.equal(payload.budget.spent, payload.cost.amount)
  assert.equal(payload.budget.remaining, Number((payload.budget.amount - payload.cost.amount).toFixed(6)))
  // Money is documented as 6-decimal precision, so the ratio is rounded too.
  assert.ok(Math.abs(payload.budget.ratio - payload.cost.amount / payload.budget.amount) <= 5e-7)

  // Timeline: `historyDays` consecutive local-day buckets, last one today, summing to the totals.
  assert.equal(payload.timeline.bucket, 'day')
  assert.equal(payload.timeline.days, 14)
  assert.equal(payload.timeline.buckets.length, 14)
  const localMidnight = (time) => {
    const date = new Date(time)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  assert.equal(payload.timeline.buckets.at(-1).start, localMidnight(now))
  for (let i = 1; i < payload.timeline.buckets.length; i++) {
    const previous = payload.timeline.buckets[i - 1].start
    const current = payload.timeline.buckets[i].start
    const next = new Date(previous)
    next.setDate(next.getDate() + 1)
    assert.equal(current, localMidnight(next.getTime()), 'day buckets must be consecutive')
  }
  const timelineTotal = payload.timeline.buckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  assert.equal(timelineTotal, payload.totals.totalTokens)
  assert.equal(payload.timeline.buckets.at(-1).totalTokens, payload.totals.totalTokens)
  for (const bucket of payload.timeline.buckets) {
    assert.equal(bucket.totalTokens, bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens)
  }

  // Session rows are sorted by tokens, carry the model and the fixture identity.
  assert.equal(payload.sessions.length, 1)
  const [session] = payload.sessions
  assert.equal(session.id, SESSION_ID)
  assert.equal(session.provider, 'turing')
  assert.equal(session.model, 'deepseek-flash')
  assert.equal(session.cwd, 'D:\\fixture\\project')
  assert.equal(session.title, 'Fixture session')
  assert.equal(session.live, false)
  assert.equal(session.turns, 1)
  assert.equal(session.steps, 2)
  // Per the contract the per-session `tokens` object carries the four counters;
  // `totalTokens` is a sibling field and `totals.totalTokens` the aggregate.
  const { totalTokens: _ignored, ...FOUR_FIELDS } = EXPECTED_TOTALS
  assert.deepEqual(session.tokens, FOUR_FIELDS)
  assert.equal(session.totalTokens, EXPECTED_TOTALS.totalTokens)
  assert.equal(typeof session.cost, 'number')
  assert.ok(session.cost > 0)
  assert.equal(session.unpricedTokens, 0)

  // CPU snapshot shape.
  assert.equal(typeof payload.cpu.processPercent, 'number')
  assert.equal(typeof payload.cpu.systemPercent, 'number')
  assert.ok(payload.cpu.cores >= 1)
  assert.equal(payload.cpu.load.length, 3)
  assert.equal(typeof payload.cpu.memory.rss, 'number')
  assert.equal(typeof payload.cpu.memory.systemTotal, 'number')
  assert.equal(typeof payload.cpu.sampledAt, 'number')
  assert.equal(typeof payload.cpu.warmingUp, 'boolean')
  assert.ok(Array.isArray(payload.cpu.history))
  assert.ok(payload.cpu.history.length <= 60)

  // Scan diagnostics point at the fixture home and must tolerate the corrupt projcache.
  assert.equal(payload.scan.home, home)
  assert.equal(payload.scan.sessionDirs, 1)
  assert.equal(payload.scan.files, 1)
  assert.ok(Array.isArray(payload.scan.errors))
})

test('rejected requests never reach session scanning and return the guard status', async (t) => {
  const { route, listCalls, setRejection } = await boot(t)
  for (const status of [401, 403]) {
    setRejection(status)
    const res = responseStub()
    await route.handler({ method: 'GET', headers: {} }, res)
    assert.equal(res.statusCode, status)
    assert.equal(res.ended, true)
    assert.equal(res.body, undefined)
  }
  assert.equal(listCalls.count, 0, 'a rejected request must not scan sessions')
})

test('non-GET methods are 404 and never scan sessions', async (t) => {
  const { route, listCalls, setRejection } = await boot(t)
  setRejection(undefined)
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    const res = responseStub()
    await route.handler({ method, headers: {} }, res)
    assert.equal(res.statusCode, 404, `${method} must not be served`)
    assert.equal(res.ended, true)
  }
  assert.equal(listCalls.count, 0, 'a non-GET request must not scan sessions')
})

test('the snapshot is served with no-store and re-scans the same home consistently', async (t) => {
  const { route, setRejection } = await boot(t)
  setRejection(undefined)
  const first = responseStub()
  await route.handler({ method: 'GET', headers: {} }, first)
  const second = responseStub()
  await route.handler({ method: 'GET', headers: {} }, second)
  const a = parseBody(first)
  const b = parseBody(second)
  assert.equal(a.scan.files, 1)
  assert.deepEqual(a.totals, b.totals)
  assert.deepEqual(a.sessions.map(({ id }) => id), b.sessions.map(({ id }) => id))
})
