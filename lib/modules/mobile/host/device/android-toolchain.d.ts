/**
 * Android 工具链体检：adb 在不在、能不能看到设备。
 *
 * ── 为什么必须有这个模块 ──────────────────────────────────────────────
 * mobilecli **不自己实现 adb 协议**，它调用外部的 `adb` 二进制。而 adb 缺失时
 * 它的行为是"静默降级"，不是报错：
 *
 *     实测（Windows 11 + mobilecli 1.0.19，手机已 USB 连接且驱动正常）：
 *       mobilecli devices  →  {"status":"ok","data":{"devices":[]}}
 *       exit code          →  0
 *
 * 也就是说，**exit code 是 0、JSON 也是 ok、设备列表是空的** —— 从返回值
 * 完全看不出"adb 没装"。真相只在 daemon 日志里：
 *
 *     [VERBOSE] Failed running 'adb devices', is ANDROID_HOME set correctly?
 *
 * 于是插件会把"adb 缺失"报告成"没有在线设备 / 连一台开了调试的手机"，
 * 把用户指向完全错误的方向（去检查数据线、去开 USB 调试），而实际要做的
 * 是装 adb。本模块就是为了把这两种情况**区分开**。
 *
 * ── 还有一层坑：daemon 的环境是"启动时快照" ────────────────────────────
 * 实测：mobilecli 的 daemon 是常驻进程，它继承**启动那一刻**的环境变量。
 * 所以"装完 adb 但 daemon 还是旧的"依然会看不到设备 —— 必须重启 daemon。
 * 下面 describeAdbProblem() 会把这句提示一并给出。
 *
 * @module dsh-sidebar-mobile/lib/android-toolchain
 */
/** `adb devices -l` 的一行。 */
export interface AdbDevice {
    serial: string;
    state: string;
    model: string;
    product: string;
}
/** adb 体检结果。reason 的取值决定 describeAdbProblem() 给出哪套提示。 */
export interface AdbProbeResult {
    available: boolean;
    path: string | null;
    devices: AdbDevice[];
    usable: number;
    reason: string;
    error?: string;
    installedPath?: string | null;
}
/** describeAdbProblem() 的返回值：给面板直接展示的一段话 + 机器可读的 code。 */
export interface AdbProblem {
    code: string;
    message: string;
    hint: string;
    adbPath: string | null;
}
/**
 * 找出 adb 二进制。
 *
 * Android 的官方约定是 adb 躺在 `$ANDROID_HOME/platform-tools/adb`，
 * 而 `platform-tools` 通常**不在 PATH 上**（Android Studio 不自动加）。
 * 所以三级都要查，顺序按可信度：
 *
 *   1. PATH（用户手动加过，或包管理器装过）
 *   2. `$ANDROID_HOME/platform-tools/`
 *   3. `$ANDROID_SDK_ROOT/platform-tools/`
 *
 * 另外容忍一种常见误配：把 `ANDROID_HOME` 直接指到 `platform-tools`
 * 目录本身 —— 此时 `$ANDROID_HOME/adb` 才是对的。
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null} adb 绝对路径；找不到返回 null
 */
export declare function findAdb(env?: NodeJS.ProcessEnv): string | null;
/**
 * 在"当前环境查不到"的前提下，看看 adb 是不是其实装了。
 *
 * 返回路径表示**装了但这台进程看不到** —— 这是"重启 DSH"就能解决的情况，
 * 与"根本没装"是两回事。见 wellKnownAdbPaths 的注释。
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null}
 */
export declare function findAdbOutsideEnv(env?: NodeJS.ProcessEnv): string | null;
/**
 * 解析 `adb devices -l` 的输出。
 *
 * 真实格式（注意 `-l` 会在状态后追加 key:value 对）：
 *
 *     List of devices attached
 *     77b8cf49               device product:haotian model:2410DPN6CC transport_id:1
 *     emulator-5554          offline
 *     ABC123                 unauthorized usb:1-1
 *
 * 另外会有以 `*` 开头的噪声行（daemon 启停提示），以及空行。
 *
 * ⚠️ 状态不只有 device/offline：`unauthorized`（手机上没点"允许调试"）
 * 和 `no permissions`（Linux udev 规则缺失）都很常见，而且**都需要用户
 * 在设备侧做动作** —— 把它们当成"没插好"会让人白折腾数据线。
 *
 * @param {string} stdout
 * @returns {{serial: string, state: string, model: string, product: string}[]}
 */
export declare function parseAdbDevices(stdout: unknown): AdbDevice[];
/**
 * 跑一次 `adb devices` 体检。
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{
 *   available: boolean,
 *   path: string|null,
 *   devices: {serial: string, state: string, model: string, product: string}[],
 *   usable: number,
 *   reason: "ok"|"adb-not-found"|"adb-failed"|"no-device"|"unauthorized"|"offline",
 *   error?: string,
 * }>}
 */
export declare function probeAdb({ env, timeoutMs, signal }?: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<AdbProbeResult>;
/**
 * 把体检结果翻成"给人看 + 能照着做"的一段话。
 *
 * 刻意写得具体：每一种失败都有明确的下一条动作，而不是笼统的
 * "设备连接有问题"。这是本模块存在的全部意义。
 *
 * @param {Awaited<ReturnType<typeof probeAdb>>} probe
 * @returns {{code: string, message: string, hint: string, adbPath: string|null}}
 */
export declare function describeAdbProblem(probe: any): AdbProblem;
/**
 * 带 TTL 缓存的 adb 体检器。
 *
 * 为什么需要缓存：体检要 spawn 一个 adb 进程（含 adb server 往返，实测
 * 数百毫秒）。而"没有设备"这个结论会被反复问到（面板轮询、每次点击前的
 * 设备校验），每次真跑一遍会把本来就慢的交互路径再拖长。
 *
 * ⚠️ 只缓存**成功**的体检；adb 缺失/失败的结果不缓存太久 —— 用户很可能
 * 看完提示就去装了 adb，然后刷新页面期待立刻生效。
 */
export declare class AdbProbe {
    #private;
    log: (level: string, message: string) => void;
    /** 构造函数：log 走宿主日志，probe 可注入以便测试。 */
    constructor({ log, probe }?: {
        log?: (level: string, message: string) => void;
        probe?: typeof probeAdb;
    });
    /**
     * 取体检结果（可能命中缓存）。
     * @param {object} [options]
     * @param {boolean} [options.fresh] 绕过缓存
     * @returns {Promise<Awaited<ReturnType<typeof probeAdb>>>}
     */
    get({ fresh }?: {
        fresh?: boolean;
    }): Promise<AdbProbeResult>;
    /** 清掉缓存（装完 adb、重启 daemon 后调用）。 */
    invalidate(): void;
}
//# sourceMappingURL=android-toolchain.d.ts.map