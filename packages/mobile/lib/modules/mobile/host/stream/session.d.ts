/**
 * 流会话：一条设备流，多个消费者，空闲自停。
 *
 * ── 为什么由 Host 持有子进程而不是让每个消费者各起一个 ────────────────
 * mobilecli 的 `screencapture` 是一个持续输出的子进程，启动它要经过
 * 「找设备 → 拉起 on-device agent → 开始编码」，实测首次出帧约 200ms，
 * 而 iOS 上还要等 agent 就绪（可能几秒）。面板刷新、截图卡片、模型工具
 * 三处都可能同时想要画面，各起一个进程会：
 *   - 让设备端反复经历 agent 启停
 *   - 在 USB 真机上争抢带宽（实测多流会显著降低各自帧率）
 * 所以这里做**单流多播**：一个设备一条流，消费者订阅同一份字节。
 *
 * ── 为什么用 CLI 而不是 mobilecli server 的 sessionUrl ────────────────
 * server 模式要多管一个常驻 HTTP 服务（端口占用、会话过期、二次清理），
 * 而 `screencapture` 写 stdout 的路径已经被实测验证（Android 104fps /
 * iOS 模拟器 131fps）。少一层进程就少一类失败。
 *
 * ── 空闲自停 ──────────────────────────────────────────────────────────
 * 面板关掉后不该让设备一直编码（耗电、占 USB 带宽）。消费者归零后起一个
 * 计时器，超时停流；下一次订阅会重新拉起。**主动停止从不被重启逻辑对抗**：
 * stop 会先摘掉自动重启的意图，否则退出事件会把刚停掉的流又拉起来。
 *
 * @module dsh-toolkit-mobile/lib/stream-session
 */
/**
 * swipe 的默认时长（毫秒）。
 *
 * mobilecli 不传 `--duration` 时用"平台默认"，实测就是 1000ms ——
 * 面板上会明显感到滑动慢半拍。300ms 接近真实 fling 手感。
 */
export declare const DEFAULT_SWIPE_DURATION_MS = 300;
/**
 * 缩放差异多大才值得为它**重启编码器**（相对值，1.01 = 1%）。
 *
 * 重启不是免费的：编码器重新起流程要一段黑场，实测 IDR 间隔约 0.54 秒，
 * 所以阈值不能无限小 —— 但**也不能大到把"轻微放大"放过去**。
 *
 * 这里原来是 1.15，理由是"宽 3% 宁可按旧流继续"。真机上这条推理破了产：
 * 面板画布 596 物理像素、流 540 宽（差 10%，落在 1.15 的死区里），请求
 * 更高分位时既不重建也不生效，浏览器把每帧放大 1.10× 铺上去 —— 用户看到的
 * 就是"文字有点糊"。**只要帧比画布小，插值就在发生**，而欠 10% 和欠 40%
 * 在"糊"这件事上没有本质区别，只是程度不同。
 *
 * 所以判据改成"新 scale 明显更大（>1%）就重建"，抖动靠三道闸门兜：
 * 客户端 600ms 持续判定 + 5 秒冷却，以及这里的 3 秒节流
 * （scaleRestartIntervalMs）。1.01 而不是 1.0，是为了吸收 scale 量化
 * （Host 截到 3 位小数）与编码器宏块对齐带来的 1-2px 回差。
 */
export declare const SCALE_RESTART_RATIO = 1.01;
/**
 * 缩放差异多大才值得为它**降级**重建（相对值，1.5 = 当前编码宽是需要的 1.5 倍）。
 *
 * 升级与降级不对称，是成本不对称：升级不重建的代价是每一帧都在浏览器里被放大
 * 插值（画面持续糊，用户看得见）；降级不重建的代价只是"多解了像素"（浪费 GPU/CPU，
 * 画质不降）。所以降级阈值要**远**大于 1%（1.01），否则拖窗口时宽度来回抖几像素
 * 就会反复杀编码器，每次都黑一段。
 *
 * 1.5 这个数是从实测的阶梯档位反推的：阶梯取流只在 0.5 与 1.0 两档间跳
 * （面板拖窄 1.0 → 0.5），那是 2 倍差、解码量降到 1/4（1080×2376 → 540×1188），
 * 锐度与原生持平（Sobel 边缘 0.972 vs 0.973），完全值回一次 IDR 黑场。
 * 中间那类"只小一点"的变化（比如 1.0 → 0.9，1.11 倍）白解码的像素不到两成，
 * 收益抵不过闪一下，落在阈值下侧。
 */
