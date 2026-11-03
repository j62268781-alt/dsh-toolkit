/**
 * 用量统计页的纯函数层：格式化、时间线/迷你曲线几何、预算比例、排序。
 *
 * 这里不放 DOM、不读 ctx、不发请求——面板只负责取值与排版，所有可测的算术都在这。
 */

export const DEFAULT_REFRESH_MS = 8000
export const MIN_REFRESH_MS = 2000
export const MAX_REFRESH_MS = 120000
export const HIDDEN_SLOWDOWN = 3
export const MIN_HIDDEN_REFRESH_MS = 30000

export const CURRENCIES = ['CNY', 'USD']
export const PERIODS = ['month', 'total']
export const SESSION_SORT_KEYS = ['totalTokens', 'cost', 'updatedAt', 'title']

const EMPTY = '—'
const NBSP = '\u00a0'

/** 有限数字，否则回退（不把 null/'' 当 0 时误报）。 */
export function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function stripTrailingZeros(text) {
  return text.includes('.') ? text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : text
}

/**
 * 紧凑 token 数：`1.2M` / `12.3K`。1000 以下保持整数，四舍五入跨单位时进位
 * （999999 → 1M，而不是 1000K）。
 */
export function formatCompactTokens(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return EMPTY
  const abs = Math.abs(number)
  if (abs < 1000) return formatInteger(Math.round(number))
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (let index = 0; index < units.length; index += 1) {
    const [size, suffix] = units[index]
    if (abs < size) continue
    const scaled = number / size
    const digits = Math.abs(scaled) >= 100 ? 0 : 1
    const text = scaled.toFixed(digits)
    if (Math.abs(Number(text)) >= 1000 && index > 0) {
      const [biggerSize, biggerSuffix] = units[index - 1]
      const biggerScaled = number / biggerSize
      const biggerText = biggerScaled.toFixed(Math.abs(biggerScaled) >= 100 ? 0 : 1)
      return `${stripTrailingZeros(biggerText)}${biggerSuffix}`
    }
    return `${stripTrailingZeros(text)}${suffix}`
  }
  return formatInteger(number)
}

/** 千分位整数。 */
export function formatInteger(value, locale) {
  const number = Number(value)
  if (!Number.isFinite(number)) return EMPTY
  try {
    return new Intl.NumberFormat(locale ?? undefined, { maximumFractionDigits: 0 }).format(Math.round(number))
  } catch {
    return String(Math.round(number))
  }
}

/**
 * 金额展示：2 位小数打底，最多 4 位（契约要求 Host 保留 6 位，Client 负责精度）。
 * 货币非法/金额缺失时显示 `—`，绝不显示 NaN。
 */
