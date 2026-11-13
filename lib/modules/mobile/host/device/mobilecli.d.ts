/**
 * mobilecli 二进制的解析与调用。
 *
 * mobilecli 是一个 Go 二进制，通过 npm 按平台分发（`@mobilenext/mobilecli-<os>-<arch>`
 * 是 optionalDependencies）。所以「找二进制」有三种来源，按优先级：
 *
 *   1. 配置里的 binaryPath（用户显式指定，最高优先级）
 *   2. MOBILECLI_PATH 环境变量
 *   3. PATH 上的 `mobilecli`（npm -g 安装的 shim）
 *   4. 本包 node_modules 里的平台包（mobilecli 作为本包依赖安装时）
 *
 * 参数始终作为独立 argv 传入，不经过 shell。
 * runJson() 使用有限输出和可取消的进程执行器；spawnStream() 单独保留长驻字节流，
 * 不把 H.264/MJPEG 缓冲到内存。
 *
 * @module dsh-sidebar-mobile/lib/mobilecli
 */
/**
 * mobilecli 以非零退出码表示失败，同时仍可能在 stdout 打印结构化错误。
 * 这类错误要保留下来给调用方判断，而不是当成崩溃。
 */
export declare class MobilecliError extends Error {
    code: string;
    stderr: string;
    exitCode: number | undefined;
    constructor(message: string, details?: {
        code?: string;
        stderr?: string;
        exitCode?: number;
    });
}
/**
 * 解析 mobilecli 二进制的绝对路径。
 *
 * @param {string|null|undefined} explicit 配置里指定的路径
 * @param {string} [baseUrl] 用于解析本包 node_modules 的基准（import.meta.url）
 * @returns {string|null} 绝对路径；解析不到返回 null（调用方负责给出可读的报错）
 */
export declare function resolveBinary(explicit: string | null | undefined, baseUrl?: string): string | null;
/**
 * mobilecli 子进程的封装。
 *
 * 每个实例对应一个二进制路径与一组环境变量；daemon 本身由 mobilecli 自己
 * 管理（首次设备命令时自动拉起，空闲 30 分钟退出），所以这里不做常驻进程，
 * 只保证每次调用都带上正确的 MOBILECLI_HOME。
 */
export declare class Mobilecli {
    #private;
    binary: string;
    home: string | null;
    log: (level: string, message: string) => void;
    constructor({ binary, home, log }: {
        binary: string;
        home?: string | null;
        log?: (level: string, message: string) => void;
    });
    /** 子进程环境：只加 MOBILECLI_HOME，其余继承，保证 PATH/ADB 等照常可见。 */
    get env(): NodeJS.ProcessEnv;
    /**
     * 跑一条命令并解析 JSON 输出。
     *
     * mobilecli 的约定：成功时 stdout 是 `{"status":"ok","data":…}`，
     * 失败时可能是非零退出码 + stderr，也可能是退出码 0 但
     * `{"status":"error","error":"…"}`。两种都归一化成 MobilecliError。
     *
     * @param {string[]} args
     * @param {object} [options]
     * @param {number} [options.timeoutMs]
     * @param {AbortSignal} [options.signal]
     * @returns {Promise<any>} 解包后的 data 字段
     */
    runJson(args: string[], options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<any>;
    /**
     * 启动一条长驻命令，把 stdout 交出去（不缓冲）。
     *
     * 用于 screencapture：输出是 H.264/MJPEG 二进制流，可能一直不停，
     * 只能以流的形式消费。
     *
     * ⚠️ **必须挂 `child.on("error")`**。`spawn()` 对"起不来"（二进制不存在、
     * 没有执行权限）是**同步返回 + 异步抛 error 事件**，而不是同步 throw：
     *
     *     spawn()          → 立刻返回 ChildProcess（不抛）
     *     'error' 事件      → 稍后异步触发
     *
     * 没有监听者时，Node 会把这个 error 当**未捕获异常**抛出，直接掀掉进程。
     * 调用方的 `try { spawnFn() } catch {}` 永远抓不到它 —— 因为那是个异步事件。
     * 实测：对不可执行的路径 spawn，5ms 后进程以未捕获 ENOENT 退出（exit 7）。
     *
     * 所以在 DSH 里，一旦二进制解析错，不是"面板提示取流失败"，而是整个 profile
     * 被隔离 —— 报错还完全指不到流这一层。这里把 error 收下来，交给调用方
     * 按普通失败处理（重试/退避/给出可读信息）。
     *
     * @param {string[]} args
     * @returns {{child: import("node:child_process").ChildProcess, stdout: NodeJS.ReadableStream, stderr: () => string, error: () => Error|null, kill: () => void}}
     */
    spawnStream(args: string[]): {
        child: import("node:child_process").ChildProcess;
        stdout: NodeJS.ReadableStream;
        stderr: () => string;
        error: () => Error | null;
        kill: () => void;
    };
    /** 版本号，用于诊断。失败时返回 null 而不是抛错。 */
    version(): Promise<string | null>;
    /**
     * 列出设备。首次调用会拉起 daemon，所以超时给得宽。
     *
     * ⚠️ 这个调用**很贵**：实测一次 `devices --include-offline` 约 **381ms**
     * （进程 spawn + daemon IPC + adb 往返）。而它出现在三条热路径上：
     *
     *   - 每次点击/滑动前的 #requireActiveDevice（stream-routes.js）
     *   - 每 5 秒一次的 status 轮询（客户端心跳）
     *   - 每次 grant
     *
     * 实测一次点击的 CLI 开销 = devices 381ms + io tap 75ms ≈ 456ms，
     * 其中 84% 花在这次列表查询上 —— 而它只是用来确认"当前设备还在不在"。
     *
     * 所以加一层短 TTL 缓存 + 单飞（single-flight）：并发的查询共用同一个
     * 在途 Promise，避免连点五次就真的跑五遍。TTL 内直接命中缓存。
     *
     * ⚠️ 缓存失败**不**缓存：设备查询失败必须立刻可见（否则会出现"设备明明
     * 掉了但面板还说在线"）。只有成功结果才进缓存。
     *
     * @param {object} [options]
     * @param {boolean} [options.includeOffline]
     * @param {boolean} [options.fresh] 绕过缓存强制查询（诊断用）
     * @param {boolean} [options.staleOk] 允许返回略旧的缓存（见 DEVICE_PRUNE_TTL_MS）
     * @returns {Promise<any[]>}
     */
    listDevices({ includeOffline, fresh, staleOk, signal }?: {
        includeOffline?: boolean;
        fresh?: boolean;
        staleOk?: boolean;
        signal?: AbortSignal;
    }): Promise<any[]>;
    /** 主动让设备缓存失效（切换设备、设备动作后调用）。 */
    invalidateDevices(): void;
    /** daemon 状态。未运行时 mobilecli 返回 running:false 而不是报错。 */
    daemonStatus(): Promise<any>;
    /** 停掉 daemon。插件卸载或需要把设备让给别的工具时调用。 */
    daemonStop(): Promise<any>;
}
//# sourceMappingURL=mobilecli.d.ts.map