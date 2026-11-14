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
import type { JudgmentBudget } from '../contract/index.js';
/** 配额窗口固定 1 小时（配置里只暴露"每小时多少次/多少 token"）。 */
export declare const WINDOW_MS: number;
/** 日志接口：`ctx.logger` 的最小形状，便于测试注入。 */
export interface LedgerLogger {
    warn(message: string): void;
}
export interface LedgerStart {
    readonly id: string;
    readonly at: string;
    readonly kind: 'ask' | 'health';
    readonly connection: string;
    readonly protocol: string;
    readonly model: string;
    readonly purpose?: string;
    readonly fingerprint?: string;
    readonly questionIds: readonly string[];
    readonly stateBytes: number;
    readonly budget?: JudgmentBudget;
}
export interface LedgerSettle {
    readonly id: string;
    readonly at: string;
    readonly outcome: 'ok' | 'error';
    readonly latencyMs: number;
    readonly connection?: string;
    readonly purpose?: string;
    /** Original dispatch timestamp anchors input-token usage to the request's rolling window. */
    readonly dispatchAt?: string;
    readonly model?: string;
    readonly requestId?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly errorCode?: string;
    readonly validationRule?: string;
    /**
     * 校验失败时的实测数值。记进账是为了**校准可复算**：
     * "Σp 与候选数正相关"这类结论应该能从 ledger 直接算出来，而不是靠手记一遍。
     */
    readonly validationSum?: number;
    readonly validationOptionCount?: number;
    /** 声明的预算事后被超出（token / 成本只能事后比，见 README 的诚实说明）。 */
    readonly budgetExceeded?: boolean;
}
/** 窗口内用量，按 `connection:<id>` 与 `purpose:<name>` 两个维度各记一份。 */
export interface QuotaUsage {
    calls: number;
    inputTokens: number;
}
/** `$DSH_HOME` 优先，退回 `~/.dsh`（规则在 `host/dsh-home.js`，全仓一份）。 */
export declare function defaultLedgerPath(): string;
export interface QuotaReservation {
    /** Atomically convert the reserved call into a dispatch record. */
    start(record: LedgerStart): Promise<void>;
    /** Release admission when work fails before dispatch. */
    release(): Promise<void>;
}
export declare class Ledger {
    private readonly path;
    private readonly warn;
    private readonly events;
    private readonly reservations;
    private readonly starts;
    private serial;
    private waiters;
    private seeded;
    private masked;
    constructor(options: {
        path?: string;
        enabled: boolean;
        logger?: LedgerLogger;
    });
    /** 未启用落盘时（`ledger.enabled: false`）计量只在进程内，配额因此不跨重启。 */
    get persistent(): boolean;
    newId(): string;
    private exclusive;
    private ensureSeeded;
    private waitForChange;
    private notifyChange;
    private write;
    start(record: LedgerStart): Promise<void>;
    settle(record: LedgerSettle): Promise<void>;
    /** Check usage and reserve call slots as one serialized operation. */
    reserve(callKeys: readonly string[], serialKeys: readonly string[], admit: (usage: ReadonlyMap<string, QuotaUsage>) => void, signal?: AbortSignal): Promise<QuotaReservation>;
    /** Windowed usage plus currently admitted calls, recalculated against the current time. */
    usage(): Promise<ReadonlyMap<string, QuotaUsage>>;
    private usageAt;
    private accumulate;
    /** 从文件尾部回读窗口内的记录，把计数播进内存。 */
    private seed;
}
//# sourceMappingURL=ledger.d.ts.map