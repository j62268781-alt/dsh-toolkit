/**
 * Read-only scanner for real DSH session token consumption.
 *
 * Discovery: `DSH_HOME/sessions/<escaped-workspace>/<sessionId>/session*.jsonl.zstd`.
 * Every file is optional and every failure degrades to partial data: unreadable or
 * oversized logs fall back to `storages/session_projcache/sessions/<id>.json`, and a
 * totally unreadable session is still reported with zero tokens.
 *
 * Parsing: only `assistant/message` events carrying `data.usage` are consumption.
 * Other usage-bearing event types (`compaction/summary`) exist in the log but are
 * excluded by the session projection cache too, so counting only assistant messages
 * keeps disk and projection totals consistent.
 *
 * Freshness: live sessions from `ctx.sessions.list()` are read through `ownEvents()`
 * and merged with the disk records by session id and event seq, live events winning.
 * Disk logs are authoritative over the projection cache (the cache can lag the log).
 *
 * Caching: parsed records are cached by `(path, mtimeMs, size)`; concurrent scans are
 * deduplicated with the shared {@link Singleflight}.
 */
import { existsSync, statSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Singleflight } from "../../../host/singleflight.js";
import { readSessionLog } from "./log.js";
import { addTokens, totalTokens, zeroTokens } from "./pricing.js";
import { localDayStart } from "./time.js";

export const DEFAULT_MAX_LOG_BYTES = 64 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 4;
const MAX_SCAN_ERRORS = 40;
const MAX_CACHE_ENTRIES = 1_024;
const LOG_NAME = /^session.*\.jsonl(?:\.zstd)?$/;
const ZERO_TOKENS = zeroTokens();

/**
 * Resolve the DSH home directory used for session data.
 *
 * Order: explicit option (tests / CLI), `DSH_HOME` when it exists and actually
 * contains a `sessions` directory, `$HOME/.dsh` when it exists, then the first
 * existing candidate, then `$HOME/.dsh`. Real session data is never written.
 * @param {string|undefined} explicit
 * @returns {string}
 */
export function resolveDshHome(explicit) {
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit;
  const candidates = [];
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") candidates.push(fromEnv);
  candidates.push(join(homedir(), ".dsh"));
  for (const candidate of candidates) if (hasSessions(candidate)) return candidate;
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[candidates.length - 1];
}

function hasSessions(home) {
  try {
    return statSync(join(home, "sessions")).isDirectory();
  } catch {
    return false;
  }
}

/** Path of the projection-cache file for one session. */
export function projcacheFile(home, id) {
  return join(home, "storages", "session_projcache", "sessions", `${id}.json`);
}