export declare const SCALE_DOWNGRADE_RATIO = 1.5;
/** 从首块字节嗅探出的流格式。 */
type StreamFormat = {
    kind: string;
    contentType?: string;
    boundary?: string;
};
/**
 * 注入的流进程句柄：`Mobilecli.spawnStream()` 的返回形状。
 *
 * 每个成员都可选，是因为这里只当它是"可能有这些能力的黑箱"——测试替身
 * 可以只给 stdout 与 kill，真实实现给全套。
 */
interface StreamProc {
    child?: any;
    stdout?: NodeJS.ReadableStream | null;
    stderr?: () => string;
    kill?: () => void;
}
type Log = (level: string, message: string) => void;
interface StreamSessionOptions {
    deviceId: string;
    spawn: () => StreamProc;
    scale?: number;
    idleStopMs?: number;
    restartDelayMs?: number;
    log?: Log;
}
/** 从首块字节嗅探流格式，而不是相信我们请求了什么。 */
export declare function sniffStreamFormat(head: unknown): StreamFormat;
/**
 * 一条设备流的生命周期。
 *
 * 状态机：idle → running → (crash → 自动重启) → stopped
 * stopped 是终态，只有 dispose()/stop() 会进入。
 */
export declare class StreamSession {
    #private;
    deviceId: string;
    spawnFn: () => StreamProc;
    scale: number;
    idleStopMs: number;
    restartDelayMs: number;
    log: Log;
    /** 有字节时喂进去的订阅者。 */
    consumers: Set<(chunk: Buffer) => void>;
    /** 会话被主动终结时要通知的回调（每个订阅者最多一个）。 */
    stopListeners: Set<() => void>;
    proc: StreamProc | null;
    /** 首块字节缓存：消费者可能在流已开始后才订阅，需要把格式信息补给它。 */
    head: Buffer | null;
    format: StreamFormat;
    idleTimer: ReturnType<typeof setTimeout> | null;
    restartTimer: ReturnType<typeof setTimeout> | null;
    stopping: boolean;
    stopped: boolean;
    crashCount: number;
    /**
     * @param {object} options
     * @param {string} options.deviceId
     * @param {() => StreamProc} options.spawn 实际的进程启动器，由调用方注入（便于测试替身）
     * @param {number} [options.idleStopMs] 消费者归零后多久停流
     * @param {number} [options.restartDelayMs] 崩溃后重启延迟
     * @param {number} [options.scale] 编码缩放（1 = 原分辨率），见下面字段说明
     * @param {Log} [options.log]
     */
    constructor({ deviceId, spawn, scale, idleStopMs, restartDelayMs, log }: StreamSessionOptions);
    /** 当前是否有活着的流进程。 */
    get running(): boolean;
    /**
     * 订阅流。首个消费者会拉起进程；后续消费者复用。
     *
     * @param {(chunk: Buffer) => void} onChunk
     * @param {(() => void)|null} [onStop]
     *   会话被**主动终结**（按新缩放重建、切设备、卸载）时回调。
     *   为什么需要它：终结时消费者会被清空，HTTP 响应从此再也收不到字节，
     *   不主动 `res.end()` 的话浏览器只能等自己的看门狗超时才发现流死了 ——
     *   这段时间画面完全冻住。由会话通知，响应才能立刻结束、客户端立刻重连。
     * @returns {{remove: () => void, format: () => object, head: () => Buffer|null}}
     */
    addConsumer(onChunk: (chunk: Buffer) => void, onStop?: (() => void) | null): {
        remove: () => void;
        format: () => StreamFormat;
        head: () => Buffer | null;
    };
    /**
     * 停止并进入终态。用于插件卸载、切换设备、**按新缩放重建流**。
     *
     * 终结时必须通知挂在流上的那些 HTTP 响应（见 stopListeners）：它们不会再有
     * 任何字节可写，主动结束才能让客户端马上重连到新会话 —— 否则浏览器要等
     * 自己的看门狗（客户端实测 5 秒起）才动，这段时间画面是冻住的。
     */
    stop(): void;
    /**
     * 把一次点击/滑动转发到设备。
     *
     * 这里只做参数校验与命令拼装，实际执行交给调用方注入的 runCommand，
     * 因为"命令怎么跑"是客户端模块的职责，会话只管流。
     *
     * @param {(args: string[]) => Promise<unknown>} runCommand
     * @param {{action: string, x?: number, y?: number, x1?: number, y1?: number, x2?: number, y2?: number, text?: string, name?: string, duration?: number}} input
     * @returns {Promise<unknown>}
     */
    sendInput(runCommand: (args: string[]) => Promise<unknown>, input: any): Promise<unknown>;
}
/**
 * `acquire()` 的流参数，原样透传给 `spawnFor`。
 */
