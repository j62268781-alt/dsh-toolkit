/** 用量统计页的纯函数测试：格式化、几何、预算、读取配置、排序、轮询间隔。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  budgetBarPercent, budgetRatio, budgetTone, buildTimelineChart, cpuHistorySeries,
  formatBytes, formatClock, formatCompactTokens, formatCurrency, formatDayLabel,
  formatDateTime, formatInteger, formatPercent, formatPercentValue, formatUptime,
  memorySummary, normalizeBudget, pollIntervalMs, pricingSourceKey, readUsageSettings,
  scanSummary, sessionStats, sortSessions, timelineSummary, timelineTicks,
} from '../../src/modules/usage/client/model.js'
import { USAGE_COPY, USAGE_NS, createTranslator } from '../../src/modules/usage/client/locale.js'

/* ───────────────────────── token / 数字 ───────────────────────── */

test('compact tokens: K/M/B 进位、负号与非法值', () => {
  assert.equal(formatCompactTokens(0), '0')
  assert.equal(formatCompactTokens(999), '999')
  assert.equal(formatCompactTokens(1000), '1K')
  assert.equal(formatCompactTokens(1234), '1.2K')
  assert.equal(formatCompactTokens(12345), '12.3K')
  assert.equal(formatCompactTokens(123456), '123K')
  assert.equal(formatCompactTokens(999999), '1M', '999999 不能显示成 1000K')
  assert.equal(formatCompactTokens(1234567), '1.2M')
  assert.equal(formatCompactTokens(1500000000), '1.5B')
  assert.equal(formatCompactTokens(-1234), '-1.2K')
  assert.equal(formatCompactTokens(undefined), '—')
  assert.equal(formatCompactTokens(Number.NaN), '—')
})

test('整数与货币格式化：2–4 位小数，非法金额显示占位符', () => {
  assert.equal(formatInteger(1234567, 'en-US'), '1,234,567')
  assert.equal(formatInteger(undefined), '—')
  const cny = formatCurrency(100, 'CNY', 'en-US')
  assert.match(cny, /100\.00/)
  const small = formatCurrency(0.0123, 'CNY', 'en-US')
  assert.match(small, /0\.0123/)
  assert.match(formatCurrency(2, 'USD', 'en-US'), /2\.00/)
  assert.equal(formatCurrency(null, 'CNY'), '—')
  assert.equal(formatCurrency('abc', 'CNY'), '—')
  // CNY/USD 之外的货币字段回退到 CNY 符号，不抛 Intl 异常
  assert.match(formatCurrency(1, 'EUR', 'en-US'), /1\.00/)
})

test('百分比：比率 <1% 时保留两位，CPU 值保留一位', () => {
  assert.equal(formatPercent(0.1268, 'en-US'), '12.7%')
  assert.equal(formatPercent(0.000123, 'en-US'), '0.01%')
  assert.equal(formatPercent(1.5, 'en-US'), '150.0%')
  assert.equal(formatPercent(Number.NaN), '—')
  assert.equal(formatPercentValue(3.2, 'en-US'), '3.2%')
  assert.equal(formatPercentValue(12.5, 'en-US'), '12.5%')
  assert.equal(formatPercentValue(undefined), '—')
})

test('字节与运行时长', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 ** 2 * 2.5), '2.5 MB')
  assert.equal(formatBytes(1024 ** 3 * 1.4), '1.4 GB')
  assert.equal(formatBytes(-1), '—')
  assert.equal(formatBytes(undefined), '—')
  assert.equal(formatUptime(45), '45s')
  assert.equal(formatUptime(90), '1m')
  assert.equal(formatUptime(3660), '1h 1m')
  assert.equal(formatUptime(90000), '1d 1h')
  assert.equal(formatUptime(0), '0s')
})

