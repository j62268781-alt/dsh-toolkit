/**
 * 审计 ledger：**append-only JSONL**，一次尝试两行——
 * 发包前先落 `dispatch`（所以"钱花出去了但进程崩了"也留得下痕迹），回来后补 `settled`。
 *
 * 它同时是**逐小时配额的计数来源**：配额不能因为进程重启就归零，
 * 所以启动后第一次查配额时会从文件尾部回读窗口内的记录（只读尾部 256KB，够覆盖一小时）。
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
    /** 窗口内计数：从文件尾部回读一次种子，之后本进程自己累加。 */
    counts;
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
    async write(line) {
        if (this.path === undefined) {
            this.accumulate(line);
            return;
        }
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
        this.accumulate(line);
    }
    async start(record) {
        await this.write({ ...record, event: 'dispatch' });
    }
    async settle(record) {
        await this.write({ ...record, event: 'settled' });
    }
    /** 把一条 `dispatch` 记进窗口计数（`settled` 记 inputTokens）。 */
    accumulate(line) {
        if (this.counts === undefined)
            this.counts = new Map();
        const at = typeof line.at === 'string' ? Date.parse(line.at) : Number.NaN;
        if (Number.isFinite(at) && Date.now() - at > WINDOW_MS)
            return;
        const bump = (key, calls, inputTokens) => {
            const current = this.counts.get(key) ?? { calls: 0, inputTokens: 0 };
            this.counts.set(key, { calls: current.calls + calls, inputTokens: current.inputTokens + inputTokens });
        };
        const connection = typeof line.connection === 'string' ? line.connection : '';
        const purpose = typeof line.purpose === 'string' ? line.purpose : '';
        if (line.event === 'dispatch') {
            if (connection !== '')
                bump(`connection:${connection}`, 1, 0);
            if (purpose !== '')
                bump(`purpose:${purpose}`, 1, 0);
            return;
        }
        if (line.event === 'settled') {
            const tokens = typeof line.inputTokens === 'number' ? line.inputTokens : 0;
            if (connection !== '')
                bump(`connection:${connection}`, 0, tokens);
            if (purpose !== '')
                bump(`purpose:${purpose}`, 0, tokens);
        }
    }
    /** 窗口内用量（第一次调用会从文件尾部回读种子）。 */
    async usage() {
        if (this.counts === undefined) {
            this.counts = new Map();
            await this.seed();
        }
        return this.counts;
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
        for (const raw of lines) {
            const line = raw.trim();
            if (line === '')
                continue;
            try {
                const parsed = JSON.parse(line);
                const at = typeof parsed.at === 'string' ? Date.parse(parsed.at) : Number.NaN;
                if (Number.isFinite(at) && at >= cutoff)
                    this.accumulate(parsed);
            }
            catch {
                // 坏行跳过：审计文件不该因为一行脏数据让插件不能用。
            }
        }
    }
}
//# sourceMappingURL=ledger.js.map