/**
 * 未绑定会话时的「选择器」：欢迎语、选择卡、序号回复。
 *
 * 交互顺序（尽量短，微信里打字少）：
 *   1. 先给工作区卡：只显示目录名，最后一项是「不选，用默认工作区」；
 *   2. 选完工作区再给会话卡：第 1 项永远是「新建」，其余是本工作区的全部会话（只显示标题）；
 *   3. 会话卡里的 0 是回到工作区卡。
 *
 * 设计约束：
 *   · 微信里只能发纯文本，所以选择靠「回复数字」；
 *   · 命令永远放行（/help /start /sessions /use /new …），选择器只管普通消息和纯数字；
 *   · 待选状态只活 10 分钟且一次消费，避免把 Agent 的追问答案（比如「2」）误当成选择。
 */
export declare const CHOICE_TTL_MS: number;
/** 同一用户两次欢迎语的最小间隔：超过这个时间没聊过才重新打招呼。 */
export declare const GREET_INTERVAL_MS: number;
/** 会话卡里最多列多少条（正常够用；超过时在卡尾说明总数）。 */
export declare const SESSION_LIST_LIMIT = 100;
/** 会话卡的第一项：在这个工作区新建一条会话。 */
export declare const NEW_SESSION_OPTION = 1;
/** 会话卡的 0：回到工作区卡。 */
export declare const BACK_TO_WORKSPACES = 0;
export declare const WELCOME_TEXT: string;
/** 工作区在卡上只显示最后一段目录名；家目录显示成 `~`。 */
export declare function workspaceLabel(path: any, home: any): string;
/**
 * 工作区卡：1..N 选工作区，最后一项是「不选，用默认工作区」。
 */
export declare function workspaceCardText({ workspaces, currentPath, defaultPath, home }: any): string;
/**
 * 会话卡：1 = 新建，2..N+1 = 本工作区的会话（只显示标题），0 = 换工作区。
 */
export declare function sessionCardText({ workspacePath, sessions, total, home }: any): string;
/** 纯数字回复才算选择；其它一律当普通消息。 */
export declare function parseChoice(text: any): number;
/**
 * 选择器状态机（每个用户一份，只在内存里；重启后重新发一次 /start 即可）。
 * @param options.ctx 宿主 ctx
 * @param options.conversations 会话管理器
 * @param options.workspaceCwd 桥的默认工作区
 * @param options.home 家目录（卡上把它显示成 `~`）
 */
export declare function createPicker({ ctx, conversations, workspaceCwd, home, logger, ttlMs }: any): {
    clear: (userId: any) => void;
    clearChoice: (userId: any) => void;
    suspend: (userId: any, message: any) => void;
    takePending: (userId: any) => any;
    showSessions: (userId: any, workspacePath: any) => Promise<string>;
    showWorkspaces: (userId: any) => Promise<string>;
    choose: (userId: any, number: any) => Promise<{
        texts: string[];
        bound?: undefined;
    } | {
        texts: string[];
        bound: {
            sessionId: any;
            workspacePath: any;
        };
    }>;
    isAwaiting(userId: any): boolean;
};
//# sourceMappingURL=picker.d.ts.map