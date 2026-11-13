/**
 * 微信桥的持久化状态：get_updates_buf 游标、每个用户的 context_token、已处理消息去重表。
 *
 * 为什么必须落盘：
 *   · getupdates 是「消费型」接口，游标丢失会让重启后的第一轮把历史消息再收一遍；
 *   · context_token 只随入站消息下发，丢了就没法再主动回复该用户（必须等他再说一句）。
 *
 * 文件位于 `~/.dsh/remote/<sha256(accountId) 前 16 位>.json`，权限 0600；
 * 里面只有标识符与令牌，不含任何消息正文。
 */
/** 状态文件路径：按 accountId 分文件，换账号不会串味。 */
export declare function bridgeStatePath(accountId: any, { homeDir }?: any): string;
/**
 * 创建一个状态仓库。
 * @param options.filePath 状态文件绝对路径（由 bridge 用 bridgeStatePath 算好）
 * @param options.logger   cordis logger（可选）
 */
export declare function createBridgeStore({ filePath, logger }?: any): {
    /** 读一次磁盘状态；文件不存在或损坏时回退到空状态（不阻塞桥启动）。 */
    load(): Promise<void>;
    getCursor(): any;
    setCursor(cursor: any): void;
    getContextToken(userId: any): string;
    setContextToken(userId: any, contextToken: any): void;
    /**
     * 该用户当前的会话代号（1 = 首个会话，/new 之后递增）。
     * 必须落盘：否则重启后 /new 的记忆丢失，会跳回旧会话继续聊。
     */
    getGeneration(userId: any): any;
    setGeneration(userId: any, generation: any): void;
    /**
     * 该用户手动绑定到哪条会话（/use 选的）。undefined 表示还没选过，用自动派生的 id。
     * 必须落盘：否则重启后又跳回自动派生的那条会话。
     */
    getBinding(userId: any): string;
    setBinding(userId: any, sessionId: any): void;
    clearBinding(userId: any): void;
    /**
     * 上次发欢迎语的时间戳（毫秒）。用来实现「首次接触或隔了一天没说话才再打招呼」。
     * 必须落盘：否则每次重启都重新播一遍欢迎语。
     */
    getGreetedAt(userId: any): any;
    setGreetedAt(userId: any, at?: number): void;
    hasSeen(key: any): any;
    markSeen(key: any): void;
    /** 给状态接口用的摘要（有意不含 token 明文）。 */
    summary(): {
        cursor: string;
        contexts: number;
        generations: number;
        bindings: number;
        greeted: number;
        seen: any;
        updatedAt: any;
    };
    /** 桥接开关；undefined 表示还没在面板里改过（用配置默认值）。 */
    getEnabled(): any;
    setEnabled(enabled: any): void;
    /** 访问策略：'open' | 'allowlist'；undefined 表示还没设置过（用配置默认值）。 */
    getPolicy(): any;
    setPolicy(policy: any): void;
    /** 白名单（原始用户 id，仅在 host 内存里与状态文件中使用，不回前端明文）。 */
    getAllowFrom(): any[];
    setAllowFrom(list: any): string[];
    /**
     * 「本人」是否已经确认过。
     *
     * 登录拿到的是扫码用户的 `ilink_user_id`，消息里是 `from_user_id`，两者不保证同一个命名空间；
     * 所以在本人真正说过一句话之前不锁定，第一个说话的人会被认作本人（之后陌生人一律拒绝）。
     */
    isOwnerPinned(): boolean;
    pinOwner(): void;
    /** 立即落盘（停止监听/退出时调用）。 */
    flush(): Promise<void>;
};
//# sourceMappingURL=store.d.ts.map