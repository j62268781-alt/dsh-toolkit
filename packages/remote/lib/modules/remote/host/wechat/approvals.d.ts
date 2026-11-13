/**
 * 把 DSH 的审批请求（approval/request）转发到微信，并把用户的回复翻译成审批结论。
 *
 * 为什么需要它：微信是一条异步的、可能延迟很久的通道，
 * 而 approval/request 是同步 waterfall —— 必须返回一个结论。
 * 因此这里用「挂起 + 等待回复 + 超时取消」的方式桥接：
 *   · 一个用户同时只允许一个待审批请求（第二个直接拒绝，避免串台）；
 *   · 超时（默认 120s）返回 'cancelled'，让 Agent 侧的这次调用干净地结束；
 *   · 结论只能是 allowed-once / rejected / cancelled / unavailable 之一。
 */
/** 把用户回复归类为允许/拒绝；不是审批回答时返回 undefined。 */
export declare function parseApprovalAnswer(text: any): "allowed-once" | "rejected";
/**
 * 审批请求发到微信时的提示文案。
 *
 * 带上会话 id：DSH 里同时可能开着多个会话，收到「需要授权」时必须知道
 * 这是哪一条会话在等 —— 否则回 /approve 就是在盲批。
 * @param {object} request approval/request 的载荷
 * @param {{ sessionId?: string }} [context] 发起请求的会话
 */
export declare function approvalPrompt(request: any, context?: any): string;
/**
 * @param options.notify (userId, text) => Promise<void>：把提示发到微信
 * @param options.onSettled (userId, outcome) => void：可选，用于面板/日志
 */
export declare function createApprovals({ notify, logger, timeoutMs, onSettled }?: any): {
    /** 是否有待审批请求（用于把用户的下一条消息优先解释成审批回答）。 */
    hasPending(userId: any): boolean;
    /**
     * 处理一条 approval/request：发微信询问并等待回复。
     * @returns Promise<'allowed-once'|'rejected'|'cancelled'|'unavailable'>
     */
    request(userId: any, request: any, context?: any): Promise<unknown>;
    /**
     * 用户回复了一条消息：若它是对待审批请求的回答，返回 true 并结束等待。
     * @returns {boolean} 是否消费了这条消息
     */
    answer(userId: any, text: any): boolean;
    /** 这个用户当前待审批的是哪条会话（没有则 undefined）。 */
    pendingSessionOf(userId: any): any;
    /** 待审批请求数（状态接口用）。 */
    size(): number;
    /** 模块卸载：所有挂起请求按取消处理。 */
    dispose(): void;
};
//# sourceMappingURL=approvals.d.ts.map