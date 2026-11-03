import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot } from "../../src/modules/usage/host/snapshot.js";
import { totalTokens } from "../../src/modules/usage/host/pricing.js";
import { addLocalDays, localDayStart } from "../../src/modules/usage/host/time.js";

const generatedAt = new Date(2026, 10, 3, 12, 0, 0).getTime(); // local 2026-11-03 12:00
const today = localDayStart(generatedAt);
const yesterday = addLocalDays(today, -1);
const monthStart = new Date(2026, 10, 1).getTime();

const config = {
  budget: 100,
  currency: "CNY",
  period: "month",
  historyDays: 3,
  refreshMs: 8_000,
  includeSubagents: true,
  prices: [],
};

function tokenSet(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens = 0) {
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function session({ id, tokens, day, provider = "turing", model = "deepseek-flash", subagent = false, live = false, title, createdAt = day, updatedAt = day, turns = 0, steps = 0 }) {
  const bucket = { provider, model, tokens };
  return {
    id,
    title: title ?? id,
    cwd: "D:\\ws",
    createdAt,
    updatedAt,
    provider,
    model,
    live,
    subagent,
    turns,
    steps,
    tokens,
    totalTokens: totalTokens(tokens),
    byModel: [bucket],
    dayBuckets: new Map([[day, new Map([[`${provider}\u0000${model}`, bucket]])]]),
  };
}

const mainSession = session({ id: "session-main", tokens: tokenSet(100, 50, 1_000), day: yesterday, turns: 2, steps: 3, live: true });
const subSession = session({ id: "sub-1", tokens: tokenSet(10, 5, 0), day: today, provider: "solar", model: "qoder/deepseek-flash", subagent: true });
const scan = {
  home: "D:\\DeepSeekHarness-home",
  sessions: [mainSession, subSession],
  scan: { home: "D:\\DeepSeekHarness-home", sessionDirs: 2, files: 2, parsed: 2, cached: 0, skipped: 0, errors: [] },
};
const cpu = {
  processPercent: 3.24,
  systemPercent: 12.46,
  cores: 12,
  load: [0.5, 0.25, 0.125],
  memory: { rss: 1_000, heapUsed: 500, heapTotal: 800, systemTotal: 16_000, systemFree: 4_000 },
  uptimeSec: 3_600.42,
  sampledAt: generatedAt - 1_000,
  warmingUp: false,
  history: [{ t: generatedAt - 3_000, processPercent: 2.1, systemPercent: 10.4, rss: 900 }],
};

test("payload has the exact documented shape and consistent totals/cost/budget", () => {
  const snapshot = buildSnapshot({ config, scan, cpu, generatedAt });
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "budget", "cost", "cpu", "generatedAt", "ok", "pricing", "refreshMs", "scan", "sessionCount", "sessions", "timeline", "totals",
  ]);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.generatedAt, generatedAt);
  assert.equal(snapshot.refreshMs, 8_000);
  assert.equal(snapshot.sessionCount, 2);
  assert.deepEqual(snapshot.totals, {
    inputTokens: 110, outputTokens: 55, cacheReadTokens: 1_000, cacheWriteTokens: 0, totalTokens: 1_165,
  });
  // (110*2 + 55*8 + 1000*0.04) / 1e6
  assert.equal(snapshot.cost.amount, 0.0007);
  assert.equal(snapshot.cost.currency, "CNY");
  assert.equal(snapshot.cost.unpricedTokens, 0);

  assert.deepEqual(snapshot.pricing, {
    currency: "CNY",
    source: "default",
    models: [
      { provider: "*", model: "deepseek-flash", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 },
      { provider: "*", model: "*", input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 },
    ],
  });

  assert.deepEqual(snapshot.scan, {
    home: "D:\\DeepSeekHarness-home", sessionDirs: 2, files: 2, parsed: 2, cached: 0, skipped: 0, errors: [],
  });
});

test("budget reports period start, spend, remaining and ratio", () => {
  const { budget } = buildSnapshot({ config, scan, cpu, generatedAt });
  assert.deepEqual(budget, {
    amount: 100,
    currency: "CNY",
    period: "month",
    spent: 0.0007,
    remaining: 99.9993,
    ratio: 0.000007,
    periodStart: monthStart,
    configured: true,
  });
});

