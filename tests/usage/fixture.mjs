/**
 * 测试用的真实形状快照（docs/usage/README.md 的 HTTP 契约）：
 * 14 天时间线、3 个会话、预算接近 0 的进度、CPU 历史与扫描统计。
 * 不联网络，只给 jsdom 渲染测试当 fetch 返回体。
 */
const GENERATED_AT = Date.UTC(2026, 10, 3, 6, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const TOTAL_TOKENS = 1234567

const WEIGHTS = [100000, 80000, 120000, 60000, 90000, 40000, 150000, 70000, 110000, 95000, 85000, 75000, 65000, 94567]

function createBuckets() {
  return WEIGHTS.map((totalTokens, index) => ({
    start: GENERATED_AT - (WEIGHTS.length - 1 - index) * DAY,
    inputTokens: Math.round(totalTokens * 0.01),
    outputTokens: Math.round(totalTokens * 0.036),
    cacheReadTokens: Math.round(totalTokens * 0.94),
    cacheWriteTokens: Math.max(0, totalTokens - Math.round(totalTokens * 0.01) - Math.round(totalTokens * 0.036) - Math.round(totalTokens * 0.94)),
    totalTokens,
    cost: Number((totalTokens * 0.0123 / TOTAL_TOKENS).toFixed(8)),
  }))
}

const SESSIONS = [
  {
    id: 'session-4333208a-1111',
    title: 'Greeting',
    cwd: 'D:\\项目\\dsh-toolkit',
    createdAt: GENERATED_AT - 3600 * 1000,
    updatedAt: GENERATED_AT - 1000,
    provider: 'turing',
    model: 'deepseek-flash',
    live: true,
    subagent: false,
    turns: 1,
    steps: 3,
    tokens: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 500000, cacheWriteTokens: 4000, totalTokens: 507000 },
    totalTokens: 507000,
    cost: 0.005,
    unpricedTokens: 0,
  },
  {
    id: 'session-4333208a-2222',
    title: 'Sub agent task',
    cwd: 'D:\\项目\\dsh-toolkit',
    createdAt: GENERATED_AT - 7200 * 1000,
    updatedAt: GENERATED_AT - 60 * 1000,
    provider: 'turing',
    model: 'deepseek-flash',
    live: false,
    subagent: true,
    turns: 4,
    steps: 9,
    tokens: { inputTokens: 5000, outputTokens: 20000, cacheReadTokens: 420000, cacheWriteTokens: 5000, totalTokens: 450000 },
    totalTokens: 450000,
    cost: 0.004,
    unpricedTokens: 0,
  },
  {
    id: 'session-4333208a-3333',
    title: 'Tiny task',
    cwd: 'C:\\Users\\demo\\project',
    createdAt: GENERATED_AT - 4 * DAY,
    updatedAt: GENERATED_AT - 3 * DAY,
    provider: 'turing',
    model: 'deepseek-flash',
    live: false,
    subagent: false,
    turns: 2,
    steps: 4,
    tokens: { inputTokens: 6000, outputTokens: 23000, cacheReadTokens: 240000, cacheWriteTokens: 8567, totalTokens: 277567 },
    totalTokens: 277567,
    cost: 0.0033,
    unpricedTokens: 0,
  },
]

const CPU_HISTORY = [
  { t: GENERATED_AT - 10000, processPercent: 1.5, systemPercent: 10.4, rss: 260000000 },
  { t: GENERATED_AT - 8000, processPercent: 2.1, systemPercent: 11, rss: 262000000 },
  { t: GENERATED_AT - 6000, processPercent: 3.2, systemPercent: 12.5, rss: 264000000 },
  { t: GENERATED_AT - 4000, processPercent: 2.8, systemPercent: 13, rss: 266000000 },
  { t: GENERATED_AT - 2000, processPercent: 4, systemPercent: 12.2, rss: 267000000 },
  { t: GENERATED_AT, processPercent: 3.2, systemPercent: 12.5, rss: 268435456 },
]

export function createSnapshot(overrides = {}) {
  const snapshot = {
    ok: true,
    generatedAt: GENERATED_AT,
    refreshMs: 8000,
    sessionCount: 3,
    totals: {
      inputTokens: 12000,
      outputTokens: 45000,
      cacheReadTokens: 1160000,
      cacheWriteTokens: 17567,
      totalTokens: TOTAL_TOKENS,
    },
    cost: { amount: 0.0123, currency: 'CNY', unpricedTokens: 0 },
    budget: {
      amount: 100,
      currency: 'CNY',
      period: 'month',
      spent: 0.0123,
      remaining: 99.9877,
      ratio: 0.000123,
      periodStart: GENERATED_AT - 3 * DAY,
      configured: true,
    },
    timeline: { bucket: 'day', days: 14, buckets: createBuckets() },
    sessions: SESSIONS.map((session) => ({ ...session, tokens: { ...session.tokens } })),
    cpu: {
      processPercent: 3.2,
      systemPercent: 12.5,
      cores: 16,
      load: [1.2, 0.9, 0.7],
      memory: {
        rss: 268435456,
        heapUsed: 67108864,
        heapTotal: 134217728,
        systemTotal: 34359738368,
        systemFree: 17179869184,
      },
      uptimeSec: 3660,
      sampledAt: GENERATED_AT,
      warmingUp: false,
      history: CPU_HISTORY.map((sample) => ({ ...sample })),
    },
    pricing: {
      currency: 'CNY',
      source: 'default',
      models: [{ provider: '*', model: 'deepseek-flash', input: 2, output: 3, cacheRead: 0.2, cacheWrite: 2 }],
    },
    scan: {
      home: 'D:\\DeepSeekHarnessHome',
      sessionDirs: 3,
      files: 3,
      parsed: 3,
      cached: 0,
      skipped: 0,
      errors: [],
    },
  }
  return { ...snapshot, ...overrides }
}

/** fetchJson 能吃的 Response 形状（不依赖网络/undici）。 */
export function okResponse(payload) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => payload }
}

export function errorResponse(message, status = 500) {
  return { ok: false, status, headers: new Headers(), json: async () => ({ ok: false, error: message }) }
}
