/**
 * dsh-sidebar-mobile — DSH 右侧边栏的移动设备面板。
 *
 * 把 mobilecli 封装成 DSH 的移动设备层：Host 侧管进程/流/工具/技能，
 * Client 侧在右侧边栏渲染实时画面并转发点击。
 *
 * ── 为什么值得单独做一个（而不是直接用现成的设备插件）────────────────
 * 社区已有两个同类插件，各自踩了一个坑：
 *
 *   dsh-android  用 `adb exec-out screencap` 循环取帧，实测 ~1.8fps
 *   dsh-ios      用 serve-sim 的 MJPEG
 *
 * 而 mobilecli 的 AVC 路径在 Android 上实测 104fps、iOS 模拟器 MJPEG 实测
 * 131fps——同一条 API 覆盖两端，且帧率高出两个数量级。更关键的是它能通过
 * Dart VM Service 直读 Flutter 的 render tree（绕过无障碍投影，拿得到
 * widget Key、控件状态、自绘内容），这是现成插件都没有的能力。
 *
 * ── 生命周期 ────────────────────────────────────────────────────────────
 * 所有注册都通过 `ctx.effect`，插件卸载时自动注销：路由、工具、技能、
 * 以及后台的流子进程。disposer 顺序与注册顺序相反，保证先停流再摘路由，
 * 避免摘掉路由后仍有响应在往已卸载的处理器里写。
 *
 * @module dsh-sidebar-mobile
 */
import { resolveBinary } from "./device/mobilecli.js";
import { TOOL_NAMES } from "./agent/tools.js";
/** Cordis 插件名，也是挂载 id。 */
export declare const name = "dsh-sidebar-mobile";
/**
 * 需要的服务。
 *
 * 只声明 `tools`：它是注册模型工具的前提，缺了插件就没有意义。
 * `webServer`、`connection` 与 `skills` 用可选注入，因为 headless
 * profile 没有它们，但工具本身仍然可用。
 */
export declare const inject: string[];
/**
 * cordis.patch.yml 传进来的插件配置。
 *
 * 所有字段都可缺省：宿主只把用户显式写过的键传进来，缺省值在这里或下游的
 * 构造函数里各自兜底（`?? {}`、`toPositiveInt` 等）。
 */
export interface MobilePluginConfig {
    /** false 时整个模块不挂载（排查用）。 */
    enabled?: boolean;
    /** 路由前缀，默认 `DEFAULT_ROUTE_PREFIX`。 */
    routePrefix?: string;
    /** mobilecli 二进制路径，缺省时按 PATH / MOBILECLI_PATH 解析。 */
    binaryPath?: string | null;
    /** MOBILECLI_HOME；CLI 与 daemon RPC 必须用同一个值。 */
    homeDir?: string | null;
    /** false 时交互指令强制走 CLI（不启 daemon RPC）。 */
    useDaemonRpc?: boolean;
    /** 反向代理场景下的可信 authority 列表，逐项交给 parseTrustedAuthority。 */
    trustedAuthorities?: unknown[];
    /** false 时不注册随包技能。 */
    registerSkills?: boolean;
    /** 取流参数。 */
    stream?: {
        /** 无消费者多久后停流（秒）。 */
        idleStopSeconds?: number;
        /** 崩溃重启的基础退避（毫秒）。 */
        restartDelayMs?: number;
        /** 钉死缩放（1 = 原分辨率），缺省时跟着画布宽度走。 */
        defaultScale?: number;
        /** 钉死码率（bps），缺省时按 scale 推导。 */
        bitrate?: number;
        /** 期望帧率上限（mobilecli 实测无效，仅用于命令行可读性）。 */
        maxFps?: number;
    };
    /** judgment mobile loop 的开关与 purpose。 */
    mobileLoop?: {
        enabled?: boolean;
        purpose?: string;
    };
}
/**
 * 插件入口。
 *
 * @param {object} ctx Cordis 上下文
 * @param {object} [config] 来自 cordis.patch.yml
 */
export declare function apply(ctx: any, config?: MobilePluginConfig): void;
export { TOOL_NAMES, resolveBinary };
//# sourceMappingURL=index.d.ts.map