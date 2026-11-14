/**
 * 「最近执行」的环形缓冲。
 *
 * 面板需要回答的问题不是「配了什么」，而是「刚才那次到底跑没跑、多久、结果如何」——
 * Qoder 是在回复下方给汇总，这里没地方放，就退化成设置页里的一张最近执行表。
 */
export interface HookRunRecord {
    id: number;
    at: number;
    event: string;
    command: string;
    source: string;
    decision: string;
    durationMs: number;
    code: number | null;
    timedOut: boolean;
    reason: string;
    error: string;
}
export interface HookHistory {
    push(record: Omit<HookRunRecord, 'id' | 'at'> & {
        at?: number;
    }): HookRunRecord;
    list(): HookRunRecord[];
    clear(): void;
}
export declare function createHookHistory(limit: number): HookHistory;
//# sourceMappingURL=history.d.ts.map