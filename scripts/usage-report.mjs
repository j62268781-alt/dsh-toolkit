#!/usr/bin/env node
/**
 * Offline usage report: drives the real Host implementation of the usage module
 * (src/modules/usage/host/*) directly, without Cordis and without touching the
 * running DSH process. Read-only: it never writes session data or any other file.
 *
 * What it prints:
 *  - session count and aggregate token totals / estimated cost / pricing source;
 *  - the top sessions by token consumption with their own cost;
 *  - the last `--days` local-calendar days of token consumption;
 *  - one CPU / memory sample of THIS process, taken by the module's CpuSampler.
 *
 * Live in-memory sessions are owned by the Cordis Host (`ctx.sessions`), so a
 * standalone run necessarily covers disk sessions only; the report states this.
 *
 * Usage:
 *   node scripts/usage-report.mjs [--home <DSH_HOME>] [--days 7] [--top 10]
 *                                 [--cpu-wait 1200] [--json]
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { UsageScanner, resolveDshHome } from '../src/modules/usage/host/scan.js'
import {
  costForModelBuckets,
  effectivePrices,
  matchPrice,
  round6,
  totalTokens,
  addTokens,
  zeroTokens,
} from '../src/modules/usage/host/pricing.js'
import { CpuSampler } from '../src/modules/usage/host/cpu.js'
import { addLocalDays, localDayStart } from '../src/modules/usage/host/time.js'

const FALLBACK_HOME = 'D:\\DeepSeekHarness-home'

function flag(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

function positiveInt(name, fallback) {
  const value = Number(flag(name, fallback))
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : fallback
}

function pickHome() {
  const explicit = flag('home')
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  if (existsSync(join(FALLBACK_HOME, 'sessions'))) return FALLBACK_HOME
  return resolveDshHome()
}

function pad(value, width) {
  return String(value).padStart(width)
}

/** YYYY-MM-DD of a local-calendar day start (never the UTC date, which can be the previous day). */
function localDayLabel(start) {
  const date = new Date(start)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function compact(value) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

const days = positiveInt('days', 7)
const top = positiveInt('top', 10)
const cpuWaitMs = positiveInt('cpu-wait', 1200)
const json = process.argv.includes('--json')
const home = pickHome()

const scanner = new UsageScanner({ home, getLive: () => [] })
let scan
try {
  scan = await scanner.scan()
} finally {
  scanner.dispose()
}

const pricesInfo = effectivePrices([], 'CNY')
const prices = pricesInfo.prices
const currency = 'CNY'

const totals = zeroTokens()
for (const session of scan.sessions) addTokens(totals, session.tokens)
const totalCost = costForModelBuckets(scan.sessions.flatMap((session) => session.byModel ?? []), prices)

const sessions = scan.sessions
  .map((session) => {
    const cost = costForModelBuckets(session.byModel ?? [], prices)
    return {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      provider: session.provider,
      model: session.model,
      live: session.live,
      subagent: session.subagent,
      turns: session.turns,
      steps: session.steps,
      tokens: session.tokens,
      totalTokens: session.totalTokens,
      cost: round6(cost.amount),
      unpricedTokens: cost.unpricedTokens,
    }
  })
  .sort((a, b) => b.totalTokens - a.totalTokens)

// Last N local-calendar days, oldest first, based on the per-session day buckets
// produced by the Host scan (not recomputed from raw logs).
const today = localDayStart(Date.now())
const windowDays = []
for (let offset = days - 1; offset >= 0; offset -= 1) {
  windowDays.push(addLocalDays(today, -offset))
}
const windowSet = new Set(windowDays)
const timeline = new Map(windowDays.map((start) => [start, { start, tokens: zeroTokens(), cost: 0, unpricedTokens: 0 }]))
for (const session of scan.sessions) {
  for (const [dayStart, modelBuckets] of session.dayBuckets ?? []) {
    const bucket = timeline.get(dayStart)
    if (bucket === undefined || !windowSet.has(dayStart)) continue
    for (const model of modelBuckets.values()) {
      addTokens(bucket.tokens, model.tokens)
      const price = matchPrice(prices, model.provider, model.model)
      if (price === null) bucket.unpricedTokens += totalTokens(model.tokens)
      else {
        bucket.cost +=
          (Number(model.tokens.inputTokens) * price.input +
            Number(model.tokens.outputTokens) * price.output +
            Number(model.tokens.cacheReadTokens) * price.cacheRead +
            Number(model.tokens.cacheWriteTokens) * price.cacheWrite) /
          1_000_000
      }
    }
  }
}
const timelineRows = [...timeline.values()].map((bucket) => ({
  day: localDayLabel(bucket.start),
  start: bucket.start,
  inputTokens: bucket.tokens.inputTokens,
  outputTokens: bucket.tokens.outputTokens,
  cacheReadTokens: bucket.tokens.cacheReadTokens,
  cacheWriteTokens: bucket.tokens.cacheWriteTokens,
  totalTokens: totalTokens(bucket.tokens),
  cost: round6(bucket.cost),
  unpricedTokens: bucket.unpricedTokens,
}))

// One real CPU / memory sample from the module's own sampler.
const sampler = new CpuSampler()
sampler.sample() // baseline
await new Promise((resolve) => setTimeout(resolve, cpuWaitMs))
const cpu = sampler.sample()
sampler.stop()

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  home,
  liveSessions: 'not available outside Cordis (ctx.sessions is Host-owned); disk sessions only',
  pricing: { currency, source: pricesInfo.source, prices },
  scan: scan.scan,
  sessionCount: sessions.length,
  totals: { ...totals, totalTokens: totalTokens(totals) },
  cost: { amount: round6(totalCost.amount), currency, unpricedTokens: totalCost.unpricedTokens },
  sessions,
  timeline: { bucket: 'day', days, buckets: timelineRows },
  cpu,
}

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log('dsh-toolkit usage report (Host scan, offline, read-only)')
  console.log(`  generated    ${report.generatedAt}  node ${report.node}`)
  console.log(`  home         ${report.home}`)
  console.log(`  sessions     ${report.sessionCount} (disk only: ${report.liveSessions})`)
  console.log(`  scan         dirs ${scan.scan.sessionDirs}, files ${scan.scan.files}, parsed ${scan.scan.parsed}, cached ${scan.scan.cached}, skipped ${scan.scan.skipped}, errors ${scan.scan.errors.length}`)
  for (const error of scan.scan.errors.slice(0, 5)) console.log(`    ! ${error}`)
  console.log('')
  console.log('token totals')
  console.log(`  input (cache miss)  ${pad(totals.inputTokens, 14)}`)
  console.log(`  output              ${pad(totals.outputTokens, 14)}`)
  console.log(`  cache read (hit)    ${pad(totals.cacheReadTokens, 14)}`)
  console.log(`  cache write         ${pad(totals.cacheWriteTokens, 14)}`)
  console.log(`  total               ${pad(totalTokens(totals), 14)}`)
  console.log('')
  console.log(`cost  ${report.cost.amount} ${currency}   (pricing source: ${report.pricing.source}; unpriced tokens: ${report.cost.unpricedTokens})`)
  console.log('')
  console.log(`top ${Math.min(top, sessions.length)} sessions by tokens`)
  for (const session of sessions.slice(0, top)) {
    const title = session.title === null ? '(untitled)' : String(session.title).slice(0, 28)
    console.log(
      `  ${session.id.slice(0, 38).padEnd(38)} ${pad(compact(session.totalTokens), 9)} ${pad(`in ${compact(session.tokens.inputTokens)}`, 13)} ${pad(`out ${compact(session.tokens.outputTokens)}`, 12)} ${pad(`cacheR ${compact(session.tokens.cacheReadTokens)}`, 18)} ${pad(`${session.cost} ${currency}`, 14)}  ${session.live ? 'live ' : ''}${session.model ?? '-'}  ${title}`,
    )
  }
  console.log('')
  console.log(`last ${days} days (local calendar)`)
  for (const bucket of timelineRows) {
    console.log(
      `  ${bucket.day}  total ${pad(compact(bucket.totalTokens), 9)}  in ${pad(compact(bucket.inputTokens), 8)}  out ${pad(compact(bucket.outputTokens), 7)}  cacheR ${pad(compact(bucket.cacheReadTokens), 9)}  ${pad(`${bucket.cost} ${currency}`, 12)}`,
    )
  }
  console.log('')
  console.log('cpu (this process, sampled by src/modules/usage/host/cpu.js)')
  console.log(`  process ${cpu.processPercent}%  system ${cpu.systemPercent}%  cores ${cpu.cores}  load ${cpu.load.map((value) => value.toFixed(2)).join(' / ')}  uptime ${cpu.uptimeSec}s  warmingUp ${cpu.warmingUp}`)
  console.log(`  rss ${(cpu.memory.rss / 1024 / 1024).toFixed(1)} MB  heap ${(cpu.memory.heapUsed / 1024 / 1024).toFixed(1)}/${(cpu.memory.heapTotal / 1024 / 1024).toFixed(1)} MB  system ${(cpu.memory.systemTotal / 1024 / 1024 / 1024).toFixed(1)} GB total / ${(cpu.memory.systemFree / 1024 / 1024 / 1024).toFixed(1)} GB free  history ${cpu.history.length}`)
}