test("timeline buckets are contiguous local days ending today, with per-bucket cost", () => {
  const { timeline } = buildSnapshot({ config, scan, cpu, generatedAt });
  assert.equal(timeline.bucket, "day");
  assert.equal(timeline.days, 3);
  assert.equal(timeline.buckets.length, 3);
  assert.equal(timeline.buckets[2].start, today);
  for (let index = 1; index < timeline.buckets.length; index += 1) {
    assert.equal(timeline.buckets[index].start, addLocalDays(timeline.buckets[index - 1].start, 1));
  }
  const [first, second, last] = timeline.buckets;
  assert.equal(first.totalTokens, 0);
  assert.equal(first.cost, 0);
  assert.deepEqual(second, { start: yesterday, inputTokens: 100, outputTokens: 50, cacheReadTokens: 1_000, cacheWriteTokens: 0, totalTokens: 1_150, cost: 0.00064 });
  assert.deepEqual(last, { start: today, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15, cost: 0.00006 });
  assert.equal(timeline.buckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0), 1_165);
});

test("sessions are sorted by tokens and expose per-session cost", () => {
  const { sessions } = buildSnapshot({ config, scan, cpu, generatedAt });
  assert.deepEqual(sessions.map((session) => session.id), ["session-main", "sub-1"]);
  assert.deepEqual(sessions[0], {
    id: "session-main",
    title: "session-main",
    cwd: "D:\\ws",
    createdAt: yesterday,
    updatedAt: yesterday,
    provider: "turing",
    model: "deepseek-flash",
    live: true,
    subagent: false,
    turns: 2,
    steps: 3,
    tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1_000, cacheWriteTokens: 0 },
    totalTokens: 1_150,
    cost: 0.00064,
    unpricedTokens: 0,
  });
  assert.equal(sessions[1].totalTokens, 15);
  assert.equal(sessions[1].cost, 0.00006);
});

test("includeSubagents=false removes subagent sessions from every aggregate", () => {
  const snapshot = buildSnapshot({ config: { ...config, includeSubagents: false }, scan, cpu, generatedAt });
  assert.equal(snapshot.sessionCount, 1);
  assert.deepEqual(snapshot.sessions.map((session) => session.id), ["session-main"]);
  assert.equal(snapshot.totals.totalTokens, 1_150);
  assert.equal(snapshot.cost.amount, 0.00064);
  assert.equal(snapshot.budget.spent, 0.00064);
  assert.equal(snapshot.timeline.buckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0), 1_150);
});

test("budget=0 is reported as unconfigured, period=total spends all history", () => {
  const unconfigured = buildSnapshot({ config: { ...config, budget: 0 }, scan, cpu, generatedAt });
  assert.equal(unconfigured.budget.amount, 0);
  assert.equal(unconfigured.budget.configured, false);
  assert.equal(unconfigured.budget.ratio, 0);
  assert.equal(unconfigured.budget.remaining, -0.0007);

  const total = buildSnapshot({ config: { ...config, period: "total" }, scan, cpu, generatedAt });
  assert.equal(total.budget.period, "total");
  assert.equal(total.budget.periodStart, 0);
  assert.equal(total.budget.spent, 0.0007);
});

test("currency=USD uses the built-in USD default table", () => {
  const snapshot = buildSnapshot({ config: { ...config, currency: "USD" }, scan, cpu, generatedAt });
  assert.equal(snapshot.pricing.currency, "USD");
  assert.equal(snapshot.pricing.models[0].input, 0.3);
  assert.equal(snapshot.cost.currency, "USD");
  // (110*0.3 + 55*1.2 + 1000*0.006) / 1e6
  assert.equal(snapshot.cost.amount, 0.000105);
});