test('时间格式化：非法值为占位符，合法值可读', () => {
  assert.equal(formatClock(0), '—')
  assert.equal(formatDateTime(undefined), '—')
  const now = Date.UTC(2026, 10, 3, 6, 30, 0)
  assert.match(formatClock(now, 'en-US'), /\d{1,2}:\d{2}/)
  assert.match(formatDateTime(now, 'en-US'), /\d/)
  assert.match(formatDayLabel(now, 'en-US'), /\d/)
})

/* ───────────────────────── 时间线 ───────────────────────── */

const BUCKETS = [
  { start: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0 },
  { start: 2, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, cost: 0.01 },
  { start: 3, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 50, cost: 0.005 },
]

test('时间线几何：柱高按峰值缩放，折线与面积路径可写进 SVG', () => {
  const chart = buildTimelineChart(BUCKETS, { width: 30, height: 20, gap: 0, padTop: 2, padBottom: 2 })
  assert.equal(chart.max, 100)
  assert.equal(chart.bars.length, 3)
  assert.deepEqual(chart.bars.map((bar) => bar.height), [0, 16, 8])
  assert.deepEqual(chart.bars.map((bar) => bar.x), [0, 10, 20])
  assert.equal(chart.linePath, 'M5 18 L15 2 L25 10')
  assert.equal(chart.areaPath, 'M5 18 L15 2 L25 10 L25 18 L5 18 Z')
  assert.match(chart.areaPath, /Z$/)
})

test('时间线几何：空数组与全零数据不除零、不抛错', () => {
  const empty = buildTimelineChart([])
  assert.deepEqual(empty.bars, [])
  assert.equal(empty.max, 0)
  assert.equal(empty.linePath, '')
  assert.equal(empty.areaPath, '')

  const zero = buildTimelineChart([
    { start: 1, totalTokens: 0 },
    { start: 2, totalTokens: 0 },
  ])
  assert.equal(zero.max, 0)
  assert.deepEqual(zero.bars.map((bar) => bar.height), [0, 0])
  assert.match(zero.linePath, /^M/)
})

test('时间线汇总与横轴刻度', () => {
  const summary = timelineSummary({ days: 14, buckets: BUCKETS })
  assert.equal(summary.days, 14)
  assert.equal(summary.totalTokens, 150)
  assert.equal(summary.cost, 0.015)
  assert.equal(summary.max, 100)
  assert.equal(summary.lastStart, 3)
  assert.deepEqual(timelineSummary(undefined), { days: 0, totalTokens: 0, cost: 0, max: 0, lastStart: 0 })

  const buckets = Array.from({ length: 14 }, (_, index) => ({ start: index + 1, totalTokens: index }))
  const ticks = timelineTicks(buckets)
  assert.equal(ticks[0].index, 0)
  assert.equal(ticks.at(-1).index, 13, '最后一天必须出现在横轴上')
  assert.ok(ticks.length <= 8)
})

/* ───────────────────────── 预算 ───────────────────────── */

test('预算比例 / 进度条 / 语气', () => {
  assert.equal(budgetRatio(50, 100), 0.5)
  assert.equal(budgetRatio(0, 100), 0)
  assert.equal(budgetRatio(50, 0), 0, '预算为 0 时比例是 0 而不是 Infinity')
  assert.equal(budgetRatio(50, undefined), 0)
  assert.equal(budgetBarPercent(0.5), 50)
  assert.equal(budgetBarPercent(1.5), 100, '超支时进度条封顶 100%')
  assert.equal(budgetBarPercent(0.000123), 0.01)
  assert.equal(budgetBarPercent(Number.NaN), 0)
  assert.equal(budgetTone(0.5), 'normal')
  assert.equal(budgetTone(0.8), 'warn')
  assert.equal(budgetTone(0.99), 'warn')
  assert.equal(budgetTone(1.2), 'over')
  assert.equal(budgetTone(0.2, false), 'unset')
})

