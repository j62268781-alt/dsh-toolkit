/**
 * 经 mobilecli daemon 的 unix socket 直接发 JSON-RPC。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * CLI 路径每条指令都要 `spawn` 一个 mobilecli 进程；POSIX npm shim 会启动
 * Node，而 Windows 会解析到平台原生 `.exe`。历史样本中进程启动开销 **~66ms**，
 * 加上 daemon/IPC 往返，一条 `io tap` 总共 **~104ms**。该数据不是 Windows SLA。
 * 实测（一加 12）：
 *
 *     CLI 路径   io tap                  104.2 ms
 *     RPC 路径   device.io.tap             7.3 ms   ← 快 93%
 *     CLI 路径   io swipe (duration 300) 411   ms（固定开销 111ms）
 *     RPC 路径   device.io.swipe (300)   314.9 ms（固定开销  14ms）
 *
 * ── 为什么不是 `mobilecli server start` ─────────────────────────────
 *
 * mobilecli 另有 `server start` 模式（HTTP + `/rpc`）。它也能做到个位数
 * 毫秒，但要额外管一个常驻 HTTP 服务：端口占用、绑定失败、会话过期、
 * 进程清理 —— 正是 ARCHITECTURE 里「为什么不用 server 模式」列出的三条。
 *
 * 在支持的 POSIX 环境，**daemon 本来就在运行**（CLI 每条命令都会把它拉起来，
 * 空闲 30 分钟自退），unix socket 直接吃 JSON-RPC。Windows 上 Node 访问 socket
 * 可能被系统拒绝；插件会停用 RPC 并回退 CLI。
 *
 *   · 可用时不需要新起任何进程（daemon 已有）
 *   · 不需要端口（unix domain socket）
 *   · 没有会话/过期概念
 *   · POSIX 权限天然收窄：socket 是 `srw-------`，只有本用户能连
 *
 * 也就是说，在支持的平台上它拿到了 server 模式的低延迟，却没有额外运维负担。
 *
 * ── 协议细节（都是实测出来的）────────────────────────────────────────
 *
 *   · 传输是 **newline-delimited JSON**：写一行 JSON + `\n`，daemon 回一行。
 *     不是 HTTP —— 用 `curl --unix-socket` 会被拒（回 "HTTP/0.9 not allowed"）。
 *   · **一请求一连接**：daemon 回完响应就**主动关闭** socket。连发多个请求
 *     只有第一个会被回复（实测发 3 个只回 1 个，然后连接被关）。
 *     所以这里每个请求新建连接 —— 约 7ms，仍然远快于 CLI 的 104ms。
 *   · 参数形状与 CLI 不同：CLI 用逗号串（`540,1800,540,900`），
 *     RPC 用独立字段（`x1/y1/x2/y2`）。传逗号串会被拒
 *     （`'x1' is required`）。
 *   · socket 路径 = `<MOBILECLI_HOME>/daemon.sock`，默认 `~/.mobilecli`。
 */
export declare function isSafeCliFallbackError(error: any): boolean;
/**
 * 解析 daemon socket 的路径。
 *
 * 与 CLI 的规则一致：`MOBILECLI_HOME` 优先，否则 `~/.mobilecli`。
 * 插件配置里的 `home`（homeDir）也要传进来 —— 传了它，RPC 与 CLI 才
 * 指向同一个 daemon，否则两边会各连一个。
 *
 * @param {string|null} home MOBILECLI_HOME；null 用默认
 * @returns {string} socket 绝对路径
 */
export declare function resolveSocketPath(home?: string | null): string;
/**
 * 一次 daemon RPC 调用。
 *
 * ⚠️ 每次调用都新建连接 —— 这是 daemon 的语义（它回完就关，见文件头）。
 * 不要试图复用连接：连发第二个请求会石沉大海，然后 EPIPE。
 *
 * @param {string} method 形如 `device.io.tap`
 * @param {object} params
 * @param {{socketPath: string, timeoutMs?: number, signal?: AbortSignal}} options
 * @returns {Promise<any>} JSON-RPC 的 result
 */
