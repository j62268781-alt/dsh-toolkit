export { createToolCache, cacheFile } from './toolCache.js';
/**
 * 一台服务器的连接配置指纹。
 *
 * 只算那些**会改变工具清单**的字段：换 URL / headers / 启动命令 / 参数 / 环境变量都可能换出一套
 * 不同的工具，而 `failOnStartupError`、`reconnect`、超时这类纯策略字段不影响清单，不该让缓存作废。
 */
export declare function fingerprintOf(server: any): string;
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
    refresh(serverName: string, project?: boolean, projectScope?: string): Promise<number>;
    authorizationChanged(url: string): void;
    /** 丢掉一个 agent 的全部懒状态（会话结束）。 */
    detach(agent: any): void;
    /** 回收空闲连接。由宿主的慢 tick 调用。 */
    sweep(): number;
    /** 面板要的每台服务器状态（跨 scope 合并，连接中的优先）。 */
    snapshot(): any;
    dispose(): void;
};
