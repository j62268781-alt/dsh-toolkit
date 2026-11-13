/** 对外快照的一行（`snapshot()` 返回、灵动岛直接渲染）。 */
export interface ActivitySnapshotItem {
    id: string;
    title: string;
    status: string;
    detail: string;
    updatedAt: number;
    running: boolean;
    pendingKind?: string;
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
//# sourceMappingURL=activity.d.ts.map