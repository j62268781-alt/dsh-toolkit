/**
 * 审计 ledger：**append-only JSONL**，一次尝试两行——
 * 发包前先落 `dispatch`（所以"钱花出去了但进程崩了"也留得下痕迹），回来后补 `settled`。
 *
 * 它同时是**逐小时配额的计数来源**：配额不能因为进程重启就归零，
 * 所以启动后第一次查配额时会从文件尾部回读窗口内的记录（最多读取尾部 256KB；读取范围有界，不保证覆盖整小时）。
 *
 * 两条纪律：
 * - **落盘失败不阻断判断**：文件写不进去不该不给你判断，但要让调用方知道（日志）。
 * - **绝不写入密钥值**：记录里只有引用名、模型名、指纹、计量（§13.2）。
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** 配额窗口固定 1 小时（配置里只暴露"每小时多少次/多少 token"）。 */
export const WINDOW_MS = 60 * 60 * 1000;
/** 回读文件尾部这么多字节来找窗口内的记录。 */
const TAIL_BYTES = 256 * 1024;
/** $DSH_HOME 优先，退回 `~/.dsh`。 */
export function defaultLedgerPath() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(home, 'judgment-ledger.jsonl');
}
export class Ledger {
    path;
    warn;
    events = [];
    reservations = new Map();
    starts = new Map();
    serial = Promise.resolve();
    waiters = new Set();
    seeded = false;
    masked = false;
    constructor(options) {
        this.path = options.enabled ? (options.path === undefined || options.path === '' ? defaultLedgerPath() : options.path) : undefined;
        this.warn = (message) => options.logger?.warn(message);
    }
    /** 未启用落盘时（`ledger.enabled: false`）计量只在进程内，配额因此不跨重启。 */
    get persistent() {
        return this.path !== undefined;
    }
    newId() {
        return randomUUID();
    }
    exclusive(work) {
        const result = this.serial.then(work, work);
        this.serial = result.then(() => undefined, () => undefined);
        return result;
    }
    async ensureSeeded() {
        if (this.seeded)
            return;
        await this.seed();
        this.seeded = true;
    }
    waitForChange(signal) {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        const wake = () => resolve(true);
        const abort = () => resolve(false);
        if (signal?.aborted === true)
            abort();
        else {
            this.waiters.add(wake);
            signal?.addEventListener('abort', abort, { once: true });
        }
        return {
            promise,
            cancel: () => {
                this.waiters.delete(wake);
                signal?.removeEventListener('abort', abort);
            },
        };
    }
    notifyChange() {
        const waiters = [...this.waiters];
        this.waiters.clear();
        for (const wake of waiters)
            wake();
    }
    async write(line) {
        if (this.path !== undefined) {
            try {
                await mkdir(dirname(this.path), { recursive: true });
                await appendFile(this.path, `${JSON.stringify(line)}\n`, 'utf8');
            }
            catch (error) {
                // 只报一次，避免每次调用都刷屏；但确实要说出来。
                if (!this.masked) {
                    this.masked = true;
                    this.warn(`审计 ledger 写不进去（${this.path}）：${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        this.accumulate(line);
    }
    async start(record) {
        await this.exclusive(async () => {
            await this.ensureSeeded();
            await this.write({ ...record, event: 'dispatch' });
        });
    }
    async settle(record) {
        await this.exclusive(async () => {
            await this.ensureSeeded();
            const scope = this.starts.get(record.id);
            await this.write({
                ...record,
                ...(record.connection === undefined && scope !== undefined ? { connection: scope.connection } : {}),
                ...(record.purpose === undefined && scope?.purpose !== undefined ? { purpose: scope.purpose } : {}),
                ...(record.dispatchAt === undefined && scope !== undefined ? { dispatchAt: new Date(scope.at).toISOString() } : {}),
                event: 'settled',
            });
            this.starts.delete(record.id);
            for (const [reservationId, reservation] of this.reservations) {
                if (reservation.attemptId === record.id)
                    this.reservations.delete(reservationId);
            }
            this.notifyChange();
        });
    }
    /** Check usage and reserve call slots as one serialized operation. */
    async reserve(callKeys, serialKeys, admit, signal) {
        const id = randomUUID();
        const uniqueCalls = [...new Set(callKeys)];
        const uniqueSerial = [...new Set(serialKeys)];
        for (;;) {
            const wait = this.waitForChange(signal);
            let reservation;
            try {
                reservation = await this.exclusive(async () => {
                    await this.ensureSeeded();
                    if (signal?.aborted === true)
                        throw new DOMException('The operation was aborted', 'AbortError');
                    const conflicts = [...this.reservations.values()].some((item) => item.serialKeys.some((key) => uniqueSerial.includes(key)) ||
                        item.serialKeys.some((key) => uniqueCalls.includes(key)) ||
                        uniqueSerial.some((key) => item.callKeys.includes(key)));
                    if (conflicts)
                        return undefined;
                    const usage = this.usageAt(Date.now());
                    admit(usage);
                    this.reservations.set(id, { callKeys: uniqueCalls, serialKeys: uniqueSerial });
                    let committed = false;
                    return {
                        start: async (record) => {
                            if (committed)
                                return;
                            committed = true;
                            await this.exclusive(async () => {
                                await this.ensureSeeded();
                                const attemptId = record.id;
                                const scope = {
                                    connection: record.connection,
                                    ...(record.purpose === undefined ? {} : { purpose: record.purpose }),
                                    at: Date.parse(record.at),
                                };
                                this.starts.set(attemptId, scope);
                                await this.write({ ...record, event: 'dispatch' });
                                if (uniqueSerial.length > 0) {
                                    this.reservations.set(id, { callKeys: [], serialKeys: uniqueSerial, attemptId });
                                }
                                else {
                                    this.reservations.delete(id);
                                }
                                this.notifyChange();
                            });
                        },
                        release: async () => {
                            if (committed)
                                return;
                            committed = true;
                            await this.exclusive(async () => {
                                this.reservations.delete(id);
                                this.notifyChange();
                            });
                        },
                    };
                });
            }
            catch (error) {
                wait.cancel();
                throw error;
            }
            if (reservation !== undefined) {
                wait.cancel();
                return reservation;
            }
            const changed = await wait.promise;
            wait.cancel();
            if (!changed)
                throw new DOMException('The operation was aborted', 'AbortError');
        }
    }
    /** Windowed usage plus currently admitted calls, recalculated against the current time. */
    async usage() {
        return await this.exclusive(async () => {
            await this.ensureSeeded();
            return this.usageAt(Date.now());
        });
    }
    usageAt(now) {
        const cutoff = now - WINDOW_MS;
        for (let index = this.events.length - 1; index >= 0; index -= 1) {
            if (this.events[index].at < cutoff)
                this.events.splice(index, 1);
        }
        const usage = new Map();
        const bump = (key, calls, inputTokens) => {
            const current = usage.get(key) ?? { calls: 0, inputTokens: 0 };
            usage.set(key, { calls: current.calls + calls, inputTokens: current.inputTokens + inputTokens });
        };
        for (const event of this.events) {
            for (const [key, delta] of event.deltas)
                bump(key, delta.calls, delta.inputTokens);
        }
        for (const reservation of this.reservations.values()) {
            for (const key of reservation.callKeys)
                bump(key, 1, 0);
        }
        return usage;
    }
    accumulate(line) {
        const recordedAt = typeof line.at === 'string' ? Date.parse(line.at) : Number.NaN;
        const dispatchAt = line.event === 'settled' && typeof line.dispatchAt === 'string'
            ? Date.parse(line.dispatchAt)
            : Number.NaN;
        const deltas = new Map();
        const connection = typeof line.connection === 'string' ? line.connection : '';
        const purpose = typeof line.purpose === 'string' ? line.purpose : '';
        if (line.event === 'dispatch') {
            if (!Number.isFinite(recordedAt) || recordedAt < Date.now() - WINDOW_MS)
                return;
            if (connection !== '')
                deltas.set(`connection:${connection}`, { calls: 1, inputTokens: 0 });
            if (purpose !== '')
                deltas.set(`purpose:${purpose}`, { calls: 1, inputTokens: 0 });
            if (typeof line.id === 'string' && connection !== '') {
                this.starts.set(line.id, { connection, ...(purpose === '' ? {} : { purpose }), at: recordedAt });
            }
            if (deltas.size > 0)
                this.events.push({ at: recordedAt, deltas });
        }
        else if (line.event === 'settled') {
            const scope = typeof line.id === 'string' ? this.starts.get(line.id) : undefined;
            const at = Number.isFinite(dispatchAt) ? dispatchAt : scope?.at ?? recordedAt;
            const resolvedConnection = connection || scope?.connection || '';
            const resolvedPurpose = purpose || scope?.purpose || '';
            if (!Number.isFinite(at) || at < Date.now() - WINDOW_MS) {
                if (typeof line.id === 'string')
                    this.starts.delete(line.id);
                return;
            }
            const tokens = typeof line.inputTokens === 'number' && Number.isFinite(line.inputTokens) ? line.inputTokens : 0;
            if (resolvedConnection !== '')
                deltas.set(`connection:${resolvedConnection}`, { calls: 0, inputTokens: tokens });
            if (resolvedPurpose !== '')
                deltas.set(`purpose:${resolvedPurpose}`, { calls: 0, inputTokens: tokens });
            if (typeof line.id === 'string')
                this.starts.delete(line.id);
            if (deltas.size > 0)
                this.events.push({ at, deltas });
        }
    }
    /** 从文件尾部回读窗口内的记录，把计数播进内存。 */
    async seed() {
        if (this.path === undefined)
            return;
        let text = '';
        let truncated = false;
        try {
            const handle = await open(this.path, 'r');
            try {
                const { size } = await handle.stat();
                const start = Math.max(0, size - TAIL_BYTES);
                truncated = start > 0;
                const buffer = Buffer.alloc(Number(size) - start);
                await handle.read(buffer, 0, buffer.length, start);
                text = buffer.toString('utf8');
            }
            finally {
                await handle.close();
            }
        }
        catch {
            // 文件还不存在：正常情况（第一次用）。
            return;
        }
        const lines = text.split('\n');
        // **只有**从文件中间开始读时，首行才可能被截断；从头读还丢掉首行就是漏记一条。
        if (truncated && lines.length > 1)
            lines.shift();
        const cutoff = Date.now() - WINDOW_MS;
        const tailScopes = new Map();
        for (const raw of lines) {
            const line = raw.trim();
            if (line === '')
                continue;
            try {
                const parsed = JSON.parse(line);
                const at = typeof parsed.at === 'string' ? Date.parse(parsed.at) : Number.NaN;
                if (!Number.isFinite(at))
                    continue;
                if (parsed.event === 'dispatch' && typeof parsed.id === 'string') {
                    const connection = typeof parsed.connection === 'string' ? parsed.connection : '';
                    if (connection !== '') {
                        tailScopes.set(parsed.id, {
                            connection,
                            ...(typeof parsed.purpose === 'string' ? { purpose: parsed.purpose } : {}),
                            at,
                        });
                    }
                    if (at >= cutoff)
                        this.accumulate(parsed);
                    continue;
                }
                if (parsed.event === 'settled') {
                    const scope = typeof parsed.id === 'string' ? tailScopes.get(parsed.id) : undefined;
                    const replay = scope === undefined ? parsed : {
                        ...parsed,
                        connection: parsed.connection ?? scope.connection,
                        purpose: parsed.purpose ?? scope.purpose,
                        dispatchAt: parsed.dispatchAt ?? new Date(scope.at).toISOString(),
                    };
                    this.accumulate(replay);
                }
            }
            catch {
                // 坏行跳过：审计文件不该因为一行脏数据让插件不能用。
            }
        }
    }
}
//# sourceMappingURL=ledger.js.map