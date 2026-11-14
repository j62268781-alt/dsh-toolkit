/** 回调路径。`redirect_uri` 由 Host 用 `webServer.getOrigin()` + 它拼出。 */
export declare const CALLBACK_PATH = "/dsh-toolkit-skills-mcp/oauth/callback";
/**
 * 注册回调路由。
 *
 * @param ctx - 带 `webServer` 的 cordis 上下文。
 * @param options.path - 回调路径（默认 {@link CALLBACK_PATH}）。
 * @param options.servers - `() => [{ serverName, transport, url }]`，当前所有
 *   streamable-http 服务器。回调里**没有**服务器名，所以要用 `state` 反查是哪一台：
 *   做法是逐个比对（每台的 `pending.state` 都是独立随机值，定长比较，不会泄漏）。
 * @param options.flow - `createOAuthFlow()` 的返回值。
 * @param options.onAuthorized - 授权成功后的回调，宿主用它刷新状态/重建连接。
 * @param options.snapshot - `() => Map<serverName, { ... }>`，把结果留给面板显示。
 * @param options.log - `{ warn }`。
 * @returns `{ installed, reason }`，装不上时如实说。
 */
export declare function registerOAuthCallback(ctx: any, options?: any): {
    installed: boolean;
    reason: string;
};
/** 极小的 HTML 转义：页面里出现的都是服务器名与错误文本，必须挡住注入。 */
export declare function escapeHtml(value: any): string;
//# sourceMappingURL=callback.d.ts.map