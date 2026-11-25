/**
 * 等人处理的原因。宿主把四种完全不同的处境都压成 `waiting`，岛上只显示「需要你处理」时，
 * 用户分不清是要他批准、要他回答问题，还是目标已经停了 —— 所以把原因单独带出来。
 */
export type WaitReason = 'approval' | 'question' | 'goal-paused' | 'goal-blocked' | 'goal-limit' | 'queued';
/**
 * 正在进行的进度。宿主没有可读的 `sessionStats`/`contextPressure`，回合号与步骤只能从
 * 会话日志尾页的 `step/start`、`tool/call` 里取（见 `readTail`），累计输出走 `tokenUsage`。
 */
export interface ActivityProgress {
    /** 当前回合序号（日志尾页最后一个 `step/start` 的 `turn`）。 */
    turn?: number;
    /** 当前步骤序号（日志尾页最后一个 `step/start` 的 `step`）。 */
    step?: number;
    /** 正在跑的工具名（`tool/call` 有派发、还没等到 `tool/result`）。 */
    tool?: string;
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
