/**
 * CPU / memory sampler for the usage module.
 *
 * Percentages are derived from deltas between two samples:
 * - processPercent: `process.cpuUsage()` user+system delta against wall-clock
 *   time (so 100% means one full core; a busy multi-threaded host may exceed it);
 * - systemPercent: aggregated `os.cpus()` idle delta against total delta.
 *
 * The first sample only captures a baseline and reports `warmingUp: true`;
 * later samples are appended to a bounded ring of history entries. The sampler
 * is fully injectable so tests can drive time, timers and OS readings.
 */
import os from "node:os";

export const DEFAULT_INTERVAL_MS = 2_000;
export const DEFAULT_HISTORY_SIZE = 60;

/** @param {number[]} values */
function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
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

/**
 * Summed CPU time counters across all cores.
 * @param {ReturnType<typeof os.cpus>} cpus
 * @returns {{idle:number, total:number}}
 */
export function cpuTimeTotals(cpus) {
  let idle = 0;
  let total = 0;
  if (!Array.isArray(cpus)) return { idle: 0, total: 0 };
  for (const cpu of cpus) {
    const times = cpu?.times ?? {};
    const values = [
      times.user,
      times.nice,
      times.sys,
      times.irq,
      times.idle,
    ];
    for (const value of values) if (Number.isFinite(value)) total += value;
    if (Number.isFinite(times.idle)) idle += times.idle;
  }
  return { idle, total };
}

/** Normalized load average tuple. */
function normalizeLoad(load) {
  const values = Array.isArray(load) ? load.slice(0, 3) : [];
  while (values.length < 3) values.push(0);
  return values.map((value) => round2(value));
}

function normalizeMemory(memory) {
  return {
    rss: integer(memory?.rss),
    heapUsed: integer(memory?.heapUsed),
    heapTotal: integer(memory?.heapTotal),
    systemTotal: 0,
    systemFree: 0,
  };
}

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

export class CpuSampler {
  #baseline = null;
  #history = [];
  #latest = null;
  #timer = null;

  constructor(options = {}) {
    this.intervalMs = positive(options.intervalMs, DEFAULT_INTERVAL_MS);
    this.historySize = Math.max(1, Math.trunc(positive(options.historySize, DEFAULT_HISTORY_SIZE)));
    this.timers = options.timers ?? {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (handle) => globalThis.clearInterval(handle),
    };
    this.now = options.now ?? (() => Date.now());
    this.readCpus = options.cpus ?? (() => os.cpus());
    this.readProcessUsage = options.processCpuUsage ?? (() => process.cpuUsage());
    this.readMemory = options.memory ?? (() => process.memoryUsage());
    this.readTotalmem = options.totalmem ?? (() => os.totalmem());
    this.readFreemem = options.freemem ?? (() => os.freemem());
    this.readLoadavg = options.loadavg ?? (() => os.loadavg());
    this.readUptime = options.uptime ?? (() => process.uptime());
  }

  /** Start periodic sampling; the first sample captures the baseline. */
  start() {
    if (this.#timer !== null) return this;
    this.sample();
    this.#timer = this.timers.setInterval(() => {
      try {
        this.sample();
      } catch {
        // Sampling must never take the host down; keep the last good snapshot.
      }
    }, this.intervalMs);
    if (this.#timer !== null && typeof this.#timer.unref === "function") this.#timer.unref();
    return this;
  }

  /** Stop periodic sampling. Safe to call repeatedly. */
  stop() {
    if (this.#timer === null) return this;
    this.timers.clearInterval(this.#timer);
    this.#timer = null;
    return this;
  }

  /** Whether periodic sampling is currently running. */
  get running() {
    return this.#timer !== null;
  }

  /**
   * Take one sample and update the rolling history.
   * @returns {object} the latest snapshot (see {@link CpuSampler#snapshot}).
   */
  sample() {
    const sampledAt = Number(this.now());
    const processUsage = this.readProcessUsage() ?? { user: 0, system: 0 };
    const cpus = this.readCpus();
    const totals = cpuTimeTotals(cpus);
    const memory = this.readMemory();
    const systemTotal = integer(this.readTotalmem());
    const systemFree = integer(this.readFreemem());

    const base = {
      cores: Array.isArray(cpus) ? cpus.length : 0,
      load: normalizeLoad(this.readLoadavg()),
      memory: { ...normalizeMemory(memory), systemTotal, systemFree },
      uptimeSec: Math.max(0, round1(this.readUptime())),
    };

    if (this.#baseline === null) {
      this.#baseline = { at: sampledAt, process: processUsage, cpu: totals };
      this.#latest = {
        processPercent: 0,
        systemPercent: 0,
        ...base,
        sampledAt,
        warmingUp: true,
        history: [],
      };
      return this.#latest;
    }

    const wallMs = sampledAt - this.#baseline.at;
    const processDelta =
      (Number(processUsage.user) + Number(processUsage.system)) -
      (Number(this.#baseline.process.user) + Number(this.#baseline.process.system));
    const totalDelta = totals.total - this.#baseline.cpu.total;
    const idleDelta = totals.idle - this.#baseline.cpu.idle;

    const processPercent = wallMs > 0
      ? round1(clampPercent((processDelta / (wallMs * 1_000)) * 100))
      : 0;
    const systemPercent = totalDelta > 0
      ? round1(clampPercent(((totalDelta - idleDelta) / totalDelta) * 100))
      : 0;

    this.#baseline = { at: sampledAt, process: processUsage, cpu: totals };
    this.#history.push({ t: sampledAt, processPercent, systemPercent, rss: base.memory.rss });
    while (this.#history.length > this.historySize) this.#history.shift();

    this.#latest = {
      processPercent,
      systemPercent,
      ...base,
      sampledAt,
      warmingUp: false,
      history: this.#history.slice(),
    };
    return this.#latest;
  }

  /**
   * Current snapshot without taking a sample. Before {@link start} this is a
   * zeroed warming-up snapshot so the HTTP payload always has the full shape.
   */
  snapshot() {
    if (this.#latest !== null) return this.#latest;
    return {
      processPercent: 0,
      systemPercent: 0,
      cores: 0,
      load: [0, 0, 0],
      memory: { rss: 0, heapUsed: 0, heapTotal: 0, systemTotal: 0, systemFree: 0 },
      uptimeSec: 0,
      sampledAt: Number(this.now()),
      warmingUp: true,
      history: [],
    };
  }
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