async function listDirectory(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(entry) {
  return entry !== null && typeof entry === "object" && entry.isDirectory() === true;
}

function isFile(entry) {
  return entry !== null && typeof entry === "object" && entry.isFile() === true;
}

/**
 * Discover every session directory under the DSH home and its newest log file.
 * @param {string} home
 * @returns {Promise<{sessions:Array<{id:string, dir:string, path:string|null}>, sessionDirs:number, files:number}>}
 */
export async function discoverSessionLogs(home) {
  const sessionsRoot = join(home, "sessions");
  const sessions = [];
  let sessionDirs = 0;
  let files = 0;
  for (const workspace of await listDirectory(sessionsRoot)) {
    if (!isDirectory(workspace)) continue;
    const workspacePath = join(sessionsRoot, workspace.name);
    for (const sessionEntry of await listDirectory(workspacePath)) {
      if (!isDirectory(sessionEntry)) continue;
      sessionDirs += 1;
      const dir = join(workspacePath, sessionEntry.name);
      const names = (await listDirectory(dir)).filter(isFile).map((entry) => entry.name);
      const logName = names.find((name) => LOG_NAME.test(name));
      if (logName !== undefined) files += 1;
      sessions.push({ id: sessionEntry.name, dir, path: logName === undefined ? null : join(dir, logName) });
    }
  }
  return { sessions, sessionDirs, files };
}

/**
 * Read the per-session projection cache (token totals + identity + stats).
 * Returns `null` when the file is missing or malformed.
 * @param {string} home
 * @param {string} id
 */
export async function readProjcache(home, id) {
  let text;
  try {
    text = await readFile(projcacheFile(home, id), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = parsed?.record ?? parsed;
  const rows = record?.rows ?? {};
  const identity = record?.identity ?? {};
  const totals = rows?.tokenUsage?.val?.totals ?? null;
  const tokens = zeroTokens();
  if (totals !== null && typeof totals === "object") {
    tokens.inputTokens = count(totals.uncachedInputTokens);
    tokens.outputTokens = count(totals.outputTokens);
    tokens.cacheReadTokens = count(totals.cacheReadTokens);
    tokens.cacheWriteTokens = count(totals.cacheWriteTokens);
  }
  const stats = rows?.sessionStats?.val ?? null;
  const lastUsed = rows?.modelSelection?.val?.lastUsed ?? null;
  const title = typeof rows?.title?.val === "string" && rows.title.val.trim() !== "" ? rows.title.val : null;
  const subagentRow = rows?.subagent?.val;
  return {
    hasTotals: totals !== null && typeof totals === "object",
    tokens,
    title,
    cwd: typeof identity.cwd === "string" ? identity.cwd : undefined,
    createdAt: Number.isFinite(identity.createdAt) ? identity.createdAt : undefined,
    subagent: subagentRow !== null && typeof subagentRow === "object" && Object.keys(subagentRow).length > 0,
    turns: count(stats?.turns),
    steps: count(stats?.steps),
    provider: typeof lastUsed?.provider === "string" ? lastUsed.provider : null,
    model: typeof lastUsed?.model === "string" ? lastUsed.model : null,
  };
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function isSubagentHeader(header) {
  return header?.origin === "subagent" ||
    count(header?.delegationDepth) > 0 ||
    (typeof header?.parentSession === "string" && header.parentSession !== "");
}

function emptyRecord(id) {
  return {
    id,
    header: {},
    subagent: false,
    title: null,
    titleTime: 0,
    turns: 0,
    steps: 0,
    usageEvents: [],
    fallback: null,
    updatedAt: 0,
    live: false,
    source: "empty",
  };
}

function toUsageEvent(event, index) {
  if (event === null || typeof event !== "object" || event.type !== "assistant/message") return null;
  const usage = event.data?.usage;
  if (usage === null || typeof usage !== "object") return null;
  const source = event.data?.message?.source;
  return {
    seq: Number.isFinite(event.seq) ? Number(event.seq) : index,
    time: Number.isFinite(event.time) ? Number(event.time) : 0,
    provider: typeof source?.provider === "string" ? source.provider : null,
    model: typeof source?.model === "string" ? source.model : null,
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    cacheReadTokens: count(usage.cacheReadTokens),
    cacheWriteTokens: count(usage.cacheWriteTokens),
  };
}

/**
 * Aggregate a raw event list into a raw session record (not yet token-summed).
 * @param {string} id
 * @param {ReadonlyArray<unknown>} events
 */
export function recordFromEvents(id, events) {
  const record = emptyRecord(id);
  let time = 0;
  for (let index = 0; index < (events?.length ?? 0); index += 1) {
    const event = events[index];
    if (event === null || typeof event !== "object") continue;
    if (Number.isFinite(event.time) && event.time > time) time = Number(event.time);
    switch (event.type) {
      case "session": {
        record.header = {
          createdAt: Number.isFinite(event.createdAt) ? Number(event.createdAt) : undefined,
          cwd: typeof event.cwd === "string" ? event.cwd : undefined,
          parentSession: typeof event.parentSession === "string" ? event.parentSession : undefined,
          origin: event.origin === "subagent" ? "subagent" : undefined,
          delegationDepth: Number.isFinite(event.delegationDepth) ? Number(event.delegationDepth) : undefined,
          isSeeded: event.isSeeded === true,
        };
        break;
      }
      case "turn/start": {
        record.turns += 1;
        break;
      }
      case "step/end": {
        record.steps += 1;
        break;
      }
      case "session/title": {
        const title = event.data?.title;
        if (typeof title === "string" && title.trim() !== "" && Number(event.time ?? 0) >= record.titleTime) {
          record.title = title;
          record.titleTime = Number(event.time ?? 0);
        }
        break;
      }
      default:
        break;
    }
    const usageEvent = toUsageEvent(event, index);
    if (usageEvent !== null) record.usageEvents.push(usageEvent);
  }
  record.updatedAt = time;
  record.subagent = isSubagentHeader(record.header);
  return record;
}

/**
 * Build a raw record from one live Cordis session.
 * @param {object} session
 */
export function recordFromLiveSession(session) {
  if (session === null || typeof session !== "object") return null;
  const header = session.header ?? {};
  const id = typeof session.id === "string" && session.id !== "" ? session.id : header.id;
  if (typeof id !== "string" || id === "") return null;
  let events = [];
  try {
    if (typeof session.ownEvents === "function") events = session.ownEvents();
    else if (typeof session.snapshotEvents === "function") events = session.snapshotEvents();
  } catch {
    events = [];
  }
  const record = recordFromEvents(id, Array.isArray(events) ? events : []);
  record.live = true;
  record.source = "live";
  record.header = {
    ...record.header,
    createdAt: Number.isFinite(header.createdAt) ? Number(header.createdAt) : record.header.createdAt,
    cwd: typeof header.cwd === "string" ? header.cwd : record.header.cwd,
    parentSession: typeof header.parentSession === "string" ? header.parentSession : record.header.parentSession,
    origin: header.origin === "subagent" ? "subagent" : record.header.origin,
    delegationDepth: Number.isFinite(header.delegationDepth) ? Number(header.delegationDepth) : record.header.delegationDepth,
    isSeeded: header.isSeeded === true || record.header.isSeeded === true,
  };
  record.subagent = isSubagentHeader(record.header);
  record.updatedAt = Math.max(record.updatedAt, count(record.header.createdAt));
  return record;
}

/**
 * Merge a disk record with the live record for the same session. Live events win
 * on equal seq, and disk events missing from the live view (fork-inherited
 * prefix) are kept. Turn/step counters take the larger of both views because the
 * live view may only expose child-owned events.
 */
export function mergeSessionRecords(disk, live) {
  const record = emptyRecord(disk?.id ?? live?.id ?? "");
  record.id = disk?.id ?? live?.id ?? "";
  record.header = { ...(disk?.header ?? {}), ...pickDefined(live?.header ?? {}) };
  record.subagent = disk?.subagent === true || live?.subagent === true;
  const diskTitleTime = Number(disk?.titleTime ?? 0);
  const liveTitleTime = Number(live?.titleTime ?? 0);
  if (live?.title !== null && live?.title !== undefined && liveTitleTime >= diskTitleTime) {
    record.title = live.title;
    record.titleTime = liveTitleTime;
  } else {
    record.title = disk?.title ?? live?.title ?? null;
    record.titleTime = Math.max(diskTitleTime, liveTitleTime);
  }
  record.turns = Math.max(Number(disk?.turns ?? 0) || 0, Number(live?.turns ?? 0) || 0);
  record.steps = Math.max(Number(disk?.steps ?? 0) || 0, Number(live?.steps ?? 0) || 0);
  record.usageEvents = mergeUsageEvents(disk?.usageEvents ?? [], live?.usageEvents ?? []);
  record.fallback = disk?.fallback ?? live?.fallback ?? null;
  record.updatedAt = Math.max(Number(disk?.updatedAt ?? 0) || 0, Number(live?.updatedAt ?? 0) || 0);
  record.live = true;
  record.source = "log+live";
  return record;
}

function pickDefined(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) if (value !== undefined) result[key] = value;
  return result;
}

function mergeUsageEvents(diskEvents, liveEvents) {
  if (diskEvents.length === 0) return liveEvents.slice();
  if (liveEvents.length === 0) return diskEvents.slice();
  const bySeq = new Map();
  for (const event of diskEvents) bySeq.set(event.seq, event);
  for (const event of liveEvents) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => (a.seq - b.seq) || (a.time - b.time));
}

function modelKey(provider, model) {
  return `${provider ?? ""}\u0000${model ?? ""}`;
}

function addModelBucket(buckets, provider, model, tokens) {
  const key = modelKey(provider, model);
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = { provider: provider ?? null, model: model ?? null, tokens: zeroTokens() };
    buckets.set(key, bucket);
  }
  addTokens(bucket.tokens, tokens);
}

function addDayBucket(dayBuckets, time, provider, model, tokens) {
  const start = localDayStart(time);
  let models = dayBuckets.get(start);
  if (models === undefined) {
    models = new Map();
    dayBuckets.set(start, models);
  }
  addModelBucket(models, provider, model, tokens);
}

/**
 * Aggregate a raw record into the summary consumed by the snapshot builder.
 * @param {ReturnType<typeof emptyRecord>} record
 */
export function summarizeRecord(record) {
  const tokens = zeroTokens();
  const byModel = new Map();
  const dayBuckets = new Map();
  let last = null;
  let updatedAt = Number(record?.updatedAt ?? 0) || 0;

  for (const event of record?.usageEvents ?? []) {
    addTokens(tokens, event);
    addModelBucket(byModel, event.provider, event.model, event);
    addDayBucket(dayBuckets, event.time, event.provider, event.model, event);
    if (last === null || event.time >= last.time) last = event;
    if (event.time > updatedAt) updatedAt = event.time;
  }

  if ((record?.usageEvents ?? []).length === 0 && record?.fallback !== null && record?.fallback !== undefined) {
    const fallback = record.fallback;
    addTokens(tokens, fallback.tokens);
    addModelBucket(byModel, fallback.provider, fallback.model, fallback.tokens);
    const time = Number(fallback.time ?? 0) || count(record.header?.createdAt) || updatedAt;
    addDayBucket(dayBuckets, time, fallback.provider, fallback.model, fallback.tokens);
    if (time > updatedAt) updatedAt = time;
    last = { provider: fallback.provider ?? null, model: fallback.model ?? null };
  }

  const createdAt = count(record?.header?.createdAt) || updatedAt;
  return {
    id: record?.id ?? "",
    title: record?.title ?? null,
    cwd: record?.header?.cwd ?? null,
    createdAt,
    updatedAt: updatedAt || createdAt,
    provider: last?.provider ?? null,
    model: last?.model ?? null,
    live: record?.live === true,
    subagent: record?.subagent === true,
    turns: count(record?.turns),
    steps: count(record?.steps),
    usageEvents: Array.isArray(record?.usageEvents) ? record.usageEvents.length : 0,
    tokens: { ...tokens },
    totalTokens: totalTokens(tokens),
    byModel: [...byModel.values()],
    dayBuckets,
  };
}

/** Run `task` over `items` with a bounded number of in-flight promises. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = [];
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  };
  for (let index = 0; index < Math.min(limit, items.length); index += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export class UsageScanner {
  #cache = new Map();
  #flight = new Singleflight();
  #generation = 0;

  constructor(options = {}) {
    this.maxLogBytes = positive(options.maxLogBytes, DEFAULT_MAX_LOG_BYTES);
    this.concurrency = Math.max(1, Math.min(DEFAULT_CONCURRENCY, Math.trunc(positive(options.concurrency, DEFAULT_CONCURRENCY))));
    this.getLive = typeof options.getLive === "function" ? options.getLive : () => [];
    this.home = typeof options.home === "string" ? options.home : undefined;
    this.logger = options.logger;
  }

  /** Drop cached parses and in-flight scan bookkeeping. */
  invalidate() {
    this.#cache.clear();
    this.#flight.clear();
  }

  /** Release resources owned by the scanner. */
  dispose() {
    this.invalidate();
  }

  /**
   * Scan all sessions. Concurrent calls share one scan through {@link Singleflight}.
   * @param {{home?: string}} [options]
   * @returns {Promise<{home:string, sessions:object[], scan:object}>}
   */
  scan(options = {}) {
    const home = resolveDshHome(options.home ?? this.home);
    return this.#flight.run(`usage:${home}`, () => this.#scan(home), {
      onError: (error) => this.logger?.warn?.("[usage] scan failed", error),
    });
  }

  async #scan(home) {
    const errors = [];
    const discovery = await discoverSessionLogs(home).catch((error) => {
      errors.push(`sessions: ${message(error)}`);
      return { sessions: [], sessionDirs: 0, files: 0 };
    });
    const generation = ++this.#generation;
    let parsed = 0;
    let cached = 0;
    let skipped = 0;

    const diskRecords = await mapLimit(discovery.sessions, this.concurrency, async (entry) => {
      if (entry.path === null) {
        skipped += 1;
        return this.#fallbackRecord(home, entry, "log-missing");
      }
      try {
        const info = await stat(entry.path);
        if (!info.isFile()) {
          skipped += 1;
          return this.#fallbackRecord(home, entry, "log-not-a-file");
        }
        if (info.size > this.maxLogBytes) {
          skipped += 1;
          errors.push(`${entry.id}: session log above the ${this.maxLogBytes}-byte limit`);
          return this.#fallbackRecord(home, entry, "log-too-large", info);
        }
        if (info.size === 0) {
          const record = emptyRecord(entry.id);
          record.source = "log";
          record.updatedAt = Math.round(info.mtimeMs);
          return record;
        }
        const hit = this.#cache.get(entry.path);
        if (hit !== undefined && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
          hit.used = generation;
          cached += 1;
          return hit.record;
        }
        const decoded = await readSessionLog(entry.path, { size: info.size, mtimeMs: info.mtimeMs });
        if (decoded.frames === 0 && decoded.events.length === 0) {
          skipped += 1;
          errors.push(`${entry.id}: no zstd frame could be decoded`);
          return this.#fallbackRecord(home, entry, "log-unreadable");
        }
        for (const warning of decoded.errors ?? []) errors.push(`${entry.id}: ${warning}`);
        if (count(decoded.badLines) > 0) errors.push(`${entry.id}: ${decoded.badLines} malformed JSON line(s)`);
        const record = recordFromEvents(entry.id, decoded.events);
        record.source = "log";
        record.updatedAt = Math.max(record.updatedAt, Math.round(info.mtimeMs));
        this.#cache.set(entry.path, { mtimeMs: info.mtimeMs, size: info.size, record, used: generation });
        parsed += 1;
        return record;
      } catch (error) {
        skipped += 1;
        errors.push(`${entry.id}: ${message(error)}`);
        return this.#fallbackRecord(home, entry, "log-unreadable");
      }
    });

    const merged = new Map();
    for (const record of diskRecords) merged.set(record.id, record);
    let liveSessions = [];
    try {
      const value = await Promise.resolve(this.getLive());
      if (Array.isArray(value)) liveSessions = value;
    } catch (error) {
      errors.push(`live: ${message(error)}`);
    }
    for (const session of liveSessions) {
      try {
        const live = recordFromLiveSession(session);
        if (live === null) continue;
        const existing = merged.get(live.id);
        merged.set(live.id, existing === undefined ? live : mergeSessionRecords(existing, live));
      } catch (error) {
        errors.push(`live: ${message(error)}`);
      }
    }

    const sessions = [...merged.values()].map((record) => summarizeRecord(record));

    for (const [path, entry] of this.#cache) {
      if (entry.used !== generation) this.#cache.delete(path);
    }
    while (this.#cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.#cache.keys().next();
      if (oldest.done) break;
      this.#cache.delete(oldest.value);
    }

    return {
      home,
      sessions,
      scan: {
        home,
        sessionDirs: discovery.sessionDirs,
        files: discovery.files,
        parsed,
        cached,
        skipped,
        errors: errors.slice(0, MAX_SCAN_ERRORS),
      },
    };
  }

  async #fallbackRecord(home, entry, reason, info) {
    let cache = null;
    try {
      cache = await readProjcache(home, entry.id);
    } catch {
      cache = null;
    }
    const record = emptyRecord(entry.id);
    if (cache === null) {
      record.source = "empty";
      record.updatedAt = Math.round(info?.mtimeMs ?? 0) || 0;
      return record;
    }
    record.source = "projcache";
    record.header = { createdAt: cache.createdAt, cwd: cache.cwd };
    record.subagent = cache.subagent;
    record.title = cache.title;
    record.titleTime = 0;
    record.turns = cache.turns;
    record.steps = cache.steps;
    let time = Math.round(info?.mtimeMs ?? 0) || 0;
    if (time === 0) {
      try {
        time = Math.round((await stat(projcacheFile(home, entry.id))).mtimeMs);
      } catch {
        time = count(cache.createdAt);
      }
    }
    record.updatedAt = Math.max(time, count(cache.createdAt));
    record.fallback = cache.hasTotals || totalTokens(cache.tokens) > 0
      ? { tokens: cache.tokens, provider: cache.provider, model: cache.model, time: record.updatedAt }
      : null;
    return record;
  }
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
