/**
 * MCP 服务器的连接状态推导。
 *
 * 为什么需要推导而不是直接读：`@deepseek-ai/dsh-mcp-client` 把重试状态完全关在闭包
 * 里（`failedAttempts`、`reconnectTimer`、`connectedAt` 都没有任何导出），而
 * `connection.ready` 只代表**第一次**尝试的结果 —— 它 resolve 之后重试仍在后台继续，
 * 所以拿它当“最终状态”会误判。可观测的只有三样东西：
 *
 *   1. 该服务器此刻有没有活跃的 mcp-client 实例（由 `watch.js` 的注册点监听得到）；
 *   2. 该实例是否真的连着（探测 `resources/list`：客户端在未连接时会在**发出请求前**
 *      就抛 "server is disconnected"，所以任何**别的**回答都说明客户端是活的）；
 *   3. 该行的 `reconnect` 配置 —— 由此可以算出它总共会重试多久。
 *
 * 于是“重试中 / 已放弃”是按预算与已耗时**推导**出来的，不是客户端上报的。界面上必须
 * 如实说成“预计”，否则一个推导值会被当成事实。这一点见 `SERVER_STATUS_TEXT`。
 *
 * 纯函数、不 import 宿主，便于直接单测。
 */
/** 与 dsh-mcp-client 的 RECONNECT_DEFAULTS 保持一致（配置留空时客户端就用这些值）。 */
export declare const RECONNECT_DEFAULTS: Readonly<{
    enabled: true;
    initialDelayMs: 500;
    maxDelayMs: 30000;
    maxAttempts: 10;
}>;
/** 状态取值。文案与判据分开，界面只消费取值。 */
export declare const SERVER_STATUS: Readonly<{
    /** 已连接：探测确认客户端活着。 */
    connected: "connected";
    /** 未连接，且按预算推算仍在重试窗口内。 */
    retrying: "retrying";
    /** 未连接，且按预算推算已经用尽重试次数（永久失效，需重连）。 */
    gaveUp: "gave-up";
    /** 该启用却没看到任何实例：多半是 failOnStartupError 让插件激活失败。 */
    failed: "failed";
    /** 还没观测到实例，仍在宽限期内（启动瞬间不要闪告警）。 */
    pending: "pending";
    /** 项目级条目：当前没有该项目作用域的会话，所以还没挂载 —— 不是故障。 */
    unmounted: "unmounted";
    /** 用户停用了它。 */
    disabled: "disabled";
    /**
     * 服务器要求先授权（OAuth）才能连接。
     *
     * **这不是故障**：受保护的服务器在未授权时拒绝连接是协议规定的正常行为，
     * 但它与「连不上」在界面上长得一样，而两者要做的事完全不同（去授权 vs 去修服务器）。
     * 识别依据是 HTTP 401 的 Bearer 挑战 / 403 `insufficient_scope`，见 `src/mcp/auth.js`。
     */
    needsAuth: "needs-auth";
    /** 观测机制没装上（mcpResources 服务不可用），如实说明而不是猜。 */
    unknown: "unknown";
}>;
/** 状态标题（面板上的标签文字）。 */
export declare const SERVER_STATUS_TEXT: Readonly<{
    connected: "已连接";
    retrying: "未连接 · 重试中";
    "gave-up": "已放弃重试";
    failed: "激活失败";
    pending: "连接中";
    unmounted: "未挂载";
    disabled: "已停用";
    "needs-auth": "需要授权";
    unknown: "状态未知";
}>;
/**
 * 需要用户点「重连」的状态：它们都不会自己恢复。
 *
 * `needsAuth` **不在**这里：它缺的是授权而不是连接，「重连」按钮对它毫无意义
 * —— 应该给的是「去授权」的指引。把它塞进这里会教用户反复点一个治不好病的按钮。
 */
export declare const RECOVERABLE_STATUSES: readonly ("failed" | "gave-up")[];
/** 鉴权挑战的状态：界面据此给出「去授权」而不是「重连」。 */
export declare const AUTH_STATUSES: readonly "needs-auth"[];
/** 解析一行/一条目的重连接收配置，留空处用客户端默认值补上。 */
export declare function reconnectPolicy(raw: any): {
    enabled: boolean;
    initialDelayMs: any;
    maxDelayMs: any;
    maxAttempts: any;
};
/**
 * 从首次连接失败到彻底放弃之间的总时长。
 *
 * 复刻客户端的退避序列 `min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1))`：它会在
 * 第 `maxAttempts` 次失败后再安排一次，那次也失败才打印 "giving up"。
 *
 * `maxAttempts` 可以很大（表单允许到安全整数），所以一旦延迟触顶就整段求和，不做
 * 逐次循环 —— 否则一个 `maxAttempts: 100000` 会把面板卡住。
 */
export declare function reconnectBudgetMs(raw: any): number;
/**
 * 推导一台服务器的状态。
 *
 * @param input.serverName - 服务器名（用于回报）。
 * @param input.enabled - 配置里是否启用。
 * @param input.expected - 此刻**应该**有实例吗。项目级条目在没有该项目的会话时是
 *   false —— 那不是故障，所以与「该有却没有」必须分开。
 * @param input.observed - 观测机制是否可用。false 时不下任何结论。
 * @param input.phase - 权威的激活阶段：`pending`/`loading`/`active`/`failed`/`unloading`/''。
 *   全局行取自 Loader entry 的 fiber，项目级取自本插件挂载时拿到的 fiber。
 * @param input.hasInstance - 观测机制是否看到了活跃实例（次一级信号）。
 * @param input.connected - 探测结果：true 连着 / false 未连接 / null 未知。
 * @param input.elapsedMs - 从首次观测到「未连接」起已经过去多久。
 * @param input.budgetMs - 该服务器的重试预算总长。
 * @param input.graceMs - 实例出现前的宽限期（启动瞬间不闪告警）。
 * @param input.authChallenge - 该服务器的鉴权挑战（`{ kind, ... }`，见 `src/mcp/auth.js`）；
 *   null/undefined = 没观测到挑战。只有在**未连接**时才参与判定。
 * @param input.hasCredentials - 磁盘上是否已经有一份（未过期的）授权凭据。
 *   有凭据却仍然 401，说明**服务器不认这份令牌**，那不是一个「去授权就好」的状态 ——
 *   再点一次授权也不会好。这种时候让「未连接/重试中」的判定说话，而不是贴一个会误导
 *   用户的「需要授权」。
 * @returns 状态取值之一。
 */
export declare function deriveStatus(input: any): "unknown" | "pending" | "failed" | "disabled" | "connected" | "retrying" | "gave-up" | "unmounted" | "needs-auth";
/** 供界面展示的剩余时间（秒），推导值。 */
export declare function remainingSeconds(elapsedMs: any, budgetMs: any): number;
//# sourceMappingURL=status.d.ts.map