export interface AcquireOptions {
    /** 编码缩放（1 = 原分辨率）。 */
    scale?: number;
    /** 是否允许「缩放变化足够大就重建」；只有 #grant 该传 true。 */
    restart?: boolean;
}
export interface StreamSessionPoolOptions {
    spawnFor: (deviceId: string, options?: AcquireOptions) => StreamProc;
    idleStopMs: number;
    restartDelayMs: number;
    scaleRestartIntervalMs?: number;
    log?: Log;
}
/**
 * 多设备会话池：按 deviceId 复用会话，切换设备时停掉旧的。
 */
export declare class StreamSessionPool {
    #private;
    spawnFor: (deviceId: string, options?: AcquireOptions) => StreamProc;
    idleStopMs: number;
    restartDelayMs: number;
    scaleRestartIntervalMs: number;
    log: Log;
    sessions: Map<string, StreamSession>;
    lastScaleRestartAt: Map<string, number>;
    /**
     * @param {object} options
     * @param {(deviceId: string, options?: object) => {child: any, stdout: NodeJS.ReadableStream, stderr: () => string, kill: () => void}} options.spawnFor
     * @param {number} [options.idleStopMs]
     * @param {number} [options.restartDelayMs]
     * @param {number} [options.scaleRestartIntervalMs] 同设备两次"按新缩放重建"的最小间隔
     * @param {Function} [options.log]
     */
    constructor({ spawnFor, idleStopMs, restartDelayMs, scaleRestartIntervalMs, log }: StreamSessionPoolOptions);
    /**
     * 取（或建）某个设备的会话。
     *
     * @param {string} deviceId
     * @param {object} [options] 透传给 spawnFor 的流参数（`scale` 等），可缺省
     * @param {number} [options.scale] 编码缩放（1 = 原分辨率）
     * @param {boolean} [options.restart] 是否允许"缩放变化足够大就重建"
     *   ⚠️ 只有 `#grant` 该传 true。`/stream` **绝不能**传 —— 每开一个消费者
     *   就杀一次编码器，等于把"重连"变成"重启"，画面会一直黑。
     * @returns {StreamSession}
     */
    acquire(deviceId: string, options?: AcquireOptions): StreamSession;
    /** 停掉某个设备的流（切换设备、按新缩放重建时调用）。 */
    stop(deviceId: string): void;
    /** 停掉全部。插件卸载时调用。 */
    stopAll(): void;
}
export {};
//# sourceMappingURL=session.d.ts.map