test("a configured price table wins and unmatched models count as unpricedTokens", () => {
  const prices = [{ provider: "turing", model: "deepseek-flash", input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }];
  const snapshot = buildSnapshot({ config: { ...config, prices }, scan, cpu, generatedAt });
  assert.equal(snapshot.pricing.source, "config");
  assert.deepEqual(snapshot.pricing.models, [{ provider: "turing", model: "deepseek-flash", input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }]);
  // 100*1 + 50*2 = 200 / 1e6; the solar session has no matching row.
  assert.equal(snapshot.cost.amount, 0.0002);
  assert.equal(snapshot.cost.unpricedTokens, 15);
  const sub = snapshot.sessions.find((session) => session.id === "sub-1");
  assert.equal(sub.cost, 0);
  assert.equal(sub.unpricedTokens, 15);
});

test("cacheWriteTokens are priced at the cacheWrite rate", () => {
  const writeSession = session({ id: "session-write", tokens: tokenSet(0, 0, 0, 10), day: today });
  const snapshot = buildSnapshot({ config, scan: { ...scan, sessions: [writeSession] }, generatedAt });
  assert.equal(snapshot.totals.totalTokens, 10);
  assert.equal(snapshot.cost.amount, 0.00002); // 10 * 2 / 1e6
});

test("config bounds are clamped and the timeline stays contiguous", () => {
  const low = buildSnapshot({ config: { ...config, refreshMs: 10, historyDays: 0 }, scan, cpu, generatedAt });
  assert.equal(low.refreshMs, 2_000);
  assert.equal(low.timeline.days, 1);
  assert.equal(low.timeline.buckets.length, 1);
  assert.equal(low.timeline.buckets[0].start, today);

  const high = buildSnapshot({ config: { ...config, refreshMs: 999_999, historyDays: 500 }, scan, cpu, generatedAt });
  assert.equal(high.refreshMs, 120_000);
  assert.equal(high.timeline.days, 90);
  assert.equal(high.timeline.buckets.at(-1).start, today);
});

test("cpu history is capped at 60 and rounded to the documented precision", () => {
  const history = Array.from({ length: 100 }, (_, index) => ({
    t: generatedAt - (100 - index) * 2_000,
    processPercent: 1.26,
    systemPercent: 2.34,
    rss: 100 + index,
  }));
  const snapshot = buildSnapshot({ config, scan, cpu: { ...cpu, history }, generatedAt });
  assert.equal(snapshot.cpu.history.length, 60);
  assert.deepEqual(snapshot.cpu.history[0], { t: generatedAt - 60 * 2_000, processPercent: 1.3, systemPercent: 2.3, rss: 140 });
  assert.equal(snapshot.cpu.processPercent, 3.2);
  assert.equal(snapshot.cpu.systemPercent, 12.5);
  assert.equal(snapshot.cpu.uptimeSec, 3_600.4);
  assert.deepEqual(snapshot.cpu.load, [0.5, 0.25, 0.13]);
});

test("missing services and data degrade to a valid ok payload", () => {
  const snapshot = buildSnapshot({});
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.sessionCount, 0);
  assert.deepEqual(snapshot.sessions, []);
  assert.deepEqual(snapshot.totals, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
  assert.equal(snapshot.cost.amount, 0);
  assert.equal(snapshot.budget.amount, 100);
  assert.equal(snapshot.budget.configured, true);
  assert.equal(snapshot.timeline.days, 14);
  assert.equal(snapshot.timeline.buckets.length, 14);
  assert.equal(snapshot.scan.home, "");
  assert.equal(snapshot.cpu.warmingUp, true);
  assert.deepEqual(snapshot.cpu.memory, { rss: 0, heapUsed: 0, heapTotal: 0, systemTotal: 0, systemFree: 0 });
  assert.deepEqual(snapshot.cpu.history, []);
});

test("scan errors are filtered, capped and never break the payload", () => {
  const errors = [...Array.from({ length: 60 }, (_, index) => `session-${index}: bad`), null, 42];
  const snapshot = buildSnapshot({
    config, scan: { ...scan, scan: { ...scan.scan, errors } }, generatedAt,
  });
  assert.equal(snapshot.scan.errors.length, 40);
  for (const error of snapshot.scan.errors) assert.equal(typeof error, "string");
});