export function formatCurrency(amount, currency = 'CNY', locale) {
  const number = Number(amount)
  if (amount === null || amount === undefined || !Number.isFinite(number)) return EMPTY
  const code = currency === 'USD' ? 'USD' : 'CNY'
  try {
    return new Intl.NumberFormat(locale ?? undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(number)
  } catch {
    return `${code}${NBSP}${number.toFixed(2)}`
  }
}

/** 比率（0.1268）→ 百分比文本（12.7%）；小于 1% 的比率多给一位，避免预算进度永远显示 0%。 */
export function formatPercent(ratio, locale) {
  const number = Number(ratio)
  if (!Number.isFinite(number)) return EMPTY
  const percent = number * 100
  const digits = Math.abs(percent) < 1 ? 2 : 1
  try {
    return `${new Intl.NumberFormat(locale ?? undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(percent)}%`
  } catch {
    return `${percent.toFixed(digits)}%`
  }
}

/** 已经是百分数的值（CPU 的 processPercent=3.2）→ 3.2%。 */
export function formatPercentValue(value, locale) {
  const number = Number(value)
  if (!Number.isFinite(number)) return EMPTY
  try {
    return `${new Intl.NumberFormat(locale ?? undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(number)}%`
  } catch {
    return `${number.toFixed(1)}%`
  }
}

/** 1024 进制字节数：`1.5 MB` / `512 B`。 */
export function formatBytes(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return EMPTY
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let scaled = number
  let index = 0
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  const digits = index === 0 || scaled >= 100 ? 0 : 1
  return `${stripTrailingZeros(scaled.toFixed(digits))} ${units[index]}`
}

/** 秒数 → `45s` / `3m` / `2h 5m` / `3d 4h`。 */
export function formatUptime(seconds) {
  const total = Math.max(0, Math.round(toNumber(seconds)))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function safeDate(value) {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) return undefined
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** 本地时间 HH:mm:ss。 */
export function formatClock(value, locale) {
  const date = safeDate(value)
  if (date === undefined) return EMPTY
  try {
    return new Intl.DateTimeFormat(locale ?? undefined, { timeStyle: 'medium' }).format(date)
  } catch {
    return date.toLocaleTimeString()
  }
}

/** 本地日期时间（会话更新时间列）。 */
export function formatDateTime(value, locale) {
  const date = safeDate(value)
  if (date === undefined) return EMPTY
  try {
    return new Intl.DateTimeFormat(locale ?? undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

/** 时间线横轴的日期（MM/DD）。 */
export function formatDayLabel(value, locale) {
  const date = safeDate(value)
  if (date === undefined) return EMPTY
  try {
    return new Intl.DateTimeFormat(locale ?? undefined, { month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
}

/* ───────────────────────── 时间线 ───────────────────────── */

/**
 * 把 `timeline.buckets` 映射成可直接写进 SVG 的柱形与折线几何。
 * 坐标为 viewBox 单位（默认 640×150）；空数组返回空几何，不抛错。
 */
export function buildTimelineChart(buckets, options = {}) {
  const source = Array.isArray(buckets) ? buckets : []
  const width = Math.max(1, toNumber(options.width, 640))
  const height = Math.max(1, toNumber(options.height, 150))
  const gap = Math.max(0, toNumber(options.gap, 6))
  const padTop = Math.max(0, toNumber(options.padTop, 8))
  const padBottom = Math.max(0, toNumber(options.padBottom, 6))
  const plot = Math.max(1, height - padTop - padBottom)
  if (source.length === 0) return { width, height, max: 0, bars: [], linePath: '', areaPath: '' }

  const totals = source.map((bucket) => toNumber(bucket?.totalTokens))
  const max = Math.max(0, ...totals)
  const slot = width / source.length
  const barWidth = Math.max(2, slot - gap)
  const baseline = height - padBottom
  const bars = source.map((bucket, index) => {
    const total = totals[index]
    const ratio = max > 0 ? total / max : 0
    const barHeight = max > 0 ? Math.max(total > 0 ? 1 : 0, ratio * plot) : 0
    const x = index * slot + (slot - barWidth) / 2
    return {
      index,
      start: toNumber(bucket?.start),
      total,
      inputTokens: toNumber(bucket?.inputTokens),
      outputTokens: toNumber(bucket?.outputTokens),
      cacheReadTokens: toNumber(bucket?.cacheReadTokens),
      cacheWriteTokens: toNumber(bucket?.cacheWriteTokens),
      cost: toNumber(bucket?.cost),
      ratio,
      x: round2(x),
      y: round2(baseline - barHeight),
      width: round2(barWidth),
      height: round2(barHeight),
    }
  })
  const centerOf = (index) => bars[index].x + bars[index].width / 2
  const topOf = (index) => height - padBottom - bars[index].height
  const linePath = bars
    .map((bar, index) => `${index === 0 ? 'M' : 'L'}${round2(centerOf(index))} ${round2(topOf(index))}`)
    .join(' ')
  const areaPath = `${linePath} L${round2(centerOf(bars.length - 1))} ${round2(baseline)} L${round2(centerOf(0))} ${round2(baseline)} Z`
  return { width, height, max, bars, linePath, areaPath }
}

/** 时间线合计（token / 成本 / 天数 / 峰值）。 */
export function timelineSummary(timeline) {
  const buckets = Array.isArray(timeline?.buckets) ? timeline.buckets : []
  let totalTokens = 0
  let cost = 0
  for (const bucket of buckets) {
    totalTokens += toNumber(bucket?.totalTokens)
    cost += toNumber(bucket?.cost)
  }
  const days = toNumber(timeline?.days, buckets.length) || buckets.length
  const max = buckets.reduce((peak, bucket) => Math.max(peak, toNumber(bucket?.totalTokens)), 0)
  return { days, totalTokens, cost, max, lastStart: buckets.length > 0 ? toNumber(buckets[buckets.length - 1]?.start) : 0 }
}

/* ───────────────────────── 预算 ───────────────────────── */

/** 预算比例：金额为 0/缺失时比例是 0（页面显示「未设置」而不是 0% 崩掉）。 */
export function budgetRatio(spent, amount) {
  const total = Number(amount)
  const used = Number(spent)
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(used) || used <= 0) return 0
  return used / total
}

/** 进度条宽度百分比（0..100），超支封顶到 100 以免溢出容器。 */
export function budgetBarPercent(ratio) {
  const value = Number(ratio)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(100, Math.round(value * 10000) / 100)
}

/** `over` >100%，`warn` ≥80%，`normal` 其余；未配置时为 `unset`。 */
export function budgetTone(ratio, configured = true) {
  if (!configured) return 'unset'
  const value = Number(ratio)
  if (!Number.isFinite(value) || value <= 0) return 'normal'
  if (value > 1) return 'over'
  if (value >= 0.8) return 'warn'
  return 'normal'
}

/** 规整快照里的 `budget` 段，字段缺失也有稳定默认值。 */
export function normalizeBudget(budget) {
  const raw = budget !== null && typeof budget === 'object' ? budget : {}
  const amount = Math.max(0, toNumber(raw.amount))
  const spent = Math.max(0, toNumber(raw.spent))
  const configured = raw.configured === true || (raw.configured === undefined && amount > 0)
  const ratio = budgetRatio(spent, amount)
  const remaining = raw.remaining !== undefined && Number.isFinite(Number(raw.remaining))
    ? Number(raw.remaining)
    : amount - spent
  return {
    configured,
    amount,
    currency: raw.currency === 'USD' ? 'USD' : raw.currency === 'CNY' ? 'CNY' : undefined,
    period: raw.period === 'total' ? 'total' : raw.period === 'month' ? 'month' : 'month',
    spent,
    remaining,
    ratio,
    barPercent: budgetBarPercent(ratio),
    tone: budgetTone(ratio, configured),
    periodStart: toNumber(raw.periodStart),
  }
}

/**
 * 从配置表单快照里读预算字段。
 *
 * 兼容三种形状：根快照 `{value:{usage:{...}}}`、已投影的 scoped 快照
 * `{value:{budget,...}}`、直接取值对象 `{budget,...}`。字段缺失返回 undefined。
 */
export function readUsageSettings(snapshot) {
  let root = snapshot
  if (root !== null && typeof root === 'object' && 'value' in root) root = root.value
  if (root !== null && typeof root === 'object' && root.usage !== undefined) root = root.usage
  const value = root !== null && typeof root === 'object' ? root : {}
  const budget = Number(value.budget)
  return {
    budget: Number.isFinite(budget) && budget >= 0 ? budget : undefined,
    currency: value.currency === 'USD' ? 'USD' : value.currency === 'CNY' ? 'CNY' : undefined,
    period: value.period === 'total' ? 'total' : value.period === 'month' ? 'month' : undefined,
  }
}

/** 轮询间隔：可见时用快照建议值，`document.hidden` 时放慢（乘积至少 30s）。 */
export function pollIntervalMs(snapshot, { hidden = false } = {}) {
  const requested = toNumber(snapshot?.refreshMs, DEFAULT_REFRESH_MS)
  const base = Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, Math.round(requested)))
  if (!hidden) return base
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_HIDDEN_REFRESH_MS, base * HIDDEN_SLOWDOWN))
}

/* ───────────────────────── 会话表 ───────────────────────── */

function sessionTokens(session) {
  const tokens = session?.tokens
  if (tokens !== null && typeof tokens === 'object' && tokens.totalTokens !== undefined) return toNumber(tokens.totalTokens)
  return toNumber(session?.totalTokens)
}

export function sessionMetric(session, key) {
  if (key === 'cost') return toNumber(session?.cost)
  if (key === 'updatedAt') return toNumber(session?.updatedAt)
  if (key === 'title') return String(session?.title ?? '')
  return sessionTokens(session)
}

/** 稳定排序（不修改入参）：默认按 token 降序，同值再按更新时间与 id。 */
export function sortSessions(sessions, sort = {}) {
  const list = Array.isArray(sessions) ? [...sessions] : []
  const key = SESSION_SORT_KEYS.includes(sort.key) ? sort.key : 'totalTokens'
  const direction = sort.direction === 'asc' ? 'asc' : 'desc'
  list.sort((a, b) => {
    let result
    if (key === 'title') result = sessionMetric(a, key).localeCompare(sessionMetric(b, key))
    else result = sessionMetric(a, key) - sessionMetric(b, key)
    if (result === 0) {
      const byTime = toNumber(b?.updatedAt) - toNumber(a?.updatedAt)
      result = byTime !== 0 ? byTime : String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
    }
    return direction === 'asc' ? result : -result
  })
  return list
}

/** 会话计数：总数、活跃（内存中）、子代理。 */
export function sessionStats(sessions, sessionCount) {
  const list = Array.isArray(sessions) ? sessions : []
  let live = 0
  let subagents = 0
  for (const session of list) {
    if (session?.live === true) live += 1
    if (session?.subagent === true) subagents += 1
  }
  return { count: Number.isFinite(Number(sessionCount)) ? Number(sessionCount) : list.length, live, subagents }
}

/* ───────────────────────── CPU ───────────────────────── */

/**
 * `cpu.history` → 迷你曲线几何：两条折线（主进程 / 整机）+ 主进程面积。
 * 统一用一个峰值缩放，两条线可以直接比较。
 */
export function cpuHistorySeries(history, options = {}) {
  const source = Array.isArray(history) ? history : []
  const width = Math.max(1, toNumber(options.width, 260))
  const height = Math.max(1, toNumber(options.height, 48))
  const padTop = Math.max(0, toNumber(options.padTop, 2))
  const padBottom = Math.max(0, toNumber(options.padBottom, 2))
  const samples = source
    .map((sample) => ({
      t: toNumber(sample?.t),
      process: Math.max(0, toNumber(sample?.processPercent)),
      system: Math.max(0, toNumber(sample?.systemPercent)),
      rss: Math.max(0, toNumber(sample?.rss)),
    }))
    .filter((sample) => Number.isFinite(sample.process) && Number.isFinite(sample.system))
  const max = Math.max(1, ...samples.flatMap((sample) => [sample.process, sample.system]))
  const plot = Math.max(1, height - padTop - padBottom)
  const xOf = (index) => (samples.length <= 1 ? width / 2 : (index / (samples.length - 1)) * width)
  const yOf = (value) => height - padBottom - (value / max) * plot
  const pointsOf = (key) => samples.map((sample, index) => `${round2(xOf(index))},${round2(yOf(sample[key]))}`).join(' ')
  const processPoints = pointsOf('process')
  const systemPoints = pointsOf('system')
  const areaPath = samples.length === 0
    ? ''
    : `M${round2(xOf(0))} ${round2(height - padBottom)} L${samples
      .map((sample, index) => `${round2(xOf(index))} ${round2(yOf(sample.process))}`)
      .join(' L')} L${round2(xOf(samples.length - 1))} ${round2(height - padBottom)} Z`
  return {
    width,
    height,
    count: samples.length,
    max,
    samples,
    processPoints,
    systemPoints,
    areaPath,
    sampledAt: samples.length > 0 ? samples[samples.length - 1].t : 0,
  }
}

/** 内存段规整：RSS / 堆 / 整机已用与比例。 */
export function memorySummary(memory) {
  const raw = memory !== null && typeof memory === 'object' ? memory : {}
  const rss = Math.max(0, toNumber(raw.rss))
  const heapUsed = Math.max(0, toNumber(raw.heapUsed))
  const heapTotal = Math.max(0, toNumber(raw.heapTotal))
  const systemTotal = Math.max(0, toNumber(raw.systemTotal))
  const systemFree = Math.max(0, toNumber(raw.systemFree))
  const systemUsed = systemTotal > 0 ? Math.max(0, systemTotal - systemFree) : 0
  return {
    rss,
    heapUsed,
    heapTotal,
    systemTotal,
    systemFree,
    systemUsed,
    heapRatio: heapTotal > 0 ? heapUsed / heapTotal : 0,
    systemRatio: systemTotal > 0 ? systemUsed / systemTotal : 0,
  }
}

/** 扫描统计规整（脚注用）。 */
export function scanSummary(scan) {
  const raw = scan !== null && typeof scan === 'object' ? scan : {}
  return {
    files: toNumber(raw.files),
    parsed: toNumber(raw.parsed),
    cached: toNumber(raw.cached),
    errors: Array.isArray(raw.errors) ? raw.errors.length : toNumber(raw.errors),
  }
}

/** 价格来源（config / default）→ 文案 key。 */
export function pricingSourceKey(pricing) {
  return pricing?.source === 'config' ? 'costSourceConfig' : 'costSourceDefault'
}

/** 时间线柱状图的横轴刻度：最多 7 个，均分。 */
export function timelineTicks(buckets, limit = 7) {
  const source = Array.isArray(buckets) ? buckets : []
  if (source.length === 0) return []
  const count = Math.max(1, Math.min(limit, source.length))
  const step = Math.max(1, Math.ceil(source.length / count))
  const ticks = []
  for (let index = 0; index < source.length; index += step) {
    ticks.push({ index, start: toNumber(source[index]?.start) })
  }
  const last = source.length - 1
  if (ticks[ticks.length - 1]?.index !== last) ticks.push({ index: last, start: toNumber(source[last]?.start) })
  return ticks
}
