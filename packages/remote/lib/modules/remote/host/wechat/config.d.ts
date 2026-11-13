import s from '@deepseek-ai/schemastery';
/**
 * 微信扫码登录（ClawBot / iLink）的配置。
 *
 * 全部字段 volatile：它们是运行时开关，可以在设置面板里即时改写，
 * 不需要重启宿主。
 */
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    enabled: s<boolean, boolean, "volatile-defined">;
    /** 凭据存放位置；独立于官方 deepseek-harness-weixin 的 WEIXIN_ILINK_CREDENTIAL。 */
    credentialRef: s<string, string, "volatile-defined">;
    /** 登录成功后是否常驻 getUpdates 监听（也是桥接的前置条件）。 */
    monitorOnConnect: s<boolean, boolean, "volatile-defined">;
    /** ── 下面是「微信 ↔ DSH」双向桥的配置 ── */
    /** 是否把微信消息送进 Agent 并回复。默认开启：连接成功即可用，且默认只对自己开放。 */
    bridgeEnabled: s<boolean, boolean, "volatile-defined">;
    /** 谁能用：allowlist=只允许下列用户 id（默认，即「本人」）；open=任何人（仅在配置文件里显式设置才生效）。 */
    bridgeAccessPolicy: s<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
    /** 白名单用户 id（iLink 的 from_user_id）；面板里可改，运行时以桥状态文件优先。 */
    bridgeAllowFrom: s<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    /** 跑微信消息用的 agent preset；空字符串表示用宿主默认。 */
    bridgeAgentPreset: s<string, string, "volatile-defined">;
    /** 沙箱/审批预设；空字符串表示用宿主默认（通常是 workspace-write）。 */
    bridgePermissionPreset: s<string, string, "volatile-defined">;
    /** 会话工作目录；空字符串表示用户主目录。 */
    bridgeWorkspace: s<string, string, "volatile-defined">;
    /** 是否把微信图片作为 image 块送进模型。 */
    bridgeIncludeImages: s<boolean, boolean, "volatile-defined">;
    /** iLink HTTP 请求超时（毫秒）。 */
    bridgeRequestTimeoutMs: s<number, number, "volatile-defined">;
    /** 工具审批等待微信回答的时长（毫秒）。 */
    bridgeApprovalTimeoutMs: s<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: s<boolean, boolean, "volatile-defined">;
    /** 凭据存放位置；独立于官方 deepseek-harness-weixin 的 WEIXIN_ILINK_CREDENTIAL。 */
    credentialRef: s<string, string, "volatile-defined">;
    /** 登录成功后是否常驻 getUpdates 监听（也是桥接的前置条件）。 */
    monitorOnConnect: s<boolean, boolean, "volatile-defined">;
    /** ── 下面是「微信 ↔ DSH」双向桥的配置 ── */
    /** 是否把微信消息送进 Agent 并回复。默认开启：连接成功即可用，且默认只对自己开放。 */
    bridgeEnabled: s<boolean, boolean, "volatile-defined">;
    /** 谁能用：allowlist=只允许下列用户 id（默认，即「本人」）；open=任何人（仅在配置文件里显式设置才生效）。 */
    bridgeAccessPolicy: s<"open" | "allowlist", "open" | "allowlist", "volatile-defined">;
    /** 白名单用户 id（iLink 的 from_user_id）；面板里可改，运行时以桥状态文件优先。 */
    bridgeAllowFrom: s<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    /** 跑微信消息用的 agent preset；空字符串表示用宿主默认。 */
    bridgeAgentPreset: s<string, string, "volatile-defined">;
    /** 沙箱/审批预设；空字符串表示用宿主默认（通常是 workspace-write）。 */
    bridgePermissionPreset: s<string, string, "volatile-defined">;
    /** 会话工作目录；空字符串表示用户主目录。 */
    bridgeWorkspace: s<string, string, "volatile-defined">;
    /** 是否把微信图片作为 image 块送进模型。 */
    bridgeIncludeImages: s<boolean, boolean, "volatile-defined">;
    /** iLink HTTP 请求超时（毫秒）。 */
    bridgeRequestTimeoutMs: s<number, number, "volatile-defined">;
    /** 工具审批等待微信回答的时长（毫秒）。 */
    bridgeApprovalTimeoutMs: s<number, number, "volatile-defined">;
}>>, "plain">;
export declare const DEFAULT_CREDENTIAL_REF = "WEIXIN_CLAWBOT_CREDENTIAL";
/** 读取并规范化配置（schema 已保证类型，这里只兜底 undefined）。 */
export declare function readConfig(config?: any): {
    enabled: boolean;
    credentialRef: string;
    monitorOnConnect: boolean;
    bridgeEnabled: boolean;
    bridgeAccessPolicy: string;
    bridgeAllowFrom: string[];
    bridgeAgentPreset: any;
    bridgePermissionPreset: any;
    bridgeWorkspace: string;
    bridgeIncludeImages: boolean;
    bridgeRequestTimeoutMs: number;
    bridgeApprovalTimeoutMs: number;
};
//# sourceMappingURL=config.d.ts.map