test('normalizeBudget：缺字段有稳定默认值，超支余额为负', () => {
  const normal = normalizeBudget({ amount: 100, currency: 'CNY', period: 'month', spent: 25, remaining: 75, configured: true })
  assert.equal(normal.configured, true)
  assert.equal(normal.ratio, 0.25)
  assert.equal(normal.barPercent, 25)
  assert.equal(normal.tone, 'normal')
  assert.equal(normal.remaining, 75)

  const over = normalizeBudget({ amount: 100, spent: 120, configured: true })
  assert.equal(over.ratio, 1.2)
  assert.equal(over.tone, 'over')
  assert.equal(over.remaining, -20)

  const unset = normalizeBudget({ amount: 0, configured: false })
  assert.equal(unset.configured, false)
  assert.equal(unset.tone, 'unset')
  assert.equal(unset.ratio, 0)

  assert.deepEqual(normalizeBudget(undefined), {
    configured: false, amount: 0, currency: undefined, period: 'month', spent: 0,
    remaining: 0, ratio: 0, barPercent: 0, tone: 'unset', periodStart: 0,
  })
})

/* ───────────────────────── 表单快照 / 轮询 ───────────────────────── */

test('readUsageSettings 兼容三种快照形状', () => {
  assert.deepEqual(readUsageSettings({ value: { usage: { budget: 250, currency: 'USD', period: 'total' } } }), {
    budget: 250, currency: 'USD', period: 'total',
  })
  assert.deepEqual(readUsageSettings({ value: { budget: 42 } }), { budget: 42, currency: undefined, period: undefined })
  assert.deepEqual(readUsageSettings({ budget: 7, currency: 'CNY', period: 'month' }), {
    budget: 7, currency: 'CNY', period: 'month',
  })
  assert.deepEqual(readUsageSettings(undefined), { budget: undefined, currency: undefined, period: undefined })
  assert.deepEqual(readUsageSettings({ value: { usage: { budget: 'abc', currency: 'EUR', period: 'week' } } }), {
    budget: undefined, currency: undefined, period: undefined,
  })
})

test('轮询间隔：clamp 到 2s..120s，隐藏窗口时放慢', () => {
  assert.equal(pollIntervalMs({ refreshMs: 8000 }), 8000)
  assert.equal(pollIntervalMs({}), 8000)
  assert.equal(pollIntervalMs({ refreshMs: 500 }), 2000)
  assert.equal(pollIntervalMs({ refreshMs: 8000 }, { hidden: true }), 30000)
  assert.equal(pollIntervalMs({ refreshMs: 100000 }, { hidden: true }), 120000, '慢速也尊重上限')
})

/* ───────────────────────── 会话表 ───────────────────────── */

const SESSIONS = [
  { id: 'a', title: 'First', updatedAt: 3, totalTokens: 100, cost: 0.3, tokens: { totalTokens: 100 } },
  { id: 'b', title: 'Second', updatedAt: 2, totalTokens: 300, cost: 0.1, tokens: { totalTokens: 300 } },
  { id: 'c', title: 'Third', updatedAt: 1, totalTokens: 200, cost: 0.2, tokens: { totalTokens: 200 } },
]

test('sortSessions：默认 token 降序、可升序、不修改入参', () => {
  const before = SESSIONS.map((session) => session.id)
  assert.deepEqual(sortSessions(SESSIONS).map((session) => session.id), ['b', 'c', 'a'])
  assert.deepEqual(sortSessions(SESSIONS, { key: 'totalTokens', direction: 'asc' }).map((session) => session.id), ['a', 'c', 'b'])
  assert.deepEqual(sortSessions(SESSIONS, { key: 'updatedAt', direction: 'desc' }).map((session) => session.id), ['a', 'b', 'c'])
  assert.deepEqual(sortSessions(SESSIONS, { key: 'title', direction: 'asc' }).map((session) => session.id), ['a', 'b', 'c'])
  assert.deepEqual(SESSIONS.map((session) => session.id), before)
  assert.deepEqual(sortSessions(undefined), [])
})

