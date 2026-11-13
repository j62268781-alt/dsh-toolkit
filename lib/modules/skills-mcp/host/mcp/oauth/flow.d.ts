/** 发起授权的失败原因。 */
export declare const FLOW_ERRORS: Readonly<{
    noSdk: "oauth-sdk-unavailable";
    noUrl: "server-has-no-url";
    notHttp: "server-is-not-http";
    beginFailed: "authorization-could-not-start";
    stateMismatch: "oauth-state-mismatch";
    noPending: "no-authorization-in-progress";
    expired: "authorization-expired";
    completeFailed: "authorization-could-not-complete";
    /** 非 https 且非回环的 token 端点，且这台服务器没有勾选明文例外。 */
    insecureNotAllowed: "insecure-token-endpoint-not-allowed";
    /** 没有 refresh_token，只能让用户重新授权。 */
    notRefreshable: "no-refresh-token";
    /** 刷新被授权服务器拒绝（refresh_token 过期/被撤销）。 */
    refreshFailed: "refresh-rejected";
}>;
/** 失败原因的中文说明。面板直接展示，所以要说「下一步做什么」。 */
export declare function flowReasonText(reason: any): "OAuth 支持未安装（找不到 MCP SDK），无法发起授权" | "这台服务器没有可用的 URL，无法走 OAuth" | "只有 http(s) 服务器能走 OAuth；stdio 服务器请改用环境变量或请求头传凭据" | "发起授权失败" | "回调校验失败（state 不匹配），可能是伪造的回调或本轮授权已作废，请重新点「授权」" | "没有正在进行的授权：请先点「授权」，再在浏览器里完成登录" | "这次授权已经超时（超过 10 分钟），请重新点「授权」" | "完成授权失败" | "token 端点不是 https，而「允许明文 token 端点」没有为这台服务器打开。明文传输令牌会把凭据暴露给同网段，因此默认拒绝" | "这份凭据没有 refresh_token，刷新不了；需要重新授权一次" | "刷新令牌被授权服务器拒绝（refresh_token 可能已过期或被撤销），需要重新授权" | "授权失败";
/** 从 SDK 抛出的错误里取一段**能贴到面板上**的文字。 */
export declare function describeFlowError(error: any): string;
/**
 * 建一套流程。
 *
 * @param options.store - `createOAuthStore()`。用于读 pending / 清理凭据。
 * @param options.getSdk - 返回 `{ ok, sdk }` 或 `{ ok:false, reason }`。由 `src/index.js`
 *   传入一个已缓存的加载器，这样面板每次请求不必重新解析模块。
 * @param options.makeProvider - `(serverName, url) => { provider, snapshot, invalidate }`，
 *   注入以便测试替换。
 * @param options.log - `{ warn, info }`。
 */
