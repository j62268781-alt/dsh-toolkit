/**
 * 等人处理的原因。宿主把四种完全不同的处境都压成 `waiting`，岛上只显示「需要你处理」时，
 * 用户分不清是要他批准、要他回答问题，还是目标已经停了 —— 所以把原因单独带出来。
 */
export type WaitReason = 'approval' | 'question' | 'goal-paused' | 'goal-blocked' | 'goal-limit' | 'queued';
/**
 * 正在进行的进度：全部来自宿主投影，不需要回读日志。
 * 宿主没有「当前工具」的事件，但 `sessionStats.pendingCalls` 记着在飞的工具数
 * （callId → 派发时刻），够说清「几个工具在跑、最久那个跑了多久」。
 */
export interface ActivityProgress {
    /** 本回合序号（`sessionStats.openStep.turn`）。 */
    turn?: number;
    /** 本步序号（`sessionStats.openStep.step`）。 */
    step?: number;
    /** 本步已用时（毫秒）。 */
    stepMs?: number;
    /** 在飞工具数（`sessionStats.pendingCalls` 的条目数）。 */
    tools?: number;
    /** 最早那个在飞工具已跑多久（毫秒）。 */
    toolMs?: number;
    /** 下一次请求的上下文大小（`contextPressure.projectedTokens`，缺省退到 pressureTokens）。 */
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
