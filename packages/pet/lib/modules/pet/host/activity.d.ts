/**
 * 等人处理的原因。宿主把四种完全不同的处境都压成 `waiting`，岛上只显示「需要你处理」时，
 * 用户分不清是要他批准、要他回答问题，还是目标已经停了 —— 所以把原因单独带出来。
 */
export type WaitReason = 'approval' | 'question' | 'goal-paused' | 'goal-blocked' | 'goal-limit' | 'queued';
/**
 * 正在进行的进度：只挑有 `wire` 的投影，不需要回读日志。
 * 工具数与工具耗时来自 `sessionStats`，而它没有 wire、插件读不到，所以这里没有。
 */
export interface ActivityProgress {
    /** 本回合序号（`turnOutline` 最后一条的 `turn`）。 */
    turn?: number;
    /** 当前在做的待办（`todos` 里 `in_progress` 那条的文案）。 */
    todo?: string;
    /** 上下文大小（`contextBreakdown` 的系统/工具/消息三部分之和）。 */
    contextTokens?: number;
    /** 整个会话累计输出 token（`tokenUsage.outputTokens`）。 */
    outputTokens?: number;
    /** 正在跑的子会话数（聚合时统计，不在单行 facts 里算）。 */
    subagents?: number;
}
/** 对外快照的一行（`snapshot()` 返回、灵动岛直接渲染）。 */
export interface ActivitySnapshotItem {
    id: string;
    title: string;
    status: string;
    detail: string;
    updatedAt: number;
    running: boolean;
    pendingKind?: string;
    waitReason?: WaitReason;
    queued?: number;
    progress?: ActivityProgress;
}
export interface ActivityOptions {
    /** 用户已看过的会话：`sessionId → 看到时的活动时间`。 */
    seen?: Map<string, number>;
    onSeen?: (sessionId: string, at: number) => void;
}
export interface ActivityFeed {
    snapshot(): ActivitySnapshotItem[];
    markSeen(sessionId: string, at?: number): void;
    ready: Promise<void>;
    inspect(sessionId: string): any;
    dispose(): void;
}
/** `ctx` 是宿主插件上下文（形状由宿主决定），故显式 any。 */
export declare function createActivityFeed(ctx: any, onChange?: () => void, options?: ActivityOptions): ActivityFeed;