export declare function createOAuthFlow({ store, getSdk, makeProvider, allowInsecure, currentRedirectUri, log }?: any): {
    forget: (serverName: any) => void;
    /** The shared provider for one server. See {@link providerFor} for why it must be shared. */
    providerFor: (serverName: any, url: any) => any;
    /** 面板读状态用：有没有令牌、会不会过期、是不是正等着用户去授权。 */
    status: (serverName: any, url: any) => Promise<{
        waiting: boolean;
        authorizeUrl: string;
        updatedAt: string;
        present: boolean;
        refreshable: boolean;
        expiresAt: string;
        expired: boolean;
    }>;
    /**
     * 发起授权。
     *
     * 三种结果都算「正常」，面板据此给出不同文案：
     *   · `authorized` —— 已有可用令牌 / refresh_token 直接续期成功，无需用户操作；
     *   · `redirect`   —— 拿到了一个授权 URL，要用户去浏览器完成；
     *   · `error`      —— 失败，带人话原因。
     */
    begin: (serverName: any, url: any) => Promise<{
        kind: string;
        reason: "server-has-no-url" | "server-is-not-http";
        detail: string;
        text: string;
        authorizeUrl?: undefined;
    } | {
        kind: string;
        reason: "oauth-sdk-unavailable";
        detail: string;
        text: string;
        authorizeUrl?: undefined;
    } | {
        kind: string;
        reason: "insecure-token-endpoint-not-allowed";
        detail: string;
        text: string;
        authorizeUrl?: undefined;
    } | {
        present: boolean;
        refreshable: boolean;
        expiresAt: string;
        expired: boolean;
        kind: string;
        reason: string;
        detail: string;
        text: string;
        authorizeUrl?: undefined;
    } | {
        kind: string;
        reason: "authorization-could-not-start";
        detail: string;
        text: string;
        authorizeUrl?: undefined;
    } | {
        kind: string;
        reason: string;
        detail: string;
        text: string;
        authorizeUrl: string;
    }>;
    /**
     * 校验回调里的 `state`，通过则返回 `{ ok: true, code }`。
     *
     * 这里是**本插件自己的**安全边界，不能省：
     *
     *   · 回调路由挂在 DSH 自己的监听端口上，任何能访问那个端口的东西都能发过来；
     *   · `state` 是唯一能证明「这次回调属于我刚刚发起的那一轮」的证据；
     *   · 必须**定长比较**（见 `state.js`）；
     *   · 必须**一次性**：`complete()` 成功后清掉 pending，重放会落到 `noPending`。
     */
    checkCallback: (serverName: any, receivedState: any, receivedCode: any, now?: number) => Promise<{
        ok: boolean;
        reason: "no-authorization-in-progress";
        code?: undefined;
    } | {
        ok: boolean;
        reason: "oauth-state-mismatch";
        code?: undefined;
    } | {
        ok: boolean;
        reason: "authorization-expired";
        code?: undefined;
    } | {
        ok: boolean;
        reason: "authorization-could-not-complete";
        code?: undefined;
    } | {
        ok: boolean;
        code: string;
        reason?: undefined;
    }>;
    /**
     * 用回调拿到的 code 完成授权。
     *
     * 成功之后必须**重置内存 provider**：旧实例里缓存的是「没有令牌」的那份记录，
     * 而 transport 每请求都读它。
     */
    complete: (serverName: any, url: any, code: any) => Promise<{
        ok: boolean;
        reason: "authorization-could-not-complete";
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "token-endpoint-unresolvable" | "token-request-failed" | "token-endpoint-rejected" | "token-response-invalid";
        detail: string;
        text: string;
    } | {
        present: boolean;
        refreshable: boolean;
        expiresAt: string;
        expired: boolean;
        ok: boolean;
        reason: string;
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "server-has-no-url" | "server-is-not-http";
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "oauth-sdk-unavailable";
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "insecure-token-endpoint-not-allowed";
        detail: string;
        text: string;
    }>;
    /** 登出：删掉凭据文件并丢掉内存缓存。 */
    /**
     * 用 refresh_token 换一份新令牌。
     *
     * 两条路径，与 `complete` 同源：https / 回环端点走 SDK 自己的 `refreshAuthorization`
     * （它的编排最成熟），非回环的明文端点走 `exchangeInsecureToken`（那一处 TLS 检查是
     * 无条件的，没法绕，只能自己发那一个表单）。落盘都走 `provider.saveTokens`，所以两种
     * 路径写出来的凭据语义完全一致。
     *
     * @param serverName - 服务器名。
     * @param url - 该服务器的 MCP 地址（定位凭据记录用）。
     * @returns `{ ok, reason, detail, text, ...tokenStatus }`。永不抛错。
     */
    /**
     * transport 在 401 上要用的「先自己刷新」判定。
     *
     * @returns `{ done: true }`（令牌已换好，直接重试）、`{ forceReauthorization: true }`
     *   （换不了，让 SDK 跳过它自己那次必然抛错的刷新），或 `null`（安全端点，不干预）。
     */
    prepareAuth: (serverName: any, url: any) => Promise<{
        forceReauthorization: boolean;
        done?: undefined;
    } | {
        done: boolean;
        forceReauthorization?: undefined;
    }>;
    refresh: (serverName: any, url: any) => Promise<{
        ok: boolean;
        reason: "server-has-no-url" | "server-is-not-http";
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "no-refresh-token";
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "insecure-token-endpoint-not-allowed";
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "refresh-rejected";
        detail: string;
        text: string;
    } | {
        present: boolean;
        refreshable: boolean;
        expiresAt: string;
        expired: boolean;
        ok: boolean;
        reason: string;
        detail: string;
        text: string;
    } | {
        ok: boolean;
        reason: "oauth-sdk-unavailable";
        detail: string;
        text: string;
    }>;
    logout: (serverName: any) => Promise<{
        ok: boolean;
        removed: boolean;
        text: string;
    }>;
};
//# sourceMappingURL=flow.d.ts.map