/**
 * 微信侧只读查询：当前会话、工作区列表、某个工作区下的会话列表。
 *
 * 全部走 DSH 的只读服务（workspaceRegistry / sessionQuery / permissionPresets），
 * 不激活 Agent、不读凭据、不碰网络；服务缺失时退化成能看懂的提示而不是抛错。
 *
 * 微信里不能渲染 Markdown，所以这里直接产出纯文本（每行一条）。
 */
/**
 * 归一化后的工作区：{ id, title, path, sessionIds }。
 * registry 缺失时用会话的 cwd 兜底推导，保证命令总有结果。
 */
export declare function loadWorkspaces(ctx: any): Promise<any[]>;
/** 在给定工作区里按序号 / 路径 / 名字定位一个工作区。 */
export declare function resolveWorkspace(workspaces: any, ref: any): any;
/**
 * 「当前任务」三件套：工作区、session_id、会话名（外带权限预设）。
 * @param {object} options
 * @param {object} options.ctx 宿主上下文
 * @param {string} [options.sessionId] 当前会话 id
 * @param {string} [options.workspaceCwd] 桥接使用的工作区（会话还没建时也能答）
 */
export declare function describeCurrent({ ctx, sessionId, workspaceCwd }?: any): Promise<string>;
/** 工作区列表（序号供 /sessions <序号> 用）。 */
export declare function describeWorkspaces(ctx: any): Promise<string>;
/** 某个工作区最近的会话（带标题）；/sessions 的文案与 /use 的序号共用这一份。 */
export declare function sessionsOfWorkspace(ctx: any, workspacePath: any, { limit }?: any): Promise<{
    total: number;
    sessions: {
        id: any;
        title: any;
    }[];
}>;
/** 按 id 前缀找会话（跨工作区，最多 limit 条），/use 用。 */
export declare function sessionsByPrefix(ctx: any, prefix: any, { limit }?: any): Promise<{
    id: any;
    cwd: any;
    title: any;
}[]>;
/** 某个工作区下的会话（最近优先，最多 MAX_SESSION_LINES 条）。 */
export declare function describeWorkspaceSessions({ ctx, workspace, currentSessionId, listing }?: any): Promise<string>;
/** `/sessions all`：每个工作区取最近几条，只读一遍语料。 */
export declare function describeAllSessions({ ctx, currentSessionId }?: any): Promise<string>;
/** 判断 /sessions 的参数是不是 "all"。 */
export declare function isAllRef(ref: any): boolean;
//# sourceMappingURL=inspect.d.ts.map