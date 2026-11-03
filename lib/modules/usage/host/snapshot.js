/**
 * Assemble the usage snapshot payload defined in docs/usage/README.md.
 *
 * Pure function: every input is passed in by the module entry (settings,
 * scan result, CPU snapshot, timestamp), so the payload shape and all
 * cost/budget/timeline math are unit-testable without a live host.
 */
import {
  addTokens,
  copyTokens,
  costForModelBuckets,
  effectivePrices,
  normalizePrices,
  round6,
  totalTokens,
  zeroTokens,
} from "./pricing.js";
import { addLocalDays, localDayStart, localMonthStart } from "./time.js";

const MAX_HISTORY = 60;

/**
 * Build the complete `GET /_dsh/dsh-toolkit/usage/snapshot` payload.
 * @param {{
 *   config?: object,
 *   scan?: {home?: string, sessions?: object[], scan?: object},
 *   cpu?: object,
 *   generatedAt?: number,
 * }} input
 * @returns {object}
 */
export function buildSnapshot(input = {}) {
  const settings = input.config ?? {};
  const generatedAt = Number.isFinite(input.generatedAt) ? Number(input.generatedAt) : Date.now();
  const currency = settings.currency === "USD" ? "USD" : "CNY";
  const period = settings.period === "total" ? "total" : "month";
  const refreshMs = clampInt(settings.refreshMs, 2_000, 120_000, 8_000);
  const historyDays = clampInt(settings.historyDays, 1, 90, 14);
  const includeSubagents = settings.includeSubagents !== false;
  const budgetAmount = nonNegative(settings.budget, 100);
  const { prices, source } = effectivePrices(settings.prices, currency);

  const allSessions = Array.isArray(input.scan?.sessions) ? input.scan.sessions : [];
  const included = allSessions.filter((session) => includeSubagents || session?.subagent !== true);

  // Global per-model buckets feed the totals and the whole-history cost.
  const modelBuckets = new Map();
  // Per-day per-model buckets feed the timeline and the budget period spend.
  const dayModels = new Map();
  for (const session of included) {
    for (const bucket of session?.byModel ?? []) addBucket(modelBuckets, bucket);
    const days = session?.dayBuckets;
    if (!(days instanceof Map)) continue;
    for (const [day, models] of days) {
      let target = dayModels.get(day);
      if (target === undefined) {
        target = new Map();
        dayModels.set(day, target);
      }
      for (const bucket of models.values()) addBucket(target, bucket);
    }
  }

  const totals = zeroTokens();
  for (const bucket of modelBuckets.values()) addTokens(totals, bucket.tokens);
  const costResult = costForModelBuckets(modelBuckets.values(), prices);

  const sessions = included.map((session) => {
    const tokens = copyTokens(session?.tokens);
    const sessionCost = costForModelBuckets(session?.byModel ?? [], prices);
    return {
      id: session?.id ?? "",
      title: session?.title ?? null,
      cwd: session?.cwd ?? null,
      createdAt: integer(session?.createdAt),
      updatedAt: integer(session?.updatedAt),
      provider: session?.provider ?? null,
      model: session?.model ?? null,
      live: session?.live === true,
      subagent: session?.subagent === true,
      turns: integer(session?.turns),
      steps: integer(session?.steps),
      tokens,
      totalTokens: totalTokens(tokens),
      cost: round6(sessionCost.amount),
      unpricedTokens: integer(sessionCost.unpricedTokens),
    };
  });
  sessions.sort((left, right) => (right.totalTokens - left.totalTokens) || (right.updatedAt - left.updatedAt));

  const timeline = buildTimeline(dayModels, prices, generatedAt, historyDays);

  const periodStart = period === "month" ? localMonthStart(generatedAt) : 0;
  let spent = 0;
  for (const [day, models] of dayModels) {
    if (period === "month" && day < periodStart) continue;
    spent += costForModelBuckets(models.values(), prices).amount;
  }
  const ratio = budgetAmount > 0 ? round6(spent / budgetAmount) : 0;

  return {
    ok: true,
    generatedAt,
    refreshMs,
    sessionCount: sessions.length,
    totals: { ...totals, totalTokens: totalTokens(totals) },
    cost: {
      amount: round6(costResult.amount),
      currency,
      unpricedTokens: integer(costResult.unpricedTokens),
    },
    budget: {
      amount: round6(budgetAmount),
      currency,
      period,
      spent: round6(spent),
      remaining: round6(budgetAmount - spent),
      ratio,
      periodStart,
      configured: budgetAmount > 0,
    },
    timeline,
    sessions,
    cpu: normalizeCpu(input.cpu, generatedAt),
    pricing: {
      currency,
      source,
      models: tableModels(prices),
    },
    scan: normalizeScan(input.scan),
  };
}

