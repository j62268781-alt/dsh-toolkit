/** 缓存文件里一台服务器的工具描述。`parameters` 是原样的 JSON Schema。 */
export interface CachedTool {
    name: string;
    description: string;
    parameters: any;
}
/** 一台服务器的清单条目。 */
export interface CacheEntry {
    /** 抓取时那台服务器的连接配置指纹；与当前不一致即「过期」。 */
    fingerprint: string;
    capturedAt: string;
    tools: CachedTool[];
}
/** 缓存文件的默认位置：与 heartbeat 同级，都是本插件的诊断/状态文件。 */
export declare function cacheFile(): string;
/**
 * 一台服务器的连接配置指纹。
 *
 * 只算那些**会改变工具清单**的字段：换 URL / headers / 启动命令 / 参数 / 环境变量都可能换出一套
 * 不同的工具，而 `failOnStartupError`、`reconnect`、超时这类纯策略字段不影响清单，不该让缓存作废。
 */
export declare function fingerprintOf(server: any): string;
/** 工具清单缓存：内存读写 + 落盘（写盘失败只记日志，绝不让一次连接失败）。 */
export declare function createToolCache(options?: any): {
    file: any;
    /** 读一次磁盘。坏文件按「没有缓存」处理，并把它留着给人看。 */
    load(): Promise<void>;
    /** 一台服务器的缓存；`null` = 从来没有抓到过。 */
    get(serverName: any, fingerprint: string): {
        tools: CachedTool[];
        capturedAt: string;
        stale: boolean;
    };
    /** 写入一次抓取结果。 */
    put(serverName: any, fingerprint: string, tools: CachedTool[]): Promise<void>;
    drop(serverName: any): Promise<void>;
    /** 面板要展示的全部缓存摘要。 */
    summary(): any;
    /** 等待队列里的写盘完成（测试用）。 */
    flush(): Promise<void>;
};
/**
 * 建一个懒加载运行时。
 *
 * 依赖全部注入：`mount(server, agent)` 负责真的挂 `mcp-client`，`schemas(agent)` 读工具注册表，
 * `now` / `idleMs` 决定回收时机 —— 于是整台状态机可以脱离宿主单测。
 */
export declare function createLazyRuntime(deps: any): {
    /**
     * 对账一个 scope 的懒服务器集合。
     *
     * @param agent - `null` 表示全局 scope（工具注册在插件自己的上下文里）。
     * @param servers - 这个 scope 下**该由本插件挂载**的懒服务器（已过滤 enabled）。
     */
    attach(agent: any, servers: any): void;
    /** 丢掉一个 agent 的全部懒状态（会话结束）。 */
    detach(agent: any): void;
    /** 回收空闲连接。由宿主的慢 tick 调用。 */
    sweep(): number;
    /** 面板要的每台服务器状态（跨 scope 合并，连接中的优先）。 */
    snapshot(): any;
    dispose(): void;
};