test('sessionStats：活跃与子代理计数，sessionCount 优先', () => {
  const sessions = [
    { id: '1', live: true, subagent: false },
    { id: '2', live: false, subagent: true },
    { id: '3', live: true, subagent: true },
  ]
  assert.deepEqual(sessionStats(sessions, 12), { count: 12, live: 2, subagents: 2 })
  assert.deepEqual(sessionStats(sessions), { count: 3, live: 2, subagents: 2 })
  assert.deepEqual(sessionStats(undefined), { count: 0, live: 0, subagents: 0 })
})

/* ───────────────────────── CPU ───────────────────────── */

test('CPU 迷你曲线：统一峰值缩放、两条折线、面积路径闭合', () => {
  const history = [
    { t: 1, processPercent: 10, systemPercent: 20, rss: 100 },
    { t: 2, processPercent: 20, systemPercent: 10, rss: 200 },
    { t: 3, processPercent: 5, systemPercent: 5, rss: 300 },
  ]
  const series = cpuHistorySeries(history, { width: 20, height: 20, padTop: 0, padBottom: 0 })
  assert.equal(series.count, 3)
  assert.equal(series.max, 20)
  assert.equal(series.processPoints, '0,10 10,0 20,15')
  assert.equal(series.systemPoints, '0,0 10,10 20,15')
  assert.match(series.areaPath, /^M0 20 L.* Z$/)
  assert.equal(series.sampledAt, 3)
  assert.equal(series.samples[0].rss, 100)

  const empty = cpuHistorySeries(undefined)
  assert.equal(empty.count, 0)
  assert.equal(empty.processPoints, '')
  assert.equal(empty.areaPath, '')
  assert.equal(empty.max, 1)
})

test('memorySummary 与 scanSummary', () => {
  const memory = memorySummary({ rss: 100, heapUsed: 30, heapTotal: 60, systemTotal: 1000, systemFree: 400 })
  assert.equal(memory.systemUsed, 600)
  assert.equal(memory.systemRatio, 0.6)
  assert.equal(memory.heapRatio, 0.5)
  assert.deepEqual(memorySummary(undefined), {
    rss: 0, heapUsed: 0, heapTotal: 0, systemTotal: 0, systemFree: 0, systemUsed: 0, heapRatio: 0, systemRatio: 0,
  })
  assert.deepEqual(scanSummary({ files: 3, parsed: 2, cached: 1, errors: ['x'] }), { files: 3, parsed: 2, cached: 1, errors: 1 })
  assert.deepEqual(scanSummary(undefined), { files: 0, parsed: 0, cached: 0, errors: 0 })
  assert.equal(pricingSourceKey({ source: 'config' }), 'costSourceConfig')
  assert.equal(pricingSourceKey({ source: 'default' }), 'costSourceDefault')
  assert.equal(pricingSourceKey(undefined), 'costSourceDefault')
})

/* ───────────────────────── 文案 ───────────────────────── */

test('locale：命名空间、zh/en 键一致、占位符替换与缺失服务降级', () => {
  assert.equal(USAGE_NS, 'dsh-toolkit.usage')
  assert.deepEqual(Object.keys(USAGE_COPY.zh).sort(), Object.keys(USAGE_COPY.en).sort())

  const fallback = createTranslator(undefined)
  assert.equal(fallback('nav'), '用量统计')
  assert.equal(fallback('turnsSteps', { turns: 1, steps: 3 }), '1 轮 · 3 步')
  assert.equal(fallback('nope'), 'nope', '缺 key 时返回 key，不抛错')

  // 宿主 bind 返回 key（词典还没热）时回退到内置中文表
  const keyBound = createTranslator({ locale: { bind: () => (key) => key } })
  assert.equal(keyBound('nav'), '用量统计')

  // bind 抛错也不影响渲染
  const throwing = createTranslator({ locale: { bind: () => { throw new Error('boom') } } })
  assert.equal(throwing('title'), '用量统计')
  assert.equal(createTranslator({ locale: { bind: (namespace) => (key) => `${namespace}/${key}` } })('nav'), 'dsh-toolkit.usage/nav')
})
