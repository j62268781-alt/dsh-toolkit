import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zstdCompressSync } from "node:zlib";
import { ZSTD_MAGIC } from "../../src/modules/usage/host/log.js";
import { addLocalDays, localDayStart } from "../../src/modules/usage/host/time.js";
import {
  UsageScanner,
  discoverSessionLogs,
  readProjcache,
  resolveDshHome,
} from "../../src/modules/usage/host/scan.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const today = localDayStart(Date.now());
const T3 = addLocalDays(today, -3) + 12 * 60 * 60 * 1000;
const T2 = addLocalDays(today, -2) + 12 * 60 * 60 * 1000;
const T1 = addLocalDays(today, -1) + 12 * 60 * 60 * 1000;

const headerEvent = (id, createdAt, cwd, extra = {}) => ({ type: "session", version: 4, id, createdAt, cwd, isSeeded: false, delegationDepth: 0, ...extra });
const usageEvent = (seq, time, inputTokens, outputTokens, cacheReadTokens, provider, model) => ({
  type: "assistant/message",
  seq,
  time,
  data: {
    message: { source: { kind: "model", provider, model } },
    usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens: 0 },
  },
});

async function writeLog(dir, events) {
  await mkdir(dir, { recursive: true });
  const frames = events.map((event) => zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`)));
  await writeFile(join(dir, "session.v4.jsonl.zstd"), Buffer.concat(frames));
}

async function writeProjcache(cacheDir, id, { createdAt, cwd = "D:\\ws", tokens = {}, title = null, turns = 0, steps = 0, provider = "turing", model = "deepseek-flash", subagent = {} }) {
  await mkdir(cacheDir, { recursive: true });
  const record = {
    identity: { formatVersion: 4, createdAt, cwd },
    rows: {
      tokenUsage: {
        val: {
          totals: {
            uncachedInputTokens: tokens.input ?? 0,
            outputTokens: tokens.output ?? 0,
            cacheReadTokens: tokens.cacheRead ?? 0,
            cacheWriteTokens: tokens.cacheWrite ?? 0,
          },
        },
      },
      title: { val: title },
      sessionStats: { val: { turns, steps } },
      modelSelection: { val: { lastUsed: provider === null ? null : { provider, model } } },
      subagent: { val: subagent },
    },
  };
  await writeFile(join(cacheDir, `${id}.json`), JSON.stringify({ record }));
}

async function createHome(t) {
  const home = await mkdtemp(join(tmpdir(), "dsh-usage-scan-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const wsA = join(home, "sessions", "--D~9879~76EE-ws--");
  const wsB = join(home, "sessions", "--D-other--");
  await mkdir(wsA, { recursive: true });
  await mkdir(wsB, { recursive: true });

  await writeLog(join(wsA, "session-main"), [
    headerEvent("session-main", T3, "D:\\ws"),
    { type: "turn/start", seq: 0, time: T3, data: { turn: 1 } },
    usageEvent(1, T3, 100, 10, 1_000, "turing", "deepseek-flash"),
    usageEvent(2, T2, 200, 20, 2_000, "turing", "deepseek-flash"),
    { type: "session/title", seq: 3, time: T3, data: { title: "Main session" } },
    { type: "step/end", seq: 4, time: T3, data: { turn: 1, step: 1 } },
    { type: "step/end", seq: 5, time: T2, data: { turn: 1, step: 2 } },
    { type: "turn/end", seq: 6, time: T2, data: {} },
  ]);

  await writeLog(join(wsB, "sub-1"), [
    headerEvent("sub-1", T1, "D:\\ws", { origin: "subagent", delegationDepth: 1, parentSession: "session-main" }),
    { type: "turn/start", seq: 0, time: T1, data: { turn: 1 } },
    usageEvent(1, T1, 50, 5, 500, "solar", "qoder/deepseek-flash"),
  ]);

  // Unreadable log: a lone magic header followed by garbage must fall back to projcache.
  await mkdir(join(wsA, "dead-1"), { recursive: true });
  await writeFile(join(wsA, "dead-1", "session.v4.jsonl.zstd"), Buffer.concat([ZSTD_MAGIC, Buffer.from("not a zstd frame at all")]));

  // No log at all: projcache is the only source left.
  await mkdir(join(wsB, "empty-1"), { recursive: true });

  const cacheDir = join(home, "storages", "session_projcache", "sessions");
  await writeProjcache(cacheDir, "session-main", { createdAt: T3, tokens: { input: 999, output: 99, cacheRead: 9_999 }, title: "Stale cache title", turns: 9, steps: 9 });
  await writeProjcache(cacheDir, "dead-1", { createdAt: T1, tokens: { input: 7, output: 3, cacheRead: 70, cacheWrite: 2 }, title: "Dead", turns: 2, steps: 3 });
  await writeProjcache(cacheDir, "empty-1", { createdAt: T2, tokens: {} });

  return home;
}

function byId(sessions) {
  return new Map(sessions.map((session) => [session.id, session]));
}

test("discovery finds every session directory and its log file", async (t) => {
  const home = await createHome(t);
  const discovery = await discoverSessionLogs(home);
  assert.equal(discovery.sessionDirs, 4);
  assert.equal(discovery.files, 3);
  assert.deepEqual(discovery.sessions.map((session) => session.id).sort(), ["dead-1", "empty-1", "session-main", "sub-1"]);
});

test("scan aggregates per-session tokens, turns/steps, titles and live/subagent flags", async (t) => {
  const home = await createHome(t);
  const scanner = new UsageScanner();
  t.after(() => scanner.dispose());
  const { sessions, scan } = await scanner.scan({ home });
  const map = byId(sessions);
  assert.equal(sessions.length, 4);
  assert.equal(scan.home, home);
  assert.equal(scan.sessionDirs, 4);
  assert.equal(scan.files, 3);
  assert.equal(scan.parsed, 2);
  assert.equal(scan.cached, 0);
  assert.equal(scan.skipped, 2);
  assert.ok(scan.errors.some((error) => error.startsWith("dead-1:")));

  const main = map.get("session-main");
  assert.deepEqual(main.tokens, { inputTokens: 300, outputTokens: 30, cacheReadTokens: 3_000, cacheWriteTokens: 0 });
  assert.equal(main.totalTokens, 3_330);
  assert.equal(main.usageEvents, 2);
  assert.equal(main.title, "Main session");
  assert.equal(main.cwd, "D:\\ws");
  assert.equal(main.createdAt, T3);
  assert.equal(main.turns, 1);
  assert.equal(main.steps, 2);
  assert.equal(main.provider, "turing");
  assert.equal(main.model, "deepseek-flash");
  assert.equal(main.live, false);
  assert.equal(main.subagent, false);
  // The stale projcache totals (999/99/9999) must not override the log.
  assert.notEqual(main.tokens.inputTokens, 999);

  const mainDayTokens = new Map();
  for (const [day, models] of main.dayBuckets) {
    let total = 0;
    for (const bucket of models.values()) {
      total += bucket.tokens.inputTokens + bucket.tokens.outputTokens + bucket.tokens.cacheReadTokens + bucket.tokens.cacheWriteTokens;
    }
    mainDayTokens.set(day, total);
  }
  assert.equal(mainDayTokens.size, 2);
  assert.equal(mainDayTokens.get(localDayStart(T3)), 1_110);
  assert.equal(mainDayTokens.get(localDayStart(T2)), 2_220);
  assert.equal([...mainDayTokens.values()].reduce((sum, value) => sum + value, 0), 3_330);

  const sub = map.get("sub-1");
  assert.equal(sub.subagent, true);
  assert.equal(sub.provider, "solar");
  assert.equal(sub.model, "qoder/deepseek-flash");
  assert.deepEqual(sub.tokens, { inputTokens: 50, outputTokens: 5, cacheReadTokens: 500, cacheWriteTokens: 0 });
});

test("unreadable and missing logs fall back to the projection cache", async (t) => {
  const home = await createHome(t);
  const scanner = new UsageScanner();
  t.after(() => scanner.dispose());
  const { sessions } = await scanner.scan({ home });
  const map = byId(sessions);

  const dead = map.get("dead-1");
  assert.deepEqual(dead.tokens, { inputTokens: 7, outputTokens: 3, cacheReadTokens: 70, cacheWriteTokens: 2 });
  assert.equal(dead.totalTokens, 82);
  assert.equal(dead.title, "Dead");
  assert.equal(dead.turns, 2);
  assert.equal(dead.steps, 3);
  assert.equal(dead.provider, "turing");

  const empty = map.get("empty-1");
  assert.deepEqual(empty.tokens, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(empty.createdAt, T2);
});

test("parsed records are cached by path+mtime+size and reused without reparsing", async (t) => {
  const home = await createHome(t);
  const scanner = new UsageScanner();
  t.after(() => scanner.dispose());
  const first = await scanner.scan({ home });
  assert.equal(first.scan.parsed, 2);
  const second = await scanner.scan({ home });
  assert.equal(second.scan.parsed, 0);
  assert.equal(second.scan.cached, 2);
  assert.equal(second.scan.skipped, 2);
  assert.deepEqual(second.sessions, first.sessions);
});

test("concurrent scans are merged through singleflight", async (t) => {
  const home = await createHome(t);
  const scanner = new UsageScanner();
  t.after(() => scanner.dispose());
  const [left, right] = await Promise.all([scanner.scan({ home }), scanner.scan({ home })]);
  assert.equal(left, right, "both callers must receive the same scan result");
});

test("live sessions merge by seq with live events winning and disk history kept", async (t) => {
  const home = await createHome(t);
  const liveEvents = [
    { type: "session", version: 4, id: "session-main", createdAt: T3, cwd: "D:\\ws" },
    usageEvent(1, T3, 100, 10, 1_000, "turing", "deepseek-flash"), // duplicate of disk seq 1
    usageEvent(10, T1, 5, 1, 0, "turing", "deepseek-flash"), // newer event only in memory
    { type: "session/title", seq: 11, time: T1, data: { title: "Live title" } },
    { type: "turn/start", seq: 12, time: T1, data: { turn: 2 } },
  ];
  const scanner = new UsageScanner({
    getLive: () => [{
      id: "session-main",
      header: { id: "session-main", createdAt: T3, cwd: "D:\\ws" },
      ownEvents: () => liveEvents,
    }],
  });
  t.after(() => scanner.dispose());
  const { sessions } = await scanner.scan({ home });
  const main = byId(sessions).get("session-main");
  assert.equal(main.live, true);
  assert.equal(main.usageEvents, 3, "the duplicate seq must be counted once");
  assert.deepEqual(main.tokens, { inputTokens: 305, outputTokens: 31, cacheReadTokens: 3_000, cacheWriteTokens: 0 });
  assert.equal(main.title, "Live title");
  assert.equal(main.turns, 1, "turn/start count comes from the union of disk and live");
});

test("sessions that only exist in memory are reported with live=true", async (t) => {
  const home = await createHome(t);
  const scanner = new UsageScanner({
    getLive: () => [{
      id: "session-live-only",
      header: { id: "session-live-only", createdAt: T1, cwd: "D:\\ws" },
      ownEvents: () => [
        { type: "session", version: 4, id: "session-live-only", createdAt: T1, cwd: "D:\\ws" },
        usageEvent(0, T1, 1, 1, 0, "turing", "deepseek-flash"),
      ],
    }],
  });
  t.after(() => scanner.dispose());
  const { sessions } = await scanner.scan({ home });
  const live = byId(sessions).get("session-live-only");
  assert.ok(live);
  assert.equal(live.live, true);
  assert.deepEqual(live.tokens, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

test("an oversized log is skipped and served from projcache", async (t) => {
  const home = await createHome(t);
  const scanner = new UsageScanner({ maxLogBytes: 20 });
  t.after(() => scanner.dispose());
  const { sessions, scan } = await scanner.scan({ home });
  assert.ok(scan.errors.some((error) => /above the 20-byte limit/.test(error)));
  const main = byId(sessions).get("session-main");
  assert.deepEqual(main.tokens, { inputTokens: 999, outputTokens: 99, cacheReadTokens: 9_999, cacheWriteTokens: 0 });
});

test("missing or empty DSH home degrades to an empty scan", async () => {
  const scanner = new UsageScanner({ home: join(tmpdir(), "dsh-usage-definitely-missing") });
  try {
    const { sessions, scan } = await scanner.scan();
    assert.deepEqual(sessions, []);
    assert.equal(scan.sessionDirs, 0);
    assert.equal(scan.files, 0);
    assert.deepEqual(scan.errors, []);
  } finally {
    scanner.dispose();
  }
});

test("resolveDshHome and readProjcache accept explicit paths and tolerate garbage", async (t) => {
  assert.equal(resolveDshHome("D:\\explicit-home"), "D:\\explicit-home");
  const home = await createHome(t);
  const main = await readProjcache(home, "session-main");
  assert.equal(main.title, "Stale cache title");
  assert.deepEqual(main.tokens, { inputTokens: 999, outputTokens: 99, cacheReadTokens: 9_999, cacheWriteTokens: 0 });
  assert.equal(await readProjcache(home, "missing-session"), null);
  assert.ok(DAY_MS > 0);
});
