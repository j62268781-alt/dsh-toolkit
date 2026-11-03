/**
 * 根配置里的 `usage` 命名空间（token 用量统计模块）。
 *
 * 每个叶子都标 `.volatile()`：DSH 的设置页只允许写 volatile 字段，非 volatile 字段在
 * 表单里是只读的。volatile 值不会重建 Loader entry，所以 Host 每次请求都用
 * `readUsageConfig()` 现取（`Volatile.get()`），设置页保存后下一次轮询即生效。
 *
 * `prices` 以「每 1M token 的货币金额」为单位；空数组 = 用 pricing.js 的内置默认表。
 */
import s from '@deepseek-ai/schemastery'

/** 一条模型单价；provider/model 支持 `*` 通配。 */
const Price = s.object({
  provider: s.string().default('*'),
  model: s.string().default('*'),
  input: s.number().min(0).default(0),
  output: s.number().min(0).default(0),
  cacheRead: s.number().min(0).default(0),
  cacheWrite: s.number().min(0).default(0),
})

export const Config = s.object({
  /** 预算总额，0 = 未设置（页面显示「未设置预算」）。 */
  budget: s.number().min(0).default(100).volatile(),
  /** 成本与预算的货币。 */
  currency: s.union(['CNY', 'USD']).default('CNY').volatile(),
  /** 预算周期：month = 本自然月，total = 全部历史。 */
  period: s.union(['month', 'total']).default('month').volatile(),
  /** 时间线回看天数（1..90）。 */
  historyDays: s.natural().min(1).max(90).default(14).volatile(),
  /** 建议的客户端轮询间隔（毫秒）。 */
  refreshMs: s.natural().min(2000).max(120000).default(8000).volatile(),
  /** 是否把子代理会话计入总量与会话数。 */
  includeSubagents: s.boolean().default(true).volatile(),
  /** 自定义单价表；空 = 内置默认表。 */
  prices: s.array(Price).default([]).volatile(),
})

/** volatile 字段现取；普通值原样返回。 */
function live(field, fallback) {
  try {
    if (field !== null && typeof field === 'object' && typeof field.get === 'function') {
      const value = field.get()
      return value === undefined ? fallback : value
    }
    return field === undefined ? fallback : field
  } catch {
    return fallback
  }
}

/**
 * 把 `apply(ctx, config)` 收到的原始配置投影成可用的普通对象。
 * @param {Record<string, unknown>} [config]
 */
export function readUsageConfig(config) {
  const raw = config ?? {}
  const prices = live(raw.prices, [])
  const days = live(raw.historyDays, 14)
  const refreshMs = live(raw.refreshMs, 8000)
  const budget = live(raw.budget, 100)
  return {
    budget: Number.isFinite(budget) && budget >= 0 ? budget : 100,
    currency: live(raw.currency, 'CNY') === 'USD' ? 'USD' : 'CNY',
    period: live(raw.period, 'month') === 'total' ? 'total' : 'month',
    historyDays: clampInt(days, 1, 90, 14),
    refreshMs: clampInt(refreshMs, 2000, 120000, 8000),
    includeSubagents: live(raw.includeSubagents, true) !== false,
    prices: Array.isArray(prices) ? prices : [],
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}
