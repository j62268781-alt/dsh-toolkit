/**
 * transport 原型补丁：把 `AuthProvider` 塞进 `StreamableHTTPClientTransport`。
 *
 * ## 为什么非得打补丁
 *
 * `dsh-mcp-client` 的 `createTransport()` 是模块内私有函数（未导出），构造 transport 时
 * 只传了 `requestInit: { headers }`，**没有任何 auth 字段**：
 *
 * ```js
 * case "streamable-http": return new StreamableHTTPClientTransport(
 *   new URL(config.url), { requestInit: { headers: config.headers } });
 * ```
 *
 * 而 `authProvider` 只能从**构造参数**进入。所以第三方唯一能插手的位置，是在
 * `createTransport` 执行之前或者之后改「这个类」或「这个实例」。
 *
 * ## 为什么打在 `start()` 上
 *
 * `Client.connect(transport)` 必调 `transport.start()`，而 Streamable HTTP 的
 * `start()` 只建 `AbortController`，**不发 HTTP**（实测 2.2.0：`start()` 里只有两行）。
 * 真正的首个请求在 `_startOrAuth()` / `_send()` 里，而它们都会先 `await _commonHeaders()`
 * —— 那里读 `this._authProvider`。所以在 `start()` 返回前把 provider 挂上，时效是成立的。
 *
 * ## 为什么必须命中 ESM 那一份 class
 *
 * SDK 是双包，`import "…/index.mjs"` 与 `require("…")`（→ `index.cjs`）拿到的是
 * **两个不同的 class 对象**（实测 `===` 为 false）。`dsh-mcp-client` 是 `"type": "module"`，
 * 走 ESM。补丁打在 CJS 那份上不会报错 —— 它只是永远不生效，表现是「点了授权没反应，
 * 日志里什么都没有」。`sdk.js` 已经保证只返回 ESM 入口。
 *
 * ## 能力检测与降级
 *
 * 私有字段（`_authProvider`、`_commonHeaders`、`_startOrAuth`）都是打包产物里的实现细节，
 * 版本升级可能改名。所以：
 *   · 打之前检查 `start` 存在、实例上 `_authProvider` 是可写自有属性；
 *   · 打之后**用真实例验一次** `_commonHeaders()` 真的带上了 `Authorization`；
 *   · 任何一步不成立就返回原因，面板显示「OAuth 支持未安装 + 原因」。
 * 静默失败是这类补丁最坏的结局：用户看到一个按钮，点它永远不会成功。
 */
/** 补丁安装失败的原因取值。 */
export declare const PATCH_REASONS: Readonly<{
    noTransportClass: "no-transport-class";
    noStart: "transport-start-missing";
    notExtensible: "transport-prototype-not-extensible";
    noCommonHeaders: "transport-common-headers-missing";
    injectFailed: "auth-provider-injection-failed";
}>;
/**
 * 判断某个 transport 实例是否该被注入，以及注入什么。
 *
 * 由调用方提供（见 `src/index.js`），因为「这台服务器要不要 OAuth」是我们自己的配置，
 * 不是 SDK 的概念。
 *
 * @callback LookupProvider
 * @param {URL} url - transport 的目标地址。
 * @returns {{ provider: object, oauthProvider: object } | null} 需要注入时返回两个形态：
 *   `provider` 是极简 `{ token, onUnauthorized }`（transport 直接消费），
 *   `oauthProvider` 是完整的 `OAuthClientProvider`（供 `finishAuth` 与 403 step-up 用）。
 */
/**
 * 构造极简 `AuthProvider`。
 *
 * 这就是 SDK 未导出的 `adaptOAuthProvider()` 的等价实现 —— 它不是公开 API（实测导出表里
 * 没有），所以这里用公开导出的 `auth()` + `extractWWWAuthenticateParams()` 复刻其行为：
 *
 *   · `token()`：每请求读一次当前 access token（**这是刷新能生效的根本原因**）；
 *   · `onUnauthorized()`：收到 401 时跑一次 `auth()`，它内部会先用 refresh_token 续期，
 *     没有 refresh_token 才走完整授权；返回 `AUTHORIZED` 后 transport 自动重试一次。
 *
 * `REDIRECT` 不是一个「失败」，它是「需要用户去授权」的正常分支：此时把 URL 交出去
 * （provider 的 `redirectToAuthorization` 已经记下），然后抛一个可辨识的错误让
 * 客户端停止重试 —— 继续重试只会把 10 次预算耗尽，然后显示「已放弃重试」。
 */
export declare function makeAuthProvider({ sdk, oauthProvider, log, serverName, prepareAuth }: any): {
    token(): Promise<any>;
    onUnauthorized(ctx: any): Promise<void>;
};
/**
 * 安装补丁。
 *
 * HMR 幂等：原型是全局对象，重载会再次调用本函数。用 `Symbol.for` 找上一次的补丁，
 * 只**替换 lookup**，不再叠一层 wrapper（叠层会让同一次 start 注入多次，
 * 并让卸载变得不可能）。
 *
 * @param options.sdk - `sdk.js` 返回的已加载 SDK。
 * @param options.lookup - {@link LookupProvider}。
 * @param options.log - `{ warn }`。
 * @returns `{ installed, reason, detail, verify, uninstall }`。
 */
export declare function installTransportPatch({ sdk, lookup, log }?: any): {
    installed: boolean;
    reason: "no-transport-class";
    detail: string;
    verify?: undefined;
    uninstall?: undefined;
    reused?: undefined;
} | {
    installed: boolean;
    reason: string;
    detail: string;
    verify: any;
    uninstall: any;
    reused: boolean;
} | {
    installed: boolean;
    reason: "transport-start-missing";
    detail: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function";
    verify?: undefined;
    uninstall?: undefined;
    reused?: undefined;
} | {
    installed: boolean;
    reason: "transport-common-headers-missing";
    detail: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function";
    verify?: undefined;
    uninstall?: undefined;
    reused?: undefined;
} | {
    installed: boolean;
    reason: "transport-prototype-not-extensible";
    detail: string;
    verify?: undefined;
    uninstall?: undefined;
    reused?: undefined;
};
/** 补丁不可用时的中文说明。缺什么就说什么，不给一句泛泛的「不支持」。 */
export declare function patchReasonText(reason: any): "MCP SDK 里没有 StreamableHTTPClientTransport，OAuth 不可用" | "MCP SDK 的 transport 结构与预期不同（start 缺失），OAuth 不可用" | "MCP SDK 的 transport 结构与预期不同（请求头构造缺失），OAuth 不可用" | "MCP SDK 的 transport 原型不可扩展，OAuth 不可用" | "OAuth provider 注入后验证失败（SDK 版本可能已变），OAuth 不可用" | "OAuth 支持未安装";
//# sourceMappingURL=patch.d.ts.map