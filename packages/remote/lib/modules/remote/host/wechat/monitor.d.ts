/**
 * 常驻消息监听：登录成功后用 token 长轮询 getUpdates。
 *
 * 游标（get_updates_buf）默认只存在内存里；如果传了 cursorStore（见 store.js），
 * 则游标会持久化到桥状态文件，重启后不丢。换 token / 换账号时必须清掉游标，
 * 否则首次拉取会跳过历史消息。
 *
 * 明确的取舍：getUpdates 是**消费型**接口，同一账号被两个消费者同时轮询会互相抢消息。
 * 因此只要本插件开着监听，别的桥接（例如 deepseek-harness-weixin）就拿不到同一条消息。
 * 该事实写进 README，并由 panel 的开关暴露给用户。
 */
export declare const STALE_RETRY_MESSAGE = "\u5FAE\u4FE1\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u6B63\u5728\u91CD\u8FDE\u2026";
export declare const STALE_INVALID_MESSAGE = "\u5FAE\u4FE1\u8FDE\u63A5\u5DF2\u5931\u6548\uFF08\u53EF\u80FD\u5728\u5176\u4ED6\u8BBE\u5907\u91CD\u65B0\u767B\u5F55\uFF09\uFF0C\u8BF7\u70B9\u300C\u91CD\u65B0\u767B\u5F55\u300D";
/**
 * 创建一个监听器。
 * @param options.getCredential 每次操作前重新解析凭据（凭据可能被换掉）。
 * @param options.onMessage 收到消息时回调，参数是脱敏摘要与原始消息。
 * @param options.logger 宿主 logger；只记录诊断，不记录消息正文与 token。
 * @param options.cursorStore 可选 { get(): string, set(value: string): void }，用于持久化游标。
 */
export declare function createMonitor({ getCredential, onMessage, logger, onStateChange, cursorStore }?: any): {
    getState: () => any;
    start(): void;
    stop(): void;
    /** 单次探测（不常驻）：给「测试通道」按钮用。 */
    probe({ timeoutMs }?: any): Promise<{
        ok: boolean;
        reason: string;
        messages: number;
        invalid: boolean;
        idle?: undefined;
    } | {
        ok: boolean;
        reason: string;
        messages: number;
        invalid?: undefined;
        idle?: undefined;
    } | {
        ok: boolean;
        messages: any;
        reason?: undefined;
        invalid?: undefined;
        idle?: undefined;
    } | {
        ok: boolean;
        messages: number;
        idle: boolean;
        reason?: undefined;
        invalid?: undefined;
    }>;
    dispose(): void;
};
//# sourceMappingURL=monitor.d.ts.map