/**
 * 微信 ↔ DSH 双向桥。
 *
 * 数据流：
 *   monitor（唯一 getupdates 消费者）→ bridge.handleMessage(raw)
 *     → 过滤 Bot 自己的消息 / 白名单 / 去重
 *     → 斜杠命令或审批回答（不进入 Agent）
 *     → 其余交给 conversation.js 跑一轮，再把回复发回微信
 *
 * 这里只做「编排」：状态、策略、去重、typing、错误兜底。
 * 协议细节在 api.js，会话生命周期在 conversation.js，入站转换在 inbound.js。
 */
/**
 * 创建桥接器。
 * @param options.ctx       宿主 ctx
 * @param options.settings  readConfig 的结果（含 bridge* 字段）
 * @param options.getCredential () => Promise<credential|undefined>
 * @param options.logger
 */
export declare function createBridge({ ctx, settings, getCredential, logger, createApi, createStore, createConversationManager, }?: any): {
    handleMessage: (message: any) => Promise<void>;
    status: () => {
        enabled: boolean;
        ready: boolean;
        accessPolicy: any;
        allowCount: any;
        allowFrom: any;
        received: number;
        replied: number;
        skipped: number;
        failed: number;
        pendingApprovals: number;
        conversation: any;
        sessionBound: boolean;
        sessionSource: any;
        awaitingChoice: boolean;
        lastUserId: string;
        canAllowRecent: boolean;
        store: any;
        lastReplyAt: any;
        lastError: any;
        lastTypingError: any;
        workspace: any;
    };
    /**
     * 启动时预热：把落盘状态读进来，让面板上的开关/策略一启动就正确。
     * 没有凭据时静默失败（等登录成功后再调一次）。
     */
    warmup(): Promise<void>;
    /** 面板上的「发送测试消息」：默认发给最近一次给自己发消息的用户。 */
    sendTest(userId: any, text?: string): Promise<{
        enabled: boolean;
        ready: boolean;
        accessPolicy: any;
        allowCount: any;
        allowFrom: any;
        received: number;
        replied: number;
        skipped: number;
        failed: number;
        pendingApprovals: number;
        conversation: any;
        sessionBound: boolean;
        sessionSource: any;
        awaitingChoice: boolean;
        lastUserId: string;
        canAllowRecent: boolean;
        store: any;
        lastReplyAt: any;
        lastError: any;
        lastTypingError: any;
        workspace: any;
    }>;
    /** 运行时切换访问策略（同时落盘到桥状态文件）。 */
    setAccess(patch?: any): Promise<{
        enabled: boolean;
        ready: boolean;
        accessPolicy: any;
        allowCount: any;
        allowFrom: any;
        received: number;
        replied: number;
        skipped: number;
        failed: number;
        pendingApprovals: number;
        conversation: any;
        sessionBound: boolean;
        sessionSource: any;
        awaitingChoice: boolean;
        lastUserId: string;
        canAllowRecent: boolean;
        store: any;
        lastReplyAt: any;
        lastError: any;
        lastTypingError: any;
        workspace: any;
    }>;
    /** 登录状态变化时调用：断开重连后重建 api（账号可能已经换了）。 */
    reset: () => void;
    dispose(): Promise<void>;
    readonly ready: boolean;
    readonly cursor: {
        get: () => any;
        set: (value: any) => void;
    };
};
//# sourceMappingURL=bridge.d.ts.map