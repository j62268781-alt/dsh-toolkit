/** Mobile routes add loopback, POST Origin and stream capabilities after the DSH identity guard. */
import type { TrustedAuthority } from "./access.js";
/** 日志函数。level 取 info/warn/error，由宿主 logger 决定是否落盘。 */
type Log = (level: string, message: string) => void;
/**
 * 一条流的参数规划结果。
 *
 * `scale` 是编码缩放（1 = 设备原分辨率），其余字段用于坐标夹取与回包；
 * 与 `index.ts` 的 `resolveStreamPlan` 返回值逐字段对齐。
 */
export interface StreamPlan {
    scale: number;
    bitrate: number | null;
    deviceWidth: number | null;
    deviceHeight: number | null;
    preferredWidth: number | null;
    fixed: boolean;
}
/** `toDeviceCoordinates` 只需要这几个字段，测试也会传裁剪过的 plan。 */
type PlanLike = {
    scale?: number;
    deviceWidth?: number | null;
    deviceHeight?: number | null;
};
export interface StreamRoutesOptions {
    client: any;
    pool: any;
    access: any;
    trustedAuthorities?: TrustedAuthority[];
    adbProbe?: any;
    log?: Log;
    rpc?: any;
    resolveStreamPlan?: ((deviceId: string, preferredWidth: number | null) => Promise<StreamPlan> | StreamPlan) | null;
}
/**
 * 找第一个 Annex B 起始码（00 00 01 或 00 00 00 01）的位置。
 *
 * 用于拥塞丢弃后**重新对齐**：从这个位置开始投递，客户端一定能正确分帧。
 *
 * ⚠️ **只对 H.264 有效**。MJPEG 的 JPEG 像素数据里天然会大量出现
 * `00 00 01` 序列（实测 36MB 流里有 1925 个三字节 + 3465 个四字节），
 * 它们落在数据内部、不是任何边界。MJPEG 必须按 boundary 对齐
 * （见 findBoundary / lastBoundary）。
 *
 * @param {Buffer} buf
 * @returns {number} 起始码下标；没有则 -1
 */
export declare function findStartCode(buf: Buffer): number;
/**
 * 找**最后一个**起始码的位置 —— 即"最后一个完整访问单元的起点"。
 *
 * 拥塞时投递到它为止：前面的数据都是完整访问单元，后面的部分丢掉，
 * 于是被投递的最后一段也是一个完整单元，不会留下半截 NAL。
 *
 * ⚠️ 只认**明确完整**的起始码：4 字节形式要求 i+3 还在缓冲区内，避免把
 * 恰好跨在块尾的 `00 00 00` 误判成起始码。
 *
 * ⚠️ 同 findStartCode：**只对 H.264 有效**，别用在 MJPEG 上。
 *
 * @param {Buffer} buf
 * @returns {number} 起始码下标；没有则 -1
 */
export declare function lastStartCode(buf: Buffer): number;
/**
 * 找第一个 multipart boundary 的位置 —— MJPEG 的对齐点。
 *
 * MJPEG 是 `multipart/x-mixed-replace`：每帧形如
 * `--<boundary>\r\n<headers>\r\n\r\n<jpeg 字节>\r\n`。浏览器只在读到
 * **下一个 boundary** 时才认为上一帧结束，所以投递必须停在 boundary 上；
 * 否则最后一帧永远等不到结束标记（不渲染），恢复投递后的残余字节也会
 * 被当成上一帧的像素（该帧损坏）。
 *
 * 实测依据：iOS 模拟器 MJPEG 21.8 Mbps、每帧 ~35KB，而背压阈值是 256KB
 * —— 积压约 7 帧就触发丢弃。这条路径是日常会走到的，不是边角情况。
 *
 * @param {Buffer} buf
 * @param {string} boundary 形如 `--mjpeg-frame-boundary`（含前导 `--`）
 * @returns {number} boundary 下标；没有则 -1
 */
export declare function findBoundary(buf: Buffer, boundary: string): number;
/**
 * 找**最后一个** multipart boundary 的位置。
 *
 * 与 lastStartCode 同理：投递到它为止，被投递的部分以完整帧结尾。
 *
 * @param {Buffer} buf
 * @param {string} boundary 形如 `--mjpeg-frame-boundary`（含前导 `--`）
 * @returns {number} boundary 下标；没有则 -1
 */