export declare function callDaemon(method: string, params: any, { socketPath, timeoutMs, signal }: {
    socketPath: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<any>;
/**
 * 把插件的 `sendInput` 动作翻译成 daemon RPC。
 *
 * ⚠️ 参数形状与 CLI **不同**，别照抄 argv：
 *   CLI  `io swipe --device X 540,1800,540,900`（逗号串）
 *   RPC  `device.io.swipe {deviceId, x1, y1, x2, y2}`（独立字段）
 *
 * @param {{action: string, [key: string]: any}} input 与 sendInput 同一个形状
 * @returns {{method: string, params: object}|null} null = 这条动作没有 RPC 实现
 */
export declare function rpcForInput(input: any): {
    method: string;
    params: any;
} | null;
/**
 * 把设备级动作翻译成 daemon RPC。
 *
 * home / back / power 都落在 `device.io.button`；**rotate 没有 RPC 实现**
 * （daemon 不暴露 orientation），返回 null 让调用方走 CLI。
 *
 * @param {string} action
 * @param {string} deviceId
 * @returns {{method: string, params: object}|null}
 */
export declare function rpcForDeviceAction(action: string, deviceId: string): {
    method: string;
    params: any;
} | null;
/**
 * 一个带**自愈**的 RPC 通道。
 *
 * ── 为什么必须自愈 ──────────────────────────────────────────────────
 *
 * daemon 空闲 30 分钟会自己退出，而 CLI 的任何设备类命令又会把它拉起来。
 * 也就是说"通道暂时连不上"是**常态**，不是永久故障。
 *
 * 旧实现把连接层失败当成永久结论（`#available = false`，而 `reset()` 在
 * 生产代码里根本没人调用）：一次 daemon 自退撞上点击，整场会话此后就全走
 * CLI —— 实测 CLI 166ms vs RPC 19.8ms，**慢 8.4 倍**。用户感受就是
 * "刚才还行，怎么越点越卡"。
 *
 * 所以这里做两件事：
 *   ① 失效后按 5s → 15s → 60s 的退避自动探测恢复；
 *   ② 探测用 `daemon.status`（实测往返 0.7ms，对比 `devices` CLI 356ms），
 *      空转成本可以忽略。
 *
 * 业务错误（设备忙、坐标非法）**不**动可用性：那说明通道是通的。
 */
export declare class DaemonRpc {
    #private;
    /**
     * `recoveryBackoffMs` 只给测试用：真实退避是 5s/15s/60s，用例等不起。
     */
    constructor({ home, timeoutMs, log, recoveryBackoffMs }?: {
        home?: string | null;
        timeoutMs?: number;
        log?: (level: string, message: string) => void;
        recoveryBackoffMs?: number[] | null;
    });
    get socketPath(): string;
    get available(): boolean;
    /** 立刻恢复可用（CLI 兜底已证明 daemon 活着时用它，见 routes.js）。 */
    reset(): void;
    /**
     * 廉价预热：探一次 `daemon.status`，通了就把通道标为可用。
     *
     * 面板打开时调用，目的是消掉"第一次点击必然走 CLI"（冷启动时 socket 还没
     * 生成，CLI 又要 166ms）。永不抛错 —— 预热失败只是"这次没提前通"。
     *
     * @returns {Promise<boolean>} 通道当前是否可用
     */
    prewarm(): Promise<boolean>;
    /**
     * 调一次。失败会**抛出**；调用方只对确认连接前失败的错误回退 CLI，
     * 以避免响应丢失时重复执行设备动作。
     * 只有连接层错误会把通道标记为不可用（并安排自动探测恢复）；
     * 业务错误不该让整条通道停用。
     *
     * @param {string} method
     * @param {object} params
     * @returns {Promise<any>}
     */
    call(method: string, params: any, options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<any>;
    dispose(): void;
}
//# sourceMappingURL=daemon-rpc.d.ts.map