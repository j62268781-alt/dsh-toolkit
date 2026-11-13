/**
 * 探测每个 MCP 服务器的连接状态。
 *
 * 为什么不劫持 `register`：最初的做法是包裹 `mcpResources.register` 来记下每个实例的
 * `connection.resources`，但真机上 `instances` 一直是空的 —— profile 重新组装时
 * `dsh-mcp-resources` 会换成**新的服务实例**，而一次性写下的影子留在旧实例上，之后所有
 * 注册都从旁边走过去了。这类「装上了但收不到东西」的失败最坏：面板会显示得像是正常。
 *
 * 现在改用服务自己的公开方法 `request(server, request, exec)` —— 它内部会按调用者的
 * scope 解析 provider，所以每次调用都重新解析、不受实例更替影响，也不需要劫持任何东西。
 * 三种回答恰好覆盖我们要区分的三种情况：
 *
 *   · 正常返回（或服务器回「方法不支持」这类**别的**错误）→ 客户端活着且连着；
 *   · `server is disconnected` → provider 在，但客户端没连着（未连接）；
 *   · `unavailable in this agent's scope` → 压根没有 provider（没挂载 / 激活失败）。
 *
 * 第二、三种的区分是关键：前者是「连不上」，后者是「实例不在」，两者要给的提示完全不同。
 */
/** 探测结果取值。 */
export declare const PROBE_STATE: Readonly<{
    connected: "connected";
    down: "down";
    absent: "absent";
    unknown: "unknown";
}>;
/**
 * 建一个探测器。
 *
 * @param ctx - 带 `mcpResources` 服务的 cordis 上下文。**每次探测都重新解析**该服务，
 *   因为 profile 重新组装会换实例。
 * @param log - `{ warn }`，用于必须上报而不是抛出的路径。
 * @returns `{ available, reason, probe }`。`available()` 为 false 时不要下任何结论 ——
 *   面板会显示「状态未知」，这比猜一个状态诚实。
 */
export declare function createConnectionProbe(ctx: any, log: any): {
    /** 观测机制现在可用吗。 */
    available: () => boolean;
    reason: () => "" | "mcpResources service unavailable";
    /**
     * 问一次「这台服务器现在什么状态」。
     *
     * @param serverName - MCP 服务器名。
     * @param options.agent - 该项目级服务器所在 agent 的 scope；全局行不需要。
     * @param options.timeoutMs - 超时。
     * @returns `{ state, detail }`，`state` 取 {@link PROBE_STATE} 之一。
     */
    probe: (serverName: any, options?: any) => Promise<{
        state: "unknown";
        detail: string;
    } | {
        state: "connected";
        detail: string;
    } | {
        state: "absent";
        detail: string;
    } | {
        state: "down";
        detail: string;
    }>;
};
//# sourceMappingURL=probe.d.ts.map