export declare function lastBoundary(buf: Buffer, boundary: string): number;
/**
 * 把客户端报的**帧像素**坐标换算回**设备像素**。
 *
 * 为什么需要它：侧边栏只有 ~315 CSS 宽，客户端画布后备存储实测 630×1400，
 * 而设备是 1080×2376 —— 帧像素和设备像素差一个 scale（见 resolveStreamPlan）。
 * 客户端按"我看到的画面"报坐标是唯一正确的选择（它自己缩放反而会把
 * 误差带进每一笔输入），换算统一在这里做一次。
 *
 * 换算规则（与 index.js 的 scale 定义一致）：
 *   deviceX = clamp(round(x / scale), 0, deviceWidth - 1)
 *
 * ⚠️ 只在 #control 用。Agent 工具（mobile_tap 等）走的是 performTap / #dispatchInput
 * 通用路径，它们传的**已经是设备坐标**，在那里再缩一次会让 Agent 的操作全偏。
 *
 * @param {object} input 已校验的输入（x/y 或 x1/y1/x2/y2）
 * @param {{scale?: number, deviceWidth?: number|null, deviceHeight?: number|null}|null} plan
 *   当前流的计划；null 或缺 scale 时视为 1（不缩放）
 * @returns {object} 换算后的新对象（不改入参）
 */
export declare function toDeviceCoordinates(input: any, plan: PlanLike | null): any;
/**
 * 插件路由的实现体。与 DSH 的 webServer 解耦，便于单测直接调用。
 */
export declare class StreamRoutes {
    #private;
    client: any;
    pool: any;
    access: any;
    trustedAuthorities: TrustedAuthority[];
    adbProbe: any;
    log: Log;
    rpc: any;
    resolveStreamPlan: StreamRoutesOptions["resolveStreamPlan"];
    streamPlan: StreamPlan | null;
    streamPlans: Map<string, StreamPlan>;
    activeDeviceId: string | null;
    panelOpenSeq: number;
    panelOpenPending: number | null;
    panelOpenWaiters: Set<() => void>;
    panelOpenAckWaiters: Set<() => void>;
    /**
     * @param {object} options
     * @param {import("./mobilecli.js").Mobilecli} options.client
     * @param {import("./stream-session.js").StreamSessionPool} options.pool
     * @param {import("./stream-access.js").StreamAccessController} options.access
     * @param {{host: string, port: number|null, scheme: string|null}[]} [options.trustedAuthorities]
     * @param {object} [options.adbProbe] Android 工具链体检器（见 android-toolchain.js）
     * @param {Function} [options.log]
     * @param {object} [options.rpc] daemon RPC 通道（见 lib/device/daemon-rpc.js）
     * @param {(deviceId: string, preferredWidth: number|null) => Promise<{scale: number, bitrate: number|null, deviceWidth: number|null, preferredWidth: number|null}>} [options.resolveStreamPlan]
     *   流参数规划器（由 index.js 提供）；null 时 scale 恒为 1
     */
    constructor({ client, pool, access, trustedAuthorities, adbProbe, log, rpc, resolveStreamPlan, }: StreamRoutesOptions);
    /**
     * 请求客户端把移动设备面板打开，并等它的回执。
     *
     * 由 `mobile_open_panel` 工具调用。返回后调用方就知道面板**确实**被打开了
     * —— 而不是"请求已发出，不知道有没有人听"。
     *
     * @param {number} timeoutMs 等回执的上限
     * @returns {Promise<{ opened: boolean, waitedMs: number, reason?: string }>}
     */
    requestPanelOpen(timeoutMs?: number): Promise<{
        opened: boolean;
        waitedMs: number;
        reason?: string;
    }>;
    /**
     * 处理一次请求。
     *
     * @param {string} routeName ROUTES 里的名字
     * @param {import("node:http").IncomingMessage} req
     * @param {import("node:http").ServerResponse} res
     * @returns {Promise<boolean>} 是否已处理（false 交给上层 404）
     */
    handle(routeName: string, req: any, res: any): Promise<boolean>;
}
/**
 * 校验一次交互输入。
 *
 * 坐标必须是有限数字——NaN/字符串会让 mobilecli 拼出畸形参数，
 * 而它的 `optInt` 会把无法解析的值静默变成 0，即"点左上角"。
 * 这个静默行为比报错更糟，所以在 Host 侧就挡掉。
 *
 * @param {string} action
 * @param {any} body
 * @returns {{ok: true, input: any}|{ok: false, error: string}}
 */
export declare function validateInput(action: string, body: any): any;
/**
 * 把路由挂到 DSH 的 webServer 上。
 *
 * DSH 的 register 是「同 (kind, path) 重复注册即抛错」，所以每次挂载都用
 * 独立的子路径；前缀路由只挂一条，内部再分发。
 *
 * @param {object} ctx 插件上下文（需要 webServer、connection 与 effect）
 * @param {StreamRoutes} routes
 * @param {string} prefix 形如 /_dsh/dsh-toolkit-mobile
 * @returns {(() => void)|null} disposer；null 表示环境没有 webServer
 */
export declare function mountRoutes(ctx: any, routes: any, prefix: string): any;
/**
 * 从请求 URL 匹配出路由名。
 *
 * @param {string} url
 * @param {string} prefix
 * @returns {string|null}
 */
export declare function matchRouteName(url: string, prefix: string): string | null;
export {};
//# sourceMappingURL=routes.d.ts.map