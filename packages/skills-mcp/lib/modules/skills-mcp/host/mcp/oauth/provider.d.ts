/**
 * `OAuthClientProvider` 的实现 —— SDK 与本次落盘之间的适配层。
 *
 * ## 它解决的是什么问题
 *
 * `@modelcontextprotocol/client` 的 `StreamableHTTPClientTransport` 接受
 * `authProvider`（2.0.0 起），SDK 用它做三件事：每次请求前取 access token、
 * 401 时回调 `onUnauthorized` 触发刷新、`auth()` 编排里逐步读写中间状态。
 * 而 `dsh-mcp-client` 构造 transport 时**只传 `requestInit.headers`**，从不传
 * `authProvider` —— 于是 SDK 的 401 分支永不成立，客户端按普通网络故障重试到放弃。
 *
 * 本模块就是那个缺失的 provider。它不发起任何流程（那是 `flow.js` 的事），
 * 只回答 SDK 的读写问题。
 *
 * ## 与 SDK 的契约要点
 *
 * · **`tokens()` 会被无参调用**（transport 每请求取一次）。SDK 的文档明确要求这种情况
 *   返回「最近保存的那一份」，而不是 `undefined`。凭据按服务器隔离，所以这里天然满足。
 * · `redirectUrl` / `clientMetadata` 是 **getter**，不是方法。写成方法的话 SDK 读到的是
 *   函数对象，OAuth 请求会带上错误的 `redirect_uri`，且不会抛错。
 * · `state()` / `codeVerifier()` 必须回放 `auth()` 之前存下的值，否则回调腿校验失败。
 * · `saveDiscoveryState()` / `discoveryState()` 是可选的，但**强烈建议实现**：
 *   SDK 在回调腿用它做授权服务器绑定校验（SEP-2352），缺失时只会打一条 warning，
 *   然后放弃这道防线。我们实现它，是为了让那道校验真的生效。
 *
 * ## 不 import SDK
 *
 * 值的形状（`StoredOAuthTokens` 等）都是普通 JSON，SDK 不导出运行时校验函数需要的东西。
 * 保持这个模块无依赖，才能在 CI 上单测（CI 没有宿主 `node_modules`）。
 */
/** `clientMetadata` 的默认值。DCR 会拿它注册，所以字段要保守、不要声明不需要的能力。 */
export declare function defaultClientMetadata(redirectUri: any): {
    client_name: string;
    redirect_uris: any[];
    grant_types: string[];
    response_types: string[];
    token_endpoint_auth_method: string;
};
/**
 * 建一个 provider。
 *
 * @param options.store - `createOAuthStore()` 的返回值。
 * @param options.serverName - 服务器名，凭据按它隔离。
 * @param options.url - 这台服务器的 MCP 端点；`redirectUrl` 的模板由它派生。
 * @param options.redirectUri - 回调地址（由 webServer 的 origin 拼出）。
 * @param options.onRedirect - 收到授权 URL 时调用。`flow.js` 用它把 URL 交给面板，
 *   而不是真的去开浏览器（DSH 官方登录也是「复制链接」而不是自动拉起浏览器）。
 * @param options.log - `{ warn }`。
 * @returns 一个满足 `OAuthClientProvider` 的对象。
 */
export declare function createOAuthProvider({ store, serverName, url, redirectUri, onRedirect, log, }?: any): {
    provider: {
        /**
         * 回调地址。
         *
         * 返回 `undefined` 会让 SDK 认为这是一条**非交互**流程（`client_credentials` 等），
         * 从而跳过整个授权码分支 —— 那正是我们要走的路径，所以这里必须是有值的。
         */
        readonly redirectUrl: any;
        /** DCR 注册用的元数据。 */
        readonly clientMetadata: {
            redirect_uris: any;
            client_name: string;
            grant_types: string[];
            response_types: string[];
            token_endpoint_auth_method: string;
        };
        /**
         * CSRF 用的 `state`。
         *
         * 每轮新生成。SDK 的调用顺序是 `state()` → `startAuthorization()` →
         * `saveCodeVerifier()` → `redirectToAuthorization()`，所以这里先生成并**记在闭包里**，
         * 等 `redirectToAuthorization()` 再落盘 —— 那时才知道授权 URL，两者要一起存。
         * 若在 `state()` 就落盘，一次失败的授权会留下一个 state，下一轮要覆盖它，中间有一小段
         * 窗口里回调能对上一条已经作废的记录。
         */
        state(): string;
        clientInformation(): Promise<any>;
        saveClientInformation(clientInformation: any): Promise<void>;
        /**
         * 当前令牌。
         *
         * transport 每发一个请求都调它一次（**无参**），所以这条路径必须便宜：
         * 命中内存缓存的返回值，不碰磁盘、不做时间判断。过期与否交给
         * `onUnauthorized` 的 401 触发 —— 那才是权威信号，猜时间只会提前失效。
         */
        tokens(): Promise<any>;
        saveTokens(tokens: any): Promise<void>;
        /**
         * SDK 要求「把用户带到这个 URL」。
         *
         * 我们**不**开浏览器，也不阻塞：DSH 官方登录同样是「复制登录链接 → 用户自己打开」，
         * 而这里若真的去 spawn `open`，在无头/远程场景下会静默失败且无从诊断。
         * 因此只把 URL 交给上层，由面板展示。`flow.js` 负责把 `pending` 记录下来，
         * 以便回调腿校验与超时清理。
         */
        redirectToAuthorization(authorizationUrl: any): Promise<void>;
        saveCodeVerifier(codeVerifier: any): Promise<void>;
        codeVerifier(): Promise<any>;
        saveDiscoveryState(state: any): Promise<void>;
        discoveryState(): Promise<any>;
        saveResourceUrl(resource: any): Promise<void>;
    };
    snapshot: () => Promise<any>;
    invalidate: () => void;
};
/** 32 字节的 base64url，纯随机，不依赖 crypto 的模块形态（浏览器/Node 都有 getRandomValues）。 */
export declare function randomState(): string;
/** 授权链接是否还在有效期内（面板据此决定「重新授权」还是「继续授权」）。 */
export declare function pendingIsFresh(record: any, now?: number): boolean;
/** 令牌的粗粒度可读状态，供面板显示。 */
export declare function tokenStatus(record: any, now?: number): {
    present: boolean;
    refreshable: boolean;
    expiresAt: string;
    expired: boolean;
};
//# sourceMappingURL=provider.d.ts.map