function addBucket(target, bucket) {
  if (bucket === null || typeof bucket !== "object") return;
  const key = `${bucket.provider ?? ""}\u0000${bucket.model ?? ""}`;
  let existing = target.get(key);
  if (existing === undefined) {
    existing = { provider: bucket.provider ?? null, model: bucket.model ?? null, tokens: zeroTokens() };
    target.set(key, existing);
  }
  addTokens(existing.tokens, bucket.tokens);
}

function buildTimeline(dayModels, prices, generatedAt, historyDays) {
  const todayStart = localDayStart(generatedAt);
  const buckets = [];
  for (let offset = historyDays - 1; offset >= 0; offset -= 1) {
    const start = addLocalDays(todayStart, -offset);
    const models = dayModels.get(start);
    const tokens = zeroTokens();
    if (models !== undefined) {
      for (const bucket of models.values()) addTokens(tokens, bucket.tokens);
    }
    const cost = costForModelBuckets(models === undefined ? [] : models.values(), prices);
    buckets.push({
      start,
      ...tokens,
      totalTokens: totalTokens(tokens),
      cost: round6(cost.amount),
    });
  }
  return { bucket: "day", days: historyDays, buckets };
}

function normalizeCpu(cpu, generatedAt) {
  const history = Array.isArray(cpu?.history) ? cpu.history.slice(-MAX_HISTORY) : [];
  return {
    processPercent: round1(cpu?.processPercent),
    systemPercent: round1(cpu?.systemPercent),
    cores: integer(cpu?.cores),
    load: normalizeLoad(cpu?.load),
    memory: {
      rss: integer(cpu?.memory?.rss),
      heapUsed: integer(cpu?.memory?.heapUsed),
      heapTotal: integer(cpu?.memory?.heapTotal),
      systemTotal: integer(cpu?.memory?.systemTotal),
      systemFree: integer(cpu?.memory?.systemFree),
    },
    uptimeSec: round1(cpu?.uptimeSec),
    sampledAt: integer(cpu?.sampledAt) || generatedAt,
    warmingUp: cpu?.warmingUp !== false,
    history: history.map((sample) => ({
      t: integer(sample?.t),
      processPercent: round1(sample?.processPercent),
      systemPercent: round1(sample?.systemPercent),
      rss: integer(sample?.rss),
    })),
  };
}

function normalizeScan(scan) {
  const stats = scan?.scan ?? scan ?? {};
  const errors = Array.isArray(stats.errors)
    ? stats.errors.filter((error) => typeof error === "string").slice(0, 40)
    : [];
  return {
    home: typeof stats.home === "string" ? stats.home : typeof scan?.home === "string" ? scan.home : "",
    sessionDirs: integer(stats.sessionDirs),
    files: integer(stats.files),
    parsed: integer(stats.parsed),
    cached: integer(stats.cached),
    skipped: integer(stats.skipped),
    errors,
  };
}

function tableModels(prices) {
  return normalizePrices(prices).map((price) => ({
    provider: price.provider,
    model: price.model,
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
  }));
}

function normalizeLoad(load) {
  const values = Array.isArray(load) ? load.slice(0, 3) : [];
  while (values.length < 3) values.push(0);
  return values.map((value) => round2(value));
}

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function round1(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10) / 10;
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}
