/**
 * 内网明文 token 端点：一个**默认关闭、必须显式勾选**的例外。
 *
 * ## 为什么需要它
 *
 * SDK 的 `executeTokenRequest` 里有一道无条件的检查：
 *
 * ```js
 * function assertSecureTokenEndpoint(tokenEndpoint) {
 *   const url = new URL(String(tokenEndpoint));
 *   if (url.protocol !== "https:" && !isLoopbackHost(url.hostname))
 *     throw new InsecureTokenEndpointError(url.href);
 * }
 * ```
 *
 * 这是 MCP 授权规范的要求，也是对的：明文 HTTP 上交换令牌等于把 `refresh_token`
 * 广播给同网段任何能嗅探的设备。所以本模块**不修改那道检查**，也不 patch SDK ——
 * SDK 的编排（发现、DCR、PKCE、刷新）继续服务所有 HTTPS 服务器，一行不动。
 *
 * 对于显式勾选「允许明文 token 端点」的服务器，本模块**自己完成最后一步**：
 * 按 RFC 6749 §4.1.3 发一个 `application/x-www-form-urlencoded` 的 POST。
 * 那是整个 OAuth 里最简单的一步（一个表单），自己写比 patch 一个没有公开扩展点的
 * 私有实现更好维护，也让「我们在明文上做了什么」变得可读、可测、可审计。
 *
 * ## 安全边界（三条，缺一不可）
 *
 * 1. **默认关闭**。`allowInsecureTokenEndpoint` 为 `false` 时本模块完全不被调用。
 * 2. **只对显式勾选的服务器生效**。它是每台服务器自己的字段，不存在「全局打开」。
 * 3. **每次明文请求都记一条 warning**。用户可以事后在日志里查到自己开了什么。
 *
 * 它还**不做**这些事（刻意的）：
 *   · 不放宽 SSRF 保护（只影响 token 交换这一个请求）；
 *   · 不影响发现、DCR、authorize —— 那些仍然走 SDK，仍然受它自己的策略约束；
 *   · 不缓存令牌到额外的地方（落盘仍由 `store.js` 负责，权限同样 0600）。
 *
 * ## 不 import 宿主、不 import SDK
 *
 * 纯 `fetch` + 字符串处理，所以能在 CI 上完整单测（CI 上没有宿主 node_modules）。
 */
/** 哪些 token 端点会被 SDK 拒绝？只按 SDK 的判定复刻，不自己发明规则。 */
export declare function isLoopbackHost(hostname: any): any;
/**
 * 这个 token 端点会被 SDK 拒绝吗？
 *
 * @param tokenEndpoint - 要检查的 URL 字符串。
 * @returns `{ insecure: true, host }` 当且仅当非 https 且非回环；否则 `{ insecure: false }`。
 *   解析失败也算 `insecure: false`（交给下游按它自己的错误处理，本模块不猜）。
 */
export declare function insecureTokenEndpoint(tokenEndpoint: any): {
    insecure: boolean;
    host?: undefined;
    protocol?: undefined;
} | {
    insecure: boolean;
    host: string;
    protocol: string;
};
/** 换令牌失败的原因取值。 */
export declare const TOKEN_EXCHANGE_ERRORS: Readonly<{
    notAllowed: "insecure-token-endpoint-not-allowed";
    badEndpoint: "token-endpoint-unresolvable";
    network: "token-request-failed";
    http: "token-endpoint-rejected";
    badBody: "token-response-invalid";
}>;
/** 人话错误。面板直接展示。 */
export declare function tokenExchangeErrorText(reason: any, detail?: any): string;
/**
 * 直接向明文 token 端点换令牌。
 *
 * @param options.tokenEndpoint - 授权服务器元数据里的 `token_endpoint`。
 * @param options.params - 要发送的表单字段（已包含 grant_type 等）。
 * @param options.clientId - 公共客户端的 `client_id`（`token_endpoint_auth_method: none`）。
 * @param options.fetchImpl - 注入的 fetch（测试用）。
 * @param options.timeoutMs - 超时，默认 20s。
 * @param options.log - `{ warn }`：**每次调用都要留痕**，这是这个例外的前提条件。
 * @returns `{ ok: true, tokens }` 或 `{ ok: false, reason, detail, text }`。永不抛错。
 */
export declare function exchangeInsecureToken({ tokenEndpoint, params, clientId, fetchImpl, timeoutMs, log, }?: any): Promise<{
    ok: boolean;
    reason: "token-endpoint-unresolvable";
    detail: string;
    text: string;
    tokens?: undefined;
} | {
    ok: boolean;
    reason: "token-request-failed";
    detail: string;
    text: string;
    tokens?: undefined;
} | {
    ok: boolean;
    reason: "token-endpoint-rejected";
    detail: string;
    text: string;
    tokens?: undefined;
} | {
    ok: boolean;
    reason: "token-response-invalid";
    detail: string;
    text: string;
    tokens?: undefined;
} | {
    ok: boolean;
    tokens: any;
    reason?: undefined;
    detail?: undefined;
    text?: undefined;
}>;
/**
 * 把令牌响应收敛成 SDK 期望的形状。
 *
 * 只保留 SDK 的 `OAuthTokensSchema` 认识、且我们确实要用的字段 —— 抛掉未知字段，避免
 * 把服务器返回的意外内容一路写进凭据文件。
 *
 * @param body - 解析后的 JSON。
 * @returns 令牌对象，或 null（不是合法令牌）。
 */
export declare function validateTokens(body: any): any;
//# sourceMappingURL=insecure.d.ts.map