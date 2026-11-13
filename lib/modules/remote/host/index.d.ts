/**
 * Host 半边：远程连接。两个子目录各管一件事，本文件只负责装配：
 *   · wechat/ —— 微信扫码登录（ClawBot / iLink）与「微信 ↔ DSH Agent」双向桥；
 *   · mobile/ —— 手机扫码配对的本机支撑：可信设备清单（peers）、解绑后的残留清理。
 *
 * 职责边界：
 *   · 登录、通道自检，以及可选的「微信 ↔ DSH Agent」桥接（wechat/bridge.js）。
 *   · token 只经 ctx.credentials 存取，绝不进日志、绝不回前端。
 *   · 二维码 URL 是短生命周期凭据，只在 start() 的响应里回给前端，不打印。
 *
 * 路由（全部同源 fetch，无需 CORS）：
 *   GET  /api/plugins/dsh-toolkit/remote/status       当前状态（含 bridge）
 *   POST /api/plugins/dsh-toolkit/remote/login/start  发起扫码
 *   GET  /api/plugins/dsh-toolkit/remote/login/poll   前端轮询
 *   POST /api/plugins/dsh-toolkit/remote/login/code   回传数字校验码
 *   POST /api/plugins/dsh-toolkit/remote/login/cancel 取消扫码
 *   POST /api/plugins/dsh-toolkit/remote/logout       断开并清空凭据
 *   POST /api/plugins/dsh-toolkit/remote/probe        单次通道探测
 *   POST /api/plugins/dsh-toolkit/remote/monitor      开启/关闭常驻监听
 *   POST /api/plugins/dsh-toolkit/remote/bridge/test  发一条测试消息
 *   POST /api/plugins/dsh-toolkit/remote/bridge/access 改访问策略/白名单
 *   GET  /api/plugins/dsh-toolkit/remote/peers?serverUrl= 已信任手机的身份（重启后兜底）
 *   POST /api/plugins/dsh-toolkit/remote/local-state/purge?serverUrl= 解绑后清本机配对残留
 */
import { Config } from './wechat/config.js';
export declare const name = "toolkit-remote";
/**
 * 登录只需要这三样；双向桥额外依赖的宿主服务在服务创建时用 `ctx.inject` 按需装载，
 * 这样缺服务时登录/二维码仍然可用，不会把整个模块卡在 pending。
 */
export declare const inject: string[];
export declare const API_PATH = "/api/plugins/dsh-toolkit/remote";
/**
 * 解析已保存的凭据。返回 undefined 表示未连接；格式错误时抛出可读错误。
 * 该函数是唯一把 token 读进内存的地方，调用方负责不把它泄露出去。
 */
export declare function resolveCredential(credentials: any, credentialRef: any): Promise<{
    userId?: any;
    token: any;
    accountId: any;
    baseUrl: string;
}>;
/** 已连接时对外暴露的脱敏账号信息。 */
export declare function publicAccount(credential: any): {
    accountId: string;
    baseUrlHost: string;
};
/** 面板/圆点该按哪个状态显示：凭据还在不代表通道还通。 */
export declare function deriveConnectionState({ connected, loginState, monitorState }: any): any;
export declare function createClawbotService(ctx: any, config: any): Promise<{
    snapshot: () => Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    /**
     * 申请二维码。
     *
     * @param force 为 false（默认）时，只要登录管理器手里还有一张未过期的码就复用它；
     *   面板上的「刷新二维码」按钮才传 true，明确要求换一张新的。
     */
    startLogin(force?: boolean): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    submitCode(code: any): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    cancelLogin(): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    logout(): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    probe(): Promise<{
        snapshot: {
            qr: {
                url: any;
                expiresAt: any;
                loginId: any;
            };
            code: any;
            error: any;
            monitor: any;
            lastMessage: any;
            bridge: any;
            credentialError?: string;
            ok: boolean;
            state: any;
            connected: boolean;
            credentialRef: string;
            account: {
                accountId: string;
                baseUrlHost: string;
            };
        };
        ok: boolean;
        reason: string;
        messages: number;
        invalid: boolean;
        idle?: undefined;
    } | {
        snapshot: {
            qr: {
                url: any;
                expiresAt: any;
                loginId: any;
            };
            code: any;
            error: any;
            monitor: any;
            lastMessage: any;
            bridge: any;
            credentialError?: string;
            ok: boolean;
            state: any;
            connected: boolean;
            credentialRef: string;
            account: {
                accountId: string;
                baseUrlHost: string;
            };
        };
        ok: boolean;
        reason: string;
        messages: number;
        invalid?: undefined;
        idle?: undefined;
    } | {
        snapshot: {
            qr: {
                url: any;
                expiresAt: any;
                loginId: any;
            };
            code: any;
            error: any;
            monitor: any;
            lastMessage: any;
            bridge: any;
            credentialError?: string;
            ok: boolean;
            state: any;
            connected: boolean;
            credentialRef: string;
            account: {
                accountId: string;
                baseUrlHost: string;
            };
        };
        ok: boolean;
        messages: any;
        reason?: undefined;
        invalid?: undefined;
        idle?: undefined;
    } | {
        snapshot: {
            qr: {
                url: any;
                expiresAt: any;
                loginId: any;
            };
            code: any;
            error: any;
            monitor: any;
            lastMessage: any;
            bridge: any;
            credentialError?: string;
            ok: boolean;
            state: any;
            connected: boolean;
            credentialRef: string;
            account: {
                accountId: string;
                baseUrlHost: string;
            };
        };
        ok: boolean;
        messages: number;
        idle: boolean;
        reason?: undefined;
        invalid?: undefined;
    }>;
    /** 发一条测试消息（默认发给最近一位给自己发过消息的人）。 */
    sendTestMessage(text: any): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    /** 改访问策略 / 白名单（落盘到桥状态文件，重启后仍生效）。 */
    setBridgeAccess(patch: any): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    setMonitor(enabled: any): Promise<{
        qr: {
            url: any;
            expiresAt: any;
            loginId: any;
        };
        code: any;
        error: any;
        monitor: any;
        lastMessage: any;
        bridge: any;
        credentialError?: string;
        ok: boolean;
        state: any;
        connected: boolean;
        credentialRef: string;
        account: {
            accountId: string;
            baseUrlHost: string;
        };
    }>;
    dispose(): Promise<void>;
    readonly monitorEnabled: boolean;
}>;
/**
 * 注册插件路由。
 *
 * 所有接口都在鉴权之后，且强制 `cache-control: no-store`：它们要么带副作用，
 * 要么返回一次性数据（二维码、凭据状态）。
 */
export declare function registerClawbotRoutes(ctx: any, service: any): void;
export declare function apply(ctx: any, config: any): void;
export { Config };
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        credentialRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        monitorOnConnect: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        bridgeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        bridgeAccessPolicy: import("@deepseek-ai/schemastery").default<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
        bridgeAllowFrom: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        bridgeAgentPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        bridgePermissionPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        bridgeWorkspace: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        bridgeIncludeImages: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        bridgeRequestTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        bridgeApprovalTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        credentialRef: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        monitorOnConnect: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        bridgeEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        bridgeAccessPolicy: import("@deepseek-ai/schemastery").default<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
        bridgeAllowFrom: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
        bridgeAgentPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        bridgePermissionPreset: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        bridgeWorkspace: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        bridgeIncludeImages: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        bridgeRequestTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
        bridgeApprovalTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map