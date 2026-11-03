import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HISTORY_SIZE, DEFAULT_INTERVAL_MS, CpuSampler, cpuTimeTotals } from "../../src/modules/usage/host/cpu.js";

/**
 * Deterministic OS/process fixture. Each sample reads counters that the test
 * advances explicitly, so percentages have exact expected values.
 */
function createFixture() {
  const state = {
    clock: 1_000_000,
    processUser: 0,
    processSystem: 0,
    total: 0,
    idle: 0,
    cores: 4,
    rss: 1_000,
    heapUsed: 500,
    heapTotal: 800,
    totalmem: 16_000,
    freemem: 4_000,
    load: [0.5, 0.25, 0.125],
    uptime: 12.34,
    timers: [],
  };
  const timers = {
    setInterval(fn, ms) {
      const handle = { fn, ms, unref() { handle.unrefCalled = true; } };
      state.timers.push(handle);
      return handle;
    },
    clearInterval(handle) {
      handle.cleared = true;
    },
  };
  const sampler = new CpuSampler({
    intervalMs: 2_000,
    historySize: 60,
    timers,
    now: () => state.clock,
    cpus: () => Array.from({ length: state.cores }, () => ({
      times: {
        user: (state.total - state.idle) / state.cores,
        nice: 0,
        sys: 0,
        irq: 0,
        idle: state.idle / state.cores,
      },
    })),
    processCpuUsage: () => ({ user: state.processUser, system: state.processSystem }),
    memory: () => ({ rss: state.rss, heapUsed: state.heapUsed, heapTotal: state.heapTotal }),
    totalmem: () => state.totalmem,
    freemem: () => state.freemem,
    loadavg: () => state.load,
    uptime: () => state.uptime,
  });
  return { sampler, state, timers };
}

test("the first sample only captures a baseline and reports warmingUp", () => {
  const { sampler } = createFixture();
  const first = sampler.sample();
  assert.equal(first.warmingUp, true);
  assert.deepEqual(first.history, []);
  assert.equal(first.processPercent, 0);
  assert.equal(first.systemPercent, 0);
  assert.equal(first.cores, 4);
  assert.equal(first.memory.rss, 1_000);
  assert.equal(first.memory.heapUsed, 500);
  assert.equal(first.memory.heapTotal, 800);
  assert.equal(first.memory.systemTotal, 16_000);
  assert.equal(first.memory.systemFree, 4_000);
  assert.equal(first.uptimeSec, 12.3);
  assert.deepEqual(first.load, [0.5, 0.25, 0.13]);
  assert.equal(first.sampledAt, 1_000_000);
});

test("deltas produce process and system percentages and append history", () => {
  const { sampler, state } = createFixture();
  sampler.sample();

  state.clock = 1_002_000;
  state.processUser = 60_000;
  state.processSystem = 40_000; // 100ms CPU over 2000ms wall => 5%
  state.total = 2_000;
  state.idle = 1_500; // 500ms busy / 2000ms total => 25%
  const second = sampler.sample();

  assert.equal(second.warmingUp, false);
  assert.equal(second.processPercent, 5);
  assert.equal(second.systemPercent, 25);
  assert.equal(second.history.length, 1);
  assert.deepEqual(second.history[0], { t: 1_002_000, processPercent: 5, systemPercent: 25, rss: 1_000 });

  // The baseline advances: a stalled process reports 0% next time.
  state.clock = 1_004_000;
  state.total = 4_000;
  state.idle = 4_000;
  const third = sampler.sample();
  assert.equal(third.processPercent, 0);
  assert.equal(third.systemPercent, 0);
  assert.deepEqual(third.history.map((sample) => sample.t), [1_002_000, 1_004_000]);
});

test("history is bounded to the configured ring and stays ascending", () => {
  const { sampler, state } = createFixture();
  sampler.historySize = 3;
  sampler.sample();
  for (let index = 1; index <= 6; index += 1) {
    state.clock += 2_000;
    state.total += 2_000;
    state.idle += 1_000;
    sampler.sample();
  }
  const snapshot = sampler.snapshot();
  assert.equal(snapshot.history.length, 3);
  assert.deepEqual(snapshot.history.map((sample) => sample.t), [1_008_000, 1_010_000, 1_012_000]);
  assert.equal(snapshot.systemPercent, 50);
});

test("start() samples immediately, schedules the interval and stop() is idempotent", () => {
  const { sampler, state } = createFixture();
  sampler.start();
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0].ms, DEFAULT_INTERVAL_MS);
  assert.equal(state.timers[0].unrefCalled, true);
  assert.equal(sampler.running, true);
  assert.equal(sampler.snapshot().warmingUp, true);

  state.clock += 2_000;
  state.processSystem = 100_000;
  state.total = 2_000;
  state.idle = 1_000;
  state.timers[0].fn();
  assert.equal(sampler.snapshot().warmingUp, false);
  assert.equal(sampler.snapshot().processPercent, 5);
  assert.equal(sampler.snapshot().systemPercent, 50);

  sampler.stop();
  assert.equal(state.timers[0].cleared, true);
  assert.equal(sampler.running, false);
  sampler.stop();
  assert.equal(sampler.start(), sampler);
});

test("snapshot before sampling is a full zeroed payload and never throws", () => {
  const { sampler } = createFixture();
  const snapshot = sampler.snapshot();
  assert.equal(snapshot.warmingUp, true);
  assert.deepEqual(snapshot.history, []);
  assert.equal(snapshot.cores, 0);
  assert.deepEqual(snapshot.memory, { rss: 0, heapUsed: 0, heapTotal: 0, systemTotal: 0, systemFree: 0 });
  assert.deepEqual(snapshot.load, [0, 0, 0]);
  assert.equal(DEFAULT_HISTORY_SIZE, 60);
});

test("cpuTimeTotals ignores missing counters and tolerates odd input", () => {
  assert.deepEqual(cpuTimeTotals(undefined), { idle: 0, total: 0 });
  const totals = cpuTimeTotals([
    { times: { user: 10, nice: 1, sys: 2, irq: 3, idle: 84 } },
    { times: { user: 5, idle: 5 } },
    { times: {} },
  ]);
  assert.deepEqual(totals, { idle: 89, total: 110 });
});
