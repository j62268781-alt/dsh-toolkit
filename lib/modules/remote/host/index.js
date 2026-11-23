/**
 * Host 半边：远程连接。两个子目录各管一件事，本文件只负责装配：
 *   · wechat/ —— 微信扫码登录（ClawBot / iLink）与「微信 ↔ DSH Agent」双向桥；
 *   · mobile/ —— 手机扫码配对的本机支撑：可信设备清单（peers）、解绑后的残留清理、
 *     启动期按本地快照把已配对的连接接回来（resume.ts）。
 *
 * 职责边界：
 *   · 登录、通道自检，以及可选的「微信 ↔ DSH Agent」桥接（wechat/bridge.js）。
 *   · token 只经 ctx.credentials 存取，绝不进日志、绝不回前端。
 *   · 二维码 URL 是短生命周期凭据，只在 start() 的响应里回给前端，不打印。
 *
 * 路由（全部同源 fetch，无需 CORS）：
 *   GET  /api/plugins/toolkit/remote/status       当前状态（含 bridge）
 *   POST /api/plugins/toolkit/remote/login/start  发起扫码
 *   GET  /api/plugins/toolkit/remote/login/poll   前端轮询
 *   POST /api/plugins/toolkit/remote/login/code   回传数字校验码
 *   POST /api/plugins/toolkit/remote/login/cancel 取消扫码
 *   POST /api/plugins/toolkit/remote/logout       断开并清空凭据
 *   POST /api/plugins/toolkit/remote/probe        单次通道探测
 *   POST /api/plugins/toolkit/remote/monitor      开启/关闭常驻监听
 *   POST /api/plugins/toolkit/remote/bridge/test  发一条测试消息
 *   POST /api/plugins/toolkit/remote/bridge/access 改访问策略/白名单
 *   GET  /api/plugins/toolkit/remote/peers?serverUrl= 已信任手机的身份（重启后兜底）
 *   POST /api/plugins/toolkit/remote/local-state/purge?serverUrl= 解绑后清本机配对残留
 */
import { sendJson, readBody } from '../../../host/http.js';
import { registerAuthenticatedRoute, asHttpFailure, httpFailure } from '../../../host/routes.js';
import { createBridge } from './wechat/bridge.js';
import { Config, DEFAULT_CREDENTIAL_REF, readConfig } from './wechat/config.js';
import { createLoginManager } from './wechat/login.js';
import { createMonitor } from './wechat/monitor.js';
import { maskId, normalizeBaseUrl } from './wechat/ilink.js';
import { readTrustedPeers } from './mobile/peers.js';
import { purgePairingState } from './mobile/local-state.js';
import { createStartupResume } from './mobile/resume.js';
import { API_PATH } from './constants.js';
import { defaultPreferences, readPreferences, readPreferencesSync, writePreferences } from './preferences.js';
import { dshHome } from '../../../host/dsh-home.js';
import { join } from 'node:path';
export const name = 'dsh-toolkit-remote';
/**
 * 登录只需要这三样；双向桥额外依赖的宿主服务在服务创建时用 `ctx.inject` 按需装载，
 * 这样缺服务时登录/二维码仍然可用，不会把整个模块卡在 pending。
 */
export const inject = ['webServer', 'connection', 'credentials'];
/** 桥接需要的宿主服务。 */
const BRIDGE_SERVICES = [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionPersistence',
    'attachments',
    'sessionTitle',
    'llm',
];
export { API_PATH } from './constants.js';
/** 单条路由的最大请求体（这些接口只有小 JSON）。 */
const MAX_BODY = 4 * 1024;
/**
 * 解析已保存的凭据。返回 undefined 表示未连接；格式错误时抛出可读错误。
 * 该函数是唯一把 token 读进内存的地方，调用方负责不把它泄露出去。
 */
export async function resolveCredential(credentials, credentialRef) {
    const resolved = await credentials.resolve(credentialRef);
    if (resolved === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(resolved.value);
    }
    catch {
        throw new Error('已保存的微信凭据不是合法 JSON');
    }
    if (parsed === null || typeof parsed !== 'object')
        throw new Error('已保存的微信凭据不是对象');
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    const accountId = typeof parsed.accountId === 'string' ? parsed.accountId.trim() : '';
    if (token === '' || accountId === '')
        throw new Error('已保存的微信凭据缺少 token 或 accountId');
    return {
        token,
        accountId,
        baseUrl: normalizeBaseUrl(parsed.baseUrl),
        ...(typeof parsed.userId === 'string' && parsed.userId.trim() !== '' ? { userId: parsed.userId.trim() } : {}),
    };
}
/** 已连接时对外暴露的脱敏账号信息。 */
export function publicAccount(credential) {
    if (credential === undefined)
        return undefined;
    let host = '';
    try {
        host = new URL(credential.baseUrl).host;
    }
    catch {
        host = '';
    }
    return { accountId: maskId(credential.accountId), baseUrlHost: host };
}
/** 面板/圆点该按哪个状态显示：凭据还在不代表通道还通。 */
export function deriveConnectionState({ connected, loginState, monitorState }) {
    if (connected !== true)
        return loginState?.state;
    // 被别处登录顶掉后 token 会被服务端拒（getUpdates 回 -14），凭据却还在盘上。
    // 只看凭据会让面板一直显示「已连接」，实际上一条消息也进不来，用户毫无察觉。
    const broken = monitorState?.running === true
        && monitorState.connected === false
        && (monitorState.phase === 'stale' || monitorState.phase === 'invalid' || monitorState.phase === 'error');
    if (broken)
        return 'reconnecting';
    return loginState?.state === 'confirmed' ? 'confirmed' : 'connected';
}
export async function createClawbotService(ctx, config) {
    const settings = readConfig(config);
    const credentialRef = settings.credentialRef || DEFAULT_CREDENTIAL_REF;
    const logger = typeof ctx.logger === 'function' ? ctx.logger('remote') : undefined;
    let disposed = false;
    let lastMessage;
    let monitorEnabled = settings.monitorOnConnect;
    /** 唯一读凭据的入口（登录、探测、桥接共用）。 */
    const getCredential = () => resolveCredential(ctx.credentials, credentialRef);
    /**
     * 双向桥：等宿主把 agents/llm/attachments 等服务装上之后再创建。
     * 桥不在时其他功能照常工作，status 里会说明原因。
     */
    let bridge;
    ctx.inject(BRIDGE_SERVICES, (bridgeCtx) => {
        bridge = createBridge({ ctx: bridgeCtx, settings, getCredential, logger });
        logger?.info?.('[remote] 双向桥已装载');
        // 预热落盘状态：面板里的开关/策略/白名单一启动就要对上，而不是等第一条消息。
        void bridge.warmup();
    });
    const monitor = createMonitor({
        logger,
        getCredential,
        // 游标尽量持久化；桥还没装载时退化成空游标。
        cursorStore: {
            get: () => bridge?.cursor.get() ?? '',
            set: (value) => bridge?.cursor.set(value),
        },
        onMessage: (summary, rawMessage) => {
            lastMessage = summary;
            login.recordMessage(summary);
            // 桥接自己处理异常并计数，这里不 await，避免拖住长轮询。
            void bridge?.handleMessage(rawMessage);
        },
    });
    const login = createLoginManager({
        credentials: ctx.credentials,
        credentialRef,
        logger,
        onConnected: async (credential, session) => {
            lastMessage = undefined;
            if (session !== undefined)
                session.localTokens = [];
            // 账号可能变了：桥接的 api/store 必须按新账号重建，再按新账号预热状态。
            bridge?.reset();
            void bridge?.warmup();
            if (monitorEnabled)
                monitor.start();
        },
        onDisconnected: async () => {
            monitor.stop();
            lastMessage = undefined;
            bridge?.reset();
        },
    });
    /** 读一次凭据并给出完整状态；凭据异常不影响返回结构。 */
    async function snapshot() {
        let credential;
        let credentialError;
        try {
            credential = await resolveCredential(ctx.credentials, credentialRef);
        }
        catch (error) {
            credentialError = String(error?.message ?? error);
        }
        const loginState = login.status();
        const monitorState = monitor.getState();
        const connected = credential !== undefined;
        const state = deriveConnectionState({ connected, loginState, monitorState });
        return {
            ok: true,
            state,
            connected,
            credentialRef,
            account: publicAccount(credential),
            ...(credentialError === undefined ? {} : { credentialError }),
            qr: loginState.qrUrl === undefined
                ? undefined
                : { url: loginState.qrUrl, expiresAt: loginState.expiresAt, loginId: loginState.loginId },
            code: loginState.code,
            error: loginState.error,
            monitor: { enabled: monitorEnabled, ...monitorState },
            lastMessage: lastMessage ?? loginState.lastMessage,
            bridge: bridge?.status() ?? {
                enabled: settings.bridgeEnabled,
                ready: false,
                accessPolicy: settings.bridgeAccessPolicy,
                allowCount: settings.bridgeAllowFrom.length,
                received: 0,
                replied: 0,
                skipped: 0,
                failed: 0,
                pendingApprovals: 0,
                store: {},
                lastError: '宿主缺少桥接所需服务（agents / llm / attachments 等）',
            },
        };
    }
    // 启动时按配置恢复监听（已有凭据才有意义）。
    if (settings.enabled && monitorEnabled) {
        void resolveCredential(ctx.credentials, credentialRef)
            .then((credential) => {
            if (disposed || credential === undefined)
                return;
            monitor.start();
        })
            .catch((error) => {
            logger?.warn?.('[remote] 恢复监听失败：%s', String(error?.message ?? error));
        });
    }
    return {
        snapshot,
        /**
         * 申请二维码。
         *
         * @param force 为 false（默认）时，只要登录管理器手里还有一张未过期的码就复用它；
         *   面板上的「刷新二维码」按钮才传 true，明确要求换一张新的。
         */
        async startLogin(force = false) {
            if (disposed)
                throw new Error('插件已停止');
            let localTokens = [];
            try {
                const existing = await resolveCredential(ctx.credentials, credentialRef);
                if (existing !== undefined)
                    localTokens = [existing.token];
            }
            catch {
                // 旧凭据坏了不该阻止重新登录。
            }
            await login.start({ localTokens, force: force === true });
            return snapshot();
        },
        async submitCode(code) {
            login.submitCode(code);
            return snapshot();
        },
        async cancelLogin() {
            login.cancel();
            return snapshot();
        },
        async logout() {
            await login.logout();
            lastMessage = undefined;
            return snapshot();
        },
        async probe() {
            const result = await monitor.probe({ timeoutMs: 10_000 });
            return { ...result, snapshot: await snapshot() };
        },
        /** 发一条测试消息（默认发给最近一位给自己发过消息的人）。 */
        async sendTestMessage(text) {
            if (bridge === undefined)
                throw new Error('宿主缺少桥接所需服务，无法发送测试消息');
            await bridge.sendTest(undefined, typeof text === 'string' && text.trim() !== '' ? text.trim() : undefined);
            return snapshot();
        },
        /** 改访问策略 / 白名单（落盘到桥状态文件，重启后仍生效）。 */
        async setBridgeAccess(patch) {
            if (bridge === undefined)
                throw new Error('宿主缺少桥接所需服务，无法修改访问策略');
            await bridge.setAccess(patch ?? {});
            return snapshot();
        },
        async setMonitor(enabled) {
            monitorEnabled = enabled === true;
            if (disposed)
                return snapshot();
            if (!monitorEnabled) {
                monitor.stop();
            }
            else {
                const credential = await resolveCredential(ctx.credentials, credentialRef);
                if (credential !== undefined)
                    monitor.start();
            }
            return snapshot();
        },
        async dispose() {
            disposed = true;
            monitor.dispose();
            login.dispose();
            await bridge?.dispose();
        },
        get monitorEnabled() {
            return monitorEnabled;
        },
    };
}
/**
 * 读取可选 JSON 请求体。
 *
 * 与 `login/code` / `monitor` 那种「必须有 body」的路由不同，`login/start` 不带 body
 * 也是合法调用（等价于 `{ force: false }`），所以这里一律容错：没有 req.on（测试里的
 * 假请求对象）、空 body、坏 JSON，统统当成「没传参数」，交给调用方用默认值。
 */
async function readOptionalJson(req) {
    if (typeof req?.on !== 'function')
        return undefined;
    try {
        const text = await readBody(req, MAX_BODY);
        if (text.trim() === '')
            return undefined;
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/**
 * 注册插件路由。
 *
 * 所有接口都在鉴权之后，且强制 `cache-control: no-store`：它们要么带副作用，
 * 要么返回一次性数据（二维码、凭据状态）。
 */
/**
 * 注册 ClawBot 路由。
 *
 * `target` 既可以是服务实例，也可以是「取当前服务」的函数——面板上的
 * 微信开关会在运行期启停服务，路由必须每次请求都取最新的那一个；
 * 服务已停时统一 409，而不是让面板看到一堆 500。
 */
export function registerClawbotRoutes(ctx, target, ready) {
    const serviceOf = typeof target === 'function' ? target : () => target;
    const service = () => {
        const current = serviceOf();
        if (current === null || current === undefined)
            throw httpFailure(409, 'clawbot-disabled');
        return current;
    };
    // 显式标注：混着「无参 handler」与「(req) handler」的元素会被推断成 (string | fn)[]，
    // 拿到 run 之后就无法调用。这里声明的形状与实际调用 (run(req, res)) 一致。
    const routes = [
        ['status', 'GET', async () => service().snapshot()],
        [
            'login/start', 'POST',
            async (req) => {
                const payload = await readOptionalJson(req);
                return service().startLogin(payload?.force === true);
            },
        ],
        ['login/poll', 'GET', async () => service().snapshot()],
        ['login/cancel', 'POST', async () => service().cancelLogin()],
        ['logout', 'POST', async () => service().logout()],
        ['probe', 'POST', async () => service().probe()],
        [
            'login/code', 'POST',
            async (req) => {
                let payload;
                try {
                    payload = JSON.parse(await readBody(req, MAX_BODY));
                }
                catch {
                    throw httpFailure(400, '请求体不是合法 JSON');
                }
                return service().submitCode(String(payload?.code ?? ''));
            },
        ],
        [
            'monitor', 'POST',
            async (req) => {
                let payload;
                try {
                    payload = JSON.parse(await readBody(req, MAX_BODY));
                }
                catch {
                    throw httpFailure(400, '请求体不是合法 JSON');
                }
                return service().setMonitor(payload?.enabled === true);
            },
        ],
        [
            'bridge/test', 'POST',
            async (req) => {
                const payload = await readOptionalJson(req);
                return service().sendTestMessage(payload?.text);
            },
        ],
        [
            'bridge/access', 'POST',
            async (req) => {
                let payload;
                try {
                    payload = JSON.parse(await readBody(req, MAX_BODY));
                }
                catch {
                    throw httpFailure(400, '请求体不是合法 JSON');
                }
                return service().setBridgeAccess({
                    enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : undefined,
                    policy: payload?.policy,
                    allowFrom: payload?.allowFrom,
                    allowRecent: payload?.allowRecent === true,
                });
            },
        ],
    ];
    for (const [suffix, method, run] of routes) {
        registerAuthenticatedRoute(ctx, {
            kind: 'exact',
            path: `${API_PATH}/${suffix}`,
            async handler(req, res) {
                res.setHeader('cache-control', 'no-store');
                // 这些接口都带副作用或一次性数据，绝不缓存。
                if (req.method !== method)
                    return sendJson(res, 404, { ok: false, reason: 'not-found' });
                // 服务是异步起的：等初值那一步落定再判「有没有起来」，否则第一眼必是 409。
                if (ready !== undefined)
                    await ready;
                try {
                    return sendJson(res, 200, await run(req, res));
                }
                catch (error) {
                    const status = asHttpFailure(error, 400).status;
                    return sendJson(res, status, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    }
}
/**
 * 配对 tab 的兜底身份：会话记录被回收、localStorage 又随端口换 origin 之后，
 * 只有 ds-harness-remote 落盘的 trusted-peers.json 还记得这台手机是谁。
 *
 * 它属于「手机连接」而不是 ClawBot，所以不受 enabled 开关影响：只读文件，
 * 不带凭据、不带副作用，和微信登录状态无关。
 */
function registerPeersRoute(ctx) {
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: `${API_PATH}/peers`,
        async handler(req, res) {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET')
                return sendJson(res, 404, { ok: false, reason: 'not-found' });
            try {
                const url = new URL(String(req?.url ?? '/'), 'http://localhost');
                const serverUrl = url.searchParams.get('serverUrl') ?? '';
                if (serverUrl.trim() === '') {
                    return sendJson(res, 400, { ok: false, error: '缺少 serverUrl' });
                }
                const { peers } = await readTrustedPeers({ serverUrl });
                return sendJson(res, 200, { ok: true, peers });
            }
            catch (error) {
                // serverScope 对非法地址抛 400；读盘失败（权限等）是 500，别谎称「没配对过」。
                const status = asHttpFailure(error, 500).status;
                return sendJson(res, status, { ok: false, error: String(error?.message ?? error) });
            }
        },
    });
}
/**
 * 解绑之后的善后：删掉上游解绑没管的残留（「本机只被控」策略 + 旧的 client 角色目录）。
 *
 * 上游 `settings.logout` 只清凭据与身份记录，`pairing-host-only.json` 会留下来；
 * 重启后它把本机继续当成「配对主机」，面板于是把一次普通的未授权讲成
 * 「配对授权已被移除」——用户明明已经解绑，看到的还是旧配对那套说法。
 *
 * 只由本插件的面板在解绑后调用，属于「手机连接」而不是 ClawBot，所以不受 enabled 开关影响。
 */
function registerLocalStateRoute(ctx) {
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: `${API_PATH}/local-state/purge`,
        async handler(req, res) {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'POST')
                return sendJson(res, 404, { ok: false, reason: 'not-found' });
            try {
                const url = new URL(String(req?.url ?? '/'), 'http://localhost');
                const serverUrl = url.searchParams.get('serverUrl') ?? '';
                if (serverUrl.trim() === '') {
                    return sendJson(res, 400, { ok: false, error: '缺少 serverUrl' });
                }
                const { dir, hostOnly, removed } = await purgePairingState({ serverUrl });
                return sendJson(res, 200, { ok: true, dir, hostOnly, removed });
            }
            catch (error) {
                // serverScope 对非法地址抛 400；删盘失败（占用/权限）是 500，别谎称「已经清干净」。
                const status = asHttpFailure(error, 500).status;
                return sendJson(res, status, { ok: false, error: String(error?.message ?? error) });
            }
        },
    });
}
/**
 * 「移动端」设置面板的开关：读/写 `$DSH_HOME/toolkit/remote-preferences.json`。
 *
 * 两个开关都是本插件自己的功能位（见 preferences.ts 的注释）：微信这一位由宿主直接启停桥接；
 * 手机入口这一位只负责「菜单里给不给这个入口」，关掉时客户端会再走一次解绑
 * （撤销授权 + 忘掉本地快照），宿主不参与那一步。
 */
function registerPreferencesRoute(ctx, deps) {
    registerAuthenticatedRoute(ctx, {
        kind: 'exact',
        path: `${API_PATH}/preferences`,
        async handler(req, res) {
            res.setHeader('cache-control', 'no-store');
            if (req.method !== 'GET' && req.method !== 'POST') {
                return sendJson(res, 404, { ok: false, reason: 'not-found' });
            }
            // 启动那一拍是异步的：等它落定，GET 才能说清 running 到底有没有。
            if (deps.ready !== undefined)
                await deps.ready;
            // 这条路由没走 jsonRoute，httpFailure 得自己折成状态码（与上面那批路由同款）。
            try {
                if (req.method === 'GET') {
                    const prefs = await readPreferences(deps.target);
                    return sendJson(res, 200, {
                        ok: true,
                        phone: prefs.phone,
                        wechat: prefs.wechat,
                        running: deps.running(),
                    });
                }
                let payload;
                try {
                    payload = JSON.parse(await readBody(req, MAX_BODY));
                }
                catch {
                    throw httpFailure(400, '请求体不是合法 JSON');
                }
                // 两个开关各自独立更新：只改传进来的那一位，另一位保持原值。
                // 一块传两个也行——面板以后想「一键全关」不用再加路由。
                if (payload?.phone !== undefined && typeof payload.phone !== 'boolean') {
                    throw httpFailure(400, 'phone 必须是布尔值');
                }
                if (payload?.wechat !== undefined && typeof payload.wechat !== 'boolean') {
                    throw httpFailure(400, 'wechat 必须是布尔值');
                }
                if (payload?.phone === undefined && payload?.wechat === undefined) {
                    throw httpFailure(400, '至少要有 phone 或 wechat 布尔值');
                }
                const current = await readPreferences(deps.target);
                const next = {
                    phone: typeof payload?.phone === 'boolean' ? payload.phone : current.phone,
                    wechat: typeof payload?.wechat === 'boolean' ? payload.wechat : current.wechat,
                };
                await writePreferences(deps.target, next);
                // 只有微信那一位变了才动进程；手机入口是纯功能位，解绑由客户端发起。
                if (typeof payload?.wechat === 'boolean') {
                    try {
                        if (next.wechat)
                            await deps.start();
                        else
                            await deps.stop();
                    }
                    catch (error) {
                        return sendJson(res, 200, {
                            ok: true,
                            phone: next.phone,
                            wechat: next.wechat,
                            running: deps.running(),
                            error: String(error?.message ?? error),
                        });
                    }
                }
                return sendJson(res, 200, {
                    ok: true,
                    phone: next.phone,
                    wechat: next.wechat,
                    running: deps.running(),
                });
            }
            catch (error) {
                const status = asHttpFailure(error, 400).status;
                return sendJson(res, status, { ok: false, error: String(error?.message ?? error) });
            }
        },
    });
}
/**
 * 启动期把已配对的手机连接接回来（细节见 mobile/resume.ts）。
 *
 * 为什么不做成路由：手机能不能连上跟「面板有没有开」无关。做成路由等于要求桌面前端
 * 先发一次请求——那正是现在这个 bug 的形状。这里在宿主启动时直接问上游要连接。
 *
 * 为什么不用静态 `inject`：`dshRemote` 是上游插件的运行时服务，跟本模块的 webServer /
 * connection 没关系；静态声明会把整个 remote 模块卡在 pending，ClawBot 也一起起不来。
 * 缺服务（例如上游处于 pending 控制模式）时这里静默跳过，面板照旧可用。
 */
function installStartupResume(ctx) {
    if (typeof ctx?.inject !== 'function')
        return;
    ctx.inject(['dshRemote'], (remoteCtx) => {
        const service = remoteCtx?.dshRemote;
        if (service === undefined || service === null)
            return;
        remoteCtx.effect(() => {
            const logger = typeof remoteCtx.logger === 'function' ? remoteCtx.logger('remote') : undefined;
            const resume = createStartupResume({
                service,
                log: (level, message) => {
                    if (level === 'warn')
                        logger?.warn?.(message);
                    else
                        logger?.info?.(message);
                },
            });
            resume.begin();
            return () => resume.dispose();
        }, 'remote startup resume');
    });
}
export function apply(ctx, config) {
    // 先于 webServer 守卫：面板/HTTP 都不在时，已配对的手机也该能连上。
    installStartupResume(ctx);
    if (typeof ctx.webServer?.register !== 'function')
        return;
    if (typeof ctx.connection?.requestRejection !== 'function')
        return;
    registerPeersRoute(ctx);
    registerLocalStateRoute(ctx);
    const settings = readConfig(config);
    const target = {
        path: join(dshHome(), 'toolkit', 'remote-preferences.json'),
        fallback: defaultPreferences(settings.enabled),
    };
    /** 当前运行的 ClawBot 服务：关掉开关时是 null，路由统一回 409。 */
    let service = null;
    let starting = null;
    // 启动是异步的：插件可能在服务还没建好时就被卸载（测试里每个用例都会 dispose）。
    // 没有这个标记，迟到的服务会把定时器/长轮询留给已经卸载的进程，测试进程于是不退出。
    let disposed = false;
    async function startWechat() {
        if (disposed)
            return;
        if (service !== null)
            return;
        if (starting === null) {
            starting = createClawbotService(ctx, config);
            try {
                service = await starting;
            }
            finally {
                starting = null;
            }
            if (disposed) {
                const late = service;
                service = null;
                if (late !== null && typeof late.dispose === 'function')
                    await late.dispose();
            }
            return;
        }
        service = await starting;
    }
    async function stopWechat() {
        const current = service;
        service = null;
        if (current !== null && typeof current.dispose === 'function')
            await current.dispose();
    }
    // 初值必须同步拿到：cordis 不等异步 effect，路由会先注册好，
    // 面板第一眼就会看到「已关闭」再闪成「已启用」。
    const initial = readPreferencesSync(target);
    const logger = () => (typeof ctx.logger === 'function' ? ctx.logger('remote') : undefined);
    const ready = initial.wechat
        ? startWechat().catch((error) => {
            logger().warn?.(`[remote] ClawBot 启动失败：${String(error?.message ?? error)}`);
        })
        : Promise.resolve();
    registerPreferencesRoute(ctx, {
        target,
        start: startWechat,
        stop: stopWechat,
        running: () => service !== null,
        ready,
    });
    // 路由常驻：开关在运行期变化，handler 每次取当前服务，停用时回 409。
    registerClawbotRoutes(ctx, () => service, ready);
    ctx.effect(() => async () => {
        disposed = true;
        await ready;
        await stopWechat();
    }, 'remote service');
}
export { Config };
export default { name, inject, Config, apply };
