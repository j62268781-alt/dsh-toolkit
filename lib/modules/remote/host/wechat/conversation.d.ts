/**
 * 微信会话 ↔ DSH Agent 的映射与生命周期。
 *
 * 每个微信用户对应一个持久 Session（id 由 accountId + 用户 id 派生，跨重启稳定）：
 *   · 首次消息：ctx.agents.create 建会话，挂载预设、设置权限、注入身份提示；
 *   · 重启后：ctx.agents.get 拿不到实例时用 ctx.agents.resume 恢复历史；
 *   · 同一用户的多次消息串行处理（同一 Agent 同时只跑一个 turn）。
 *
 * 这里只负责「跑一轮并把回复取出来」，发哪条消息、怎么发由 bridge.js 决定。
 */
/**
 * 把本插件的 source.kind 注册进宿主的消息来源表。
 *
 * `MessageSourceMap` 是「合并扩展」的接口：每个 producer 在自己的模块里声明自己的 kind，
 * 宿主没有（也明确不要）共享的 catch-all `plugin` kind。不在这里声明，`createUserMessage`
 * 会在类型层拒绝 `plugin:dsh-toolkit-remote` —— 而运行时它是合法的（见下方 INSTRUCTIONS_SOURCE）。
 */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'plugin:dsh-toolkit-remote': {
            kind: 'plugin:dsh-toolkit-remote';
            form: 'instructions';
        };
    }
}
/**
 * 注入身份提示时用的来源标记。
 *
 * DSH 会话格式 v4 只接受「producer-owned」的 source.kind：写成 `{ kind: 'plugin', plugin }`
 * 会被会话写入端直接拒绝（`format v4 message requires a producer-owned source kind`），
 * 而且这个错误发生在写入历史时，首条消息可能正常、下一条才炸。插件来源的规范写法是
 * `plugin:<插件名>`（与运行时写入的 `plugin:claude-mem` 一致）。
 */
export declare const INSTRUCTIONS_SOURCE: Readonly<{
    kind: "plugin:dsh-toolkit-remote";
    form: "instructions";
}>;
/** 会话 id：稳定、可读前缀、不含敏感原文。 */
export declare function sessionIdFor(accountId: any, userId: any, generation?: number): string;
/** 会话标题（展示在 DSH 会话列表里）。 */
export declare function sessionTitleFor(userId: any): string;
/** 事件日志长度：新版 Session 是 `seq`，旧版与测试桩是 `events` 数组。 */
export declare function eventCount(agent: any): any;
/** 取 start 之后新增的事件（半开区间）。 */
export declare function eventsSince(agent: any, start: any): any;
/** 从 turn 事件里取出回复文本与图片。 */
export declare function collectReply(events: any): {
    text: string;
    images: any[];
    sawError: boolean;
    errorText: string;
};
/**
 * 创建会话管理器。
 *
 * 一个微信用户同一时间只驱动**一条** DSH 会话：
 *   · 默认用从 accountId + userId 派生的 id（重启后仍是同一条）；
 *   · 用户可以用 /use 绑定到任意一条已有会话（含 GUI 里正开着的），也可以 /new 换一条；
 *   · 绑定关系落盘（bindings），重启后继续用同一条。
 *
 * 「接管」与「恢复」的区别很重要：
 *   · 会话在 DSH 里正开着（agents.get 拿得到 agent）→ 直接接管，**不能 dispose**，
 *     否则会把 GUI 里那条会话一起关掉；
 *   · 只有历史会话 → agents.resume，并挂上会话头里记录的 agentPreset；
 *   · 我们自己创建/恢复的 agent 才在切换时 dispose。
 *
 * @param options.ctx         宿主 ctx（agents / agentPresets / permissionPresets / sessionPersistence / llm ...）
 * @param options.settings     模块设置（agentPreset / permissionPreset）
 * @param options.workspaceCwd 新建会话的工作目录
 * @param options.logger       logger
 * @param options.onApproval   审批转发钩子 (userId) => listener|undefined
 * @param options.generations  会话代号持久化 {get(userId):number|undefined, set(userId,generation)}（可选）
 * @param options.bindings     会话绑定持久化 {get(userId):string|undefined, set(userId,sessionId), clear(userId)}（可选）
 */
export declare function createConversations({ ctx, settings, workspaceCwd, logger, onApproval, generations, bindings }?: any): {
    /** 入队一轮对话。 */
    process(userId: any, content: any): any;
    /** 取消当前回合。 */
    cancel(userId: any): Promise<boolean>;
    /** 开启新会话（旧的保留在历史里，可回看）。 */
    rotate(userId: any, cwd: any): any;
    /** 这条会话是否正在跑（切走前要拦一下，否则会把跑到一半的回合掐掉）。 */
    isBusy(userId: any): boolean;
    /**
     * 切换到一条已有会话（/use 用）。
     * @returns {string} 切换后的 session id
     */
    switchTo(userId: any, sessionId: any, cwd: any): any;
    /** 解除绑定（会话被删掉、或用户想重新选）。 */
    unbind(userId: any): void;
    /** 这条会话是自动派生的、/use 选的，还是 /new 新建的。 */
    sourceOf(userId: any): any;
    /** 当前绑定的是哪条会话（不是 /use 选的则 undefined）。 */
    bindingOf(userId: any): any;
    /** 这个用户新建会话时该用哪个工作区（选择卡里换过就按换过的）。 */
    workspaceOf(userId: any): any;
    /** 当前会话 id（含 /use 绑定，未绑定则是自动派生的那条）。 */
    sessionIdOf(userId: any): any;
    /** 模块卸载：解绑审批监听，并释放我们自己创建的 agent（接管来的不动）。 */
    dispose(): void;
    replyTimeoutMs: number;
};
//# sourceMappingURL=conversation.d.ts.map