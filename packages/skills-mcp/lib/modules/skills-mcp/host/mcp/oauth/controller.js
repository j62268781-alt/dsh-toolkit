import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { loaderOf } from '../../runtime/rows.js';
import { serverRows } from '../serverRows.js';
import { OAuthCommand } from '../../config.js';
import { openExternalUrl } from './browser.js';
import { createOAuthStore } from './store.js';
import { createOAuthProvider } from './provider.js';
import { loadSdk, oauthSdkReasonText } from './sdk.js';
import { installTransportPatch, makeAuthProvider, patchReasonText } from './patch.js';
import { createOAuthFlow } from './flow.js';
import { CALLBACK_PATH, registerOAuthCallback } from './callback.js';
import { registerOAuthRoute } from './route.js';
import { Singleflight } from '../../../../../host/singleflight.js';
/** OAuth state, transport patch, commands and refresh lifecycle for one plugin scope. */
export function createOAuthController(ctx) {
    // ── OAuth ────────────────────────────────────────────────────────────────────────────
    //
    // Everything below exists because `dsh-mcp-client` never passes an `authProvider` to the
    // SDK: `createTransport()` gives `StreamableHTTPClientTransport` only
    // `{ requestInit: { headers } }`, so the SDK's `if (401 && this._authProvider)` branch can
    // never run. A protected server's 401 is therefore retried like a network fault and finally
    // reported as "gave up" — the panel said the server was broken when all it needed was a
    // grant. `src/mcp/auth.js` already *detects* that; this half *fixes* it.
    //
    // Three pieces, each of which can fail independently and is reported as a reason:
    //   1. `sdk.js`     — resolve the SDK that ships inside the app runtime (the plugin's own
    //                     `node_modules` has no `@modelcontextprotocol/client`).
    //   2. `patch.js`   — inject `_authProvider` on each transport's `start()`, because
    //                     `authProvider` can only arrive through the constructor.
    //   3. `flow.js` + `callback.js` — run the authorization-code flow and receive the code.
    //
    // Loaded lazily and asynchronously: a failed *optional* capability must never stop the
    // plugin from loading (a rejected `apply()` takes every other plugin down with it).
    const oauthStore = createOAuthStore({ dshHome: resolveDshHome(), log: { warn: (message) => ctx.logger.warn(message) } });
    /** Last authorize/login result per server, so the card can report what just happened. */
    const oauthResultCache = new Map();
    /** Last on-disk authorization state per server, refreshed off the publish path. */
    const oauthStatusCache = new Map();
    const oauthStatusFlights = new Singleflight();
    /**
     * Kick a projection refresh now instead of waiting for the 5 s publish interval.
     *
     * Late-bound on purpose: `tick` and `publish` are declared further down in `apply()` (one
     * at the bottom, one inside the settings injection), while the OAuth helpers that need them
     * are declared here. A plain reference would be a TDZ error at call time. The settings
     * injection assigns the real implementation; until then this is a no-op, which is the safe
     * direction — the periodic publish still runs.
     */
    let kickProjection = () => { };
    /** `{ ok, sdk } | { ok: false, reason, detail }` once the SDK load settles. */
    let oauthSdk = null;
    let oauthReady = { ready: false, reason: '', detail: '', sdkVersion: '' };
    let oauthFlow = null;
    let oauthCallbackReady = false;
    let oauthCallbackPath = '';
    /**
     * A provider factory bound to this plugin's store.
     *
     * `redirectUri` has to be built from the live `webServer` origin: the listener may bind a
     * port chosen by the OS, so it cannot be known before `listen`. Rebuilt on every call
     * rather than captured once — a different port would otherwise produce a `redirect_uri`
     * the server rejects.
     */
    const oauthRedirectUri = () => {
        // `ctx.get('webServer')`, NOT `ctx.webServer`.
        //
        // This plugin's `inject` list is `['loader']`, so a bare `ctx.webServer` is always
        // undefined at this level — the service is only reachable through `ctx.get()`, or inside
        // one of the `ctx.inject([...])` callbacks. Reading `.webServer` directly returned '' and
        // the projection published an empty `redirectUri`, which makes the SDK treat the flow as
        // **non-interactive** (`redirectUrl === undefined` → it skips the whole authorization-code
        // branch). That failure is silent: `ready` still says true and the button still appears.
        //
        // Re-resolved on every call rather than captured once, for the same reason
        // `src/mcp/probe.js` does it: the profile recreates services on recomposition, and a
        // captured instance would go stale while still looking installed.
        try {
            const service = ctx.get?.('webServer') ?? null;
            if (service === null || service === undefined)
                return '';
            const origin = service.getOrigin?.();
            if (typeof origin !== 'string' || origin === '')
                return '';
            return `${origin}${CALLBACK_PATH}`;
        }
        catch {
            // `getOrigin()` throws before the listener binds a port — expected during startup.
            return '';
        }
    };
    const makeOAuthProvider = (serverName, url) => createOAuthProvider({
        store: oauthStore,
        serverName,
        url,
        redirectUri: oauthRedirectUri(),
        onRedirect: async (authorizeUrl) => {
            // The transport path (401 during normal operation) reaches here too. There is no panel
            // request waiting for it, so record it where the status projection will find it.
            oauthResultCache.set(serverName, {
                ok: true, kind: 'redirect', reason: '', text: '这台服务器需要授权：点「授权」按钮完成登录',
                detail: '', authorizeUrl, at: new Date().toISOString(),
            });
            kickProjection();
        },
        log: { warn: (message) => ctx.logger.warn(message) },
    });
    /**
     * Look up the provider for a transport about to start.
     *
     * The patch calls this with the transport's `_url`; we map back to a configured server.
     * Only `streamable-http` rows are candidates — stdio has no HTTP status code to challenge.
     * Returns `null` when the server has no saved credentials, so an unauthenticated server
     * behaves exactly as before.
     */
    const oauthLookup = (targetUrl) => {
        if (oauthSdk === null || oauthSdk.ok !== true || oauthFlow === null)
            return null;
        let origin = '';
        let href = '';
        try {
            const parsed = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl));
            origin = parsed.origin;
            href = parsed.href;
        }
        catch {
            return null;
        }
        if (origin === '')
            return null;
        for (const server of candidateServers()) {
            if (String(server?.transport ?? '') !== 'streamable-http')
                continue;
            const rowUrl = String(server?.url ?? '');
            if (rowUrl === '')
                continue;
            let rowHref = '';
            try {
                rowHref = new URL(rowUrl).href;
            }
            catch {
                continue;
            }
            if (rowHref !== href)
                continue;
            const serverName = String(server.serverName ?? '');
            if (serverName === '')
                continue;
            let made;
            try {
                // The **flow's** instance, not a new one.
                //
                // Each provider caches the credential record in memory. Building a second instance
                // here gave the transport its own stale "no tokens" snapshot: after the user
                // authorized, `flow.complete()` wrote the token through its instance, the transport
                // kept reading the other one, and the server answered 401 forever while the panel
                // showed 「已授权」. One server must have exactly one provider.
                made = oauthFlow.providerFor(serverName, rowUrl);
            }
            catch (error) {
                ctx.logger.warn('dsh-skills-mcp-manager: cannot build an OAuth provider for %s: %s', serverName, String(error?.message ?? error));
                return null;
            }
            if (made === undefined || made === null)
                return null;
            return {
                provider: makeAuthProvider({
                    sdk: oauthSdk.sdk,
                    oauthProvider: made.provider,
                    log: { warn: (message) => ctx.logger.warn(message) },
                    serverName,
                    /**
                     * 明文端点的 401 处理：先让 flow 自己换一次令牌。
                     *
                     * SDK 的 `auth()` 在存在 refresh_token 时无条件走它的刷新，而那条路上的 TLS
                     * 检查会抛 InsecureTokenEndpointError 且不吞掉 —— 结果是「令牌过期 → 每次重试
                     * 都以一个与令牌无关的错失败」。刷新成功就不用麻烦用户；失败才去要一次授权。
                     *
                     * 只在 flow 已经建好时提供；没有 flow 就没有 OAuth，这条路径本来也走不到。
                     */
                    prepareAuth: oauthFlow === null ? undefined : () => oauthFlow.prepareAuth(serverName, rowUrl),
                }),
                oauthProvider: made.provider,
            };
        }
        return null;
    };
    /** Every configured server, both tiers. Rows are the single source of truth. */
    /**
     * Every configured MCP server, as `serverRows` produced it.
     *
     * **Deliberately not a hand-written projection.** It used to be
     * `rows.map((row) => ({ serverName, transport, url, scope }))`, and when the OAuth half
     * later needed `allowInsecureTokenEndpoint`, that field was silently missing — the switch
     * in the panel wrote `true` to the row, `candidateServers()` dropped it on the way out, and
     * the exchange refused with 「允许明文 token 端点没有打开」while the box was visibly ticked.
     *
     * This repo has now shipped that same mistake three times (a hand-written field list left
     * out `toolCallTimeoutMs`, the `connectionChanged` comparison, and this one). The fix that
     * stops it recurring is not "remember to add the field" — it is to stop re-listing fields.
     * Consumers read what they need off the row.
     */
    const candidateServers = () => {
        try {
            return serverRows([...(loaderOf(ctx)?.entries?.() ?? [])]);
        }
        catch {
            return [];
        }
    };
    /**
     * Load the SDK and install the transport patch, once.
     *
     * Ordered before anything else in `apply()` that could construct a transport: this plugin
     * is a **bundle-layer** plugin while the MCP rows live in the profile's own patch, and the
     * profile composes bundle patches first — so a patch installed here lands ahead of every
     * row's `apply()`. That ordering is why the injection is possible at all.
     */
    const bootstrapOAuth = async () => {
        // `import.meta.resolve` is the only way to find the host package from inside a plugin:
        // `@deepseek-ai/dsh-mcp-client` is a peer dependency, so its own `file:` URL is the one
        // reliable anchor for the runtime's `node_modules`.
        let hostUrl = '';
        try {
            hostUrl = import.meta.resolve('@deepseek-ai/dsh-mcp-client');
        }
        catch (error) {
            oauthReady = { ready: false, reason: 'no-host-package-url', detail: String(error?.message ?? error), sdkVersion: '' };
            ctx.logger.warn('dsh-skills-mcp-manager: OAuth support unavailable — %s', oauthReady.detail);
            return;
        }
        const loaded = await loadSdk(hostUrl);
        oauthSdk = loaded;
        if (loaded.ok !== true) {
            oauthReady = { ready: false, reason: String(loaded.reason ?? ''), detail: oauthSdkReasonText(loaded), sdkVersion: '' };
            ctx.logger.warn('dsh-skills-mcp-manager: OAuth support unavailable — %s (%s)', oauthReady.detail, String(loaded.detail ?? ''));
            return;
        }
        const patched = installTransportPatch({
            sdk: loaded.sdk,
            lookup: oauthLookup,
            log: { warn: (message) => ctx.logger.warn(message) },
        });
        if (patched.installed !== true) {
            oauthReady = { ready: false, reason: String(patched.reason ?? ''), detail: patchReasonText(patched.reason), sdkVersion: loaded.version };
            ctx.logger.warn('dsh-skills-mcp-manager: OAuth support unavailable — %s (%s)', oauthReady.detail, String(patched.detail ?? ''));
            return;
        }
        // Verify with a real instance: every step above can "succeed" while the final header is
        // still missing, and a button that can never work is worse than no button.
        const verified = await patched.verify();
        if (verified.ok !== true) {
            oauthReady = { ready: false, reason: String(verified.reason ?? ''), detail: patchReasonText(verified.reason), sdkVersion: loaded.version };
            ctx.logger.warn('dsh-skills-mcp-manager: OAuth support unavailable — %s (%s)', oauthReady.detail, String(verified.detail ?? ''));
            return;
        }
        ctx.effect(() => () => { try {
            patched.uninstall?.();
        }
        catch { /* best effort */ } }, 'dsh-skills-mcp-manager.oauth.patch');
        oauthFlow = createOAuthFlow({
            store: oauthStore,
            getSdk: () => (oauthSdk?.ok === true ? oauthSdk : { ok: false, reason: String(oauthSdk?.reason ?? ''), detail: String(oauthSdk?.detail ?? '') }),
            makeProvider: makeOAuthProvider,
            /**
             * Whether this server may use a **plaintext** token endpoint.
             *
             * Read from the row on every call, never cached: the user can toggle the checkbox and
             * retry without restarting, and a cached `true` would keep the exception alive after it
             * was switched off — the one direction that must never lag.
             *
             * A missing row or a missing field answers `false`: the default has to be "refuse".
             */
            allowInsecure: (serverName) => {
                const row = candidateServers().find((entry) => entry.serverName === serverName);
                return row?.allowInsecureTokenEndpoint === true;
            },
            /**
             * 当前的回调地址。
             *
             * 桌面版把端口写死成 `--port 0`（`dsh-desktop-host` 的启动参数里），所以每次启动
             * 端口都不同；而动态注册的 `client_id` 与注册时的 `redirect_uri` 绑定。把「此刻
             * 的地址」交给 flow，它就能在启动授权前发现旧绑定并重新注册 —— 用户不必因为重启
             * 一次 DSH 就去清一遍凭据。
             */
            currentRedirectUri: () => oauthRedirectUri(),
            log: { warn: (message) => ctx.logger.warn(message) },
        });
        oauthReady = { ready: true, reason: '', detail: '', sdkVersion: loaded.version };
        ctx.logger.info('dsh-skills-mcp-manager: OAuth support installed (MCP SDK %s)', loaded.version);
    };
    const oauthBootstrapped = bootstrapOAuth().catch((error) => {
        // Never let an optional capability reject out of apply().
        oauthReady = { ready: false, reason: 'bootstrap-failed', detail: String(error?.message ?? error), sdkVersion: '' };
        ctx.logger.warn('dsh-skills-mcp-manager: OAuth bootstrap failed — %s', oauthReady.detail);
    });
    /*
     * Why starting this asynchronously is safe even though the patch must land before a
     * transport is constructed.
     *
     * The window is real: `apply()` is synchronous and returns before the SDK `import()`
     * resolves, so an MCP row that activates in that window would build its transport
     * unpatched. It is *self-healing* for the only case that matters, though:
     *
     *   · a server that needs authorization answers 401, so its FIRST attempt fails;
     *   · `dsh-mcp-client` then retries with backoff, and every retry constructs a **fresh**
     *     `Client` and a **fresh** transport (`connectGeneration` → `createTransport`), whose
     *     `start()` our patch now covers;
     *   · the SDK import takes single-digit milliseconds, while the first retry is ≥ 500 ms.
     *   · a server that does NOT need authorization never consults `_authProvider`, so a
     *     missed first injection costs nothing.
     *
     * Making `apply()` async to remove the window was considered and rejected: Cordis treats a
     * plugin whose `apply` never settles as a hung load, and a hung load takes the whole profile
     * down — a far worse failure than one extra retry.
     */
    /** OAuth commands over HTTP (see `src/mcp/oauth/route.js` for why not the settings queue). */
    const runOAuthCommand = async (op) => {
        await oauthBootstrapped;
        const action = String(op?.action ?? '');
        const serverName = String(op?.serverName ?? '');
        const server = candidateServers().find((entry) => entry.serverName === serverName);
        if (server === undefined)
            return { ok: false, reason: `找不到服务器 ${serverName}`, text: '' };
        if (oauthReady.ready !== true)
            return { ok: false, reason: oauthReady.detail, text: oauthReady.detail };
        if (action === 'status') {
            const status = await oauthFlow.status(serverName, String(server.url ?? ''));
            return { ok: true, reason: '', text: '', ...status };
        }
        if (action === 'authorize') {
            const result = await oauthFlow.begin(serverName, String(server.url ?? ''));
            /**
             * 拿到授权链接就**直接拉起系统浏览器**。
             *
             * 这是用户点「授权」时的全部期望：点一下，浏览器开了，登录完回来就好。让用户先
             * 复制一段 URL 再自己粘到地址栏，是把这个流程里唯一需要机器做的事留给人工。
             *
             * 打开失败**不让授权失败**：链接依然是有效的，会照常返回给面板显示（用户还能手动
             * 复制）。但失败原因必须回传，否则「点了没反应」就无从排查 —— 这个仓库已经在
             * 「装上了但没生效」上踩过两次。
             */
            let opened = null;
            if (result.kind === 'redirect' && typeof result.authorizeUrl === 'string' && result.authorizeUrl !== '') {
                opened = openExternalUrl({ url: result.authorizeUrl, log: { warn: (message) => ctx.logger.warn(message) } });
            }
            oauthResultCache.set(serverName, { ...result, opened, at: new Date().toISOString() });
            kickProjection();
            const finished = result.kind === 'redirect' || result.kind === 'authorized';
            return {
                ok: finished,
                reason: finished ? '' : String(result.detail || result.reason || ''),
                text: String(result.text ?? ''),
                opened,
                ...result,
            };
        }
        if (action === 'logout') {
            const result = await oauthFlow.logout(serverName);
            oauthResultCache.set(serverName, { ok: true, kind: 'logout', reason: '', text: result.text, detail: '', at: new Date().toISOString() });
            kickProjection();
            return { ok: true, reason: '', ...result };
        }
        return { ok: false, reason: `未知的 OAuth 操作：${action}`, text: '' };
    };
    /**
     * Refresh one server's on-disk authorization state, at most once per TTL.
     *
     * Fire-and-forget for the same reason as {@link refreshProbe}: `publish` is synchronous
     * and must never await a disk read. Credentials change only when the user authorizes or
     * logs out, so a slow cadence is honest rather than lazy.
     *
     * Deliberately silent about tokens: the cache holds only the four facts the panel needs.
     */
    const OAUTH_STATUS_TTL_MS = 15000;
    /**
     * 到期前多久开始主动刷新。
     *
     * 5 分钟是「足够久，不会因为一次失败就断档」与「足够近，刷新出来的令牌还有意义」之间
     * 的折中：短于它，一次网络抖动就可能让令牌过期；长于它，等于不停地换新令牌，把
     * refresh_token 的轮换次数（有些服务器每次刷新都会作废旧 refresh_token）翻倍。
     */
    const OAUTH_REFRESH_BEFORE_MS = 5 * 60 * 1000;
    /** 检查间隔。比「提前量」小一个数量级，才可能在窗口内动手。 */
    const OAUTH_REFRESH_SWEEP_MS = 60 * 1000;
    /** 正在刷新的服务器，避免同一台被连点几次刷出多个并发刷新。 */
    const oauthRefreshing = new Set();
    const refreshOAuthStatus = (serverName, url) => {
        if (oauthFlow === null)
            return;
        const cached = oauthStatusCache.get(serverName);
        const now = Date.now();
        if (cached !== undefined && now - Date.parse(String(cached.readAt ?? '')) < OAUTH_STATUS_TTL_MS)
            return;
        void oauthStatusFlights.run(serverName, () => oauthFlow.status(serverName, url), {
            onValue: (status) => {
                // `at` = when credentials last changed; `readAt` alone drives the cache TTL.
                oauthStatusCache.set(serverName, { ...status, readAt: new Date().toISOString(), at: String(status.updatedAt ?? '') });
            },
            onError: (error) => {
                // Keep the previous answer on a failed read; failure is not equivalent to no credentials.
                ctx.logger.warn('dsh-skills-mcp-manager: cannot read OAuth state for %s: %s', serverName, String(error?.message ?? error));
            },
        }).catch(() => { });
    };
    /**
     * 在令牌到期前主动刷新。
     *
     * 为什么不能只靠 401 触发：那要等到**下一次请求已经失败**才动手。对 MCP 来说，一次
     * 失败不是一个请求的失败 —— 客户端会退避重试，最终把整个服务器标成「已放弃」并把
     * 工具全部下掉，用户这时才看到问题，而且看到的是一台「坏了的服务器」。
     *
     * 所以：在窗口内先换新令牌，下一次连接自然就是有效的。
     *
     * 只处理「有 refresh_token 且知道到期时间」的服务器 —— 不知道到期时间的令牌无法预判，
     * 那类仍然只能等 401。
     */
    const sweepOAuthRefresh = () => {
        if (oauthFlow === null)
            return;
        const now = Date.now();
        for (const { serverName, transport, url } of candidateServers()) {
            if (transport !== 'streamable-http' || url === '')
                continue;
            if (oauthRefreshing.has(serverName))
                continue;
            const cached = oauthStatusCache.get(serverName);
            if (cached === undefined || cached.present !== true || cached.refreshable !== true)
                continue;
            const expiresAt = Date.parse(String(cached.expiresAt ?? ''));
            // 没有到期时间 / 解析不了：不猜。猜错的代价是拿一个还有效的令牌去换新的，
            // 而有些服务器会因此作废旧的那份。
            if (!Number.isFinite(expiresAt))
                continue;
            if (expiresAt - now > OAUTH_REFRESH_BEFORE_MS || expiresAt - now <= 0)
                continue;
            oauthRefreshing.add(serverName);
            Promise.resolve(oauthFlow.refresh(serverName, url))
                .then((result) => {
                if (result.ok === true) {
                    ctx.logger.info('dsh-skills-mcp-manager: %s 的令牌已在到期前刷新', serverName);
                    // 让卡片立刻看到新的到期时间，而不是等下一个 15 秒的 TTL。
                    oauthStatusCache.delete(serverName);
                    kickProjection();
                    return;
                }
                ctx.logger.warn('dsh-skills-mcp-manager: %s 的令牌预刷新失败（%s）：%s', serverName, result.reason, result.detail);
            })
                .catch((error) => {
                ctx.logger.warn('dsh-skills-mcp-manager: %s 的令牌预刷新异常：%s', serverName, String(error?.message ?? error));
            })
                .finally(() => oauthRefreshing.delete(serverName));
        }
    };
    const installSweep = () => {
        /** Token pre-refresh. Runs without a panel; it only touches the credential files. */
        ctx.effect(() => {
            const timer = setInterval(sweepOAuthRefresh, OAUTH_REFRESH_SWEEP_MS);
            return () => clearInterval(timer);
        }, 'dsh-skills-mcp-manager.oauth-sweep');
    };
    const registerRoutes = ({ invalidateServerCaches, reconnectServer }) => {
        // ── OAuth: command route + browser callback ─────────────────────────────────────────
        //
        // Registered on the same `webServer` service the row/skill routes use. The callback is
        // the only route in this plugin that **cannot** carry `connection.requestRejection`:
        // the browser arrives from the authorization server's 302, which has no DSH session
        // cookie, so that check would 401 every callback and authorization could never finish.
        // Its security boundary is the one-time `state` instead (see `src/mcp/oauth/state.js`).
        ctx.inject(['webServer', 'connection'], (oauthRouteCtx) => {
            registerOAuthRoute(oauthRouteCtx, {
                // Only the action and the target are accepted; everything else is ours to decide.
                schema: (payload) => OAuthCommand(payload),
                run: runOAuthCommand,
            });
            const registered = registerOAuthCallback(oauthRouteCtx, {
                servers: () => candidateServers(),
                flow: {
                    checkCallback: async (...args) => {
                        await oauthBootstrapped;
                        if (oauthFlow === null)
                            return { ok: false, reason: 'no-authorization-in-progress' };
                        return oauthFlow.checkCallback(...args);
                    },
                    complete: async (serverName, url, code) => {
                        await oauthBootstrapped;
                        if (oauthFlow === null)
                            return { ok: false, reason: 'oauth-sdk-unavailable', detail: '', text: 'OAuth 支持未安装' };
                        const done = await oauthFlow.complete(serverName, url, code);
                        // The client's own retry loop has already given up by the time a user authorizes
                        // (10 attempts with backoff). A fresh instance is the only way back.
                        try {
                            oauthStatusCache.delete(serverName);
                        }
                        catch { /* cache miss is harmless */ }
                        return done;
                    },
                },
                onAuthorized: async (serverName) => {
                    // 授权一完成就自己重连，不等用户回面板再点一次。重连是命令，直接走任务函数。
                    ctx.logger.info('dsh-skills-mcp-manager: %s finished OAuth authorization, reconnecting', serverName);
                    invalidateServerCaches(serverName);
                    const target = candidateServers().find((entry) => entry.serverName === serverName);
                    const tier = target !== undefined && String(target.scope ?? '') === 'global' ? 'global' : 'project';
                    void reconnectServer({ tier, serverName }).catch((error) => {
                        ctx.logger.warn('dsh-skills-mcp-manager: reconnect after OAuth failed: %s', String(error?.message ?? error));
                    });
                },
                snapshot: () => oauthResultCache,
                log: { warn: (message) => ctx.logger.warn(message) },
            });
            oauthCallbackReady = registered.installed === true;
            oauthCallbackPath = registered.installed === true ? CALLBACK_PATH : `unavailable: ${registered.reason}`;
            if (registered.installed !== true) {
                ctx.logger.warn('dsh-skills-mcp-manager: OAuth callback route unavailable — %s', registered.reason);
            }
        });
    };
    return {
        statusCache: oauthStatusCache,
        invalidateStatus: (serverName) => oauthStatusFlights.invalidate(serverName),
        get ready() { return oauthReady; },
        get callbackReady() { return oauthCallbackReady; },
        get callbackPath() { return oauthCallbackPath; },
        redirectUri: oauthRedirectUri,
        refreshStatus: refreshOAuthStatus,
        installSweep,
        registerRoutes,
    };
}
//# sourceMappingURL=controller.js.map