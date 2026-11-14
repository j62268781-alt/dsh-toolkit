export type HookFileId = 'user' | 'project' | 'local';
export type HookFileState = 'ok' | 'missing' | 'invalid' | 'unreadable';
export interface HookSourceFile {
    id: HookFileId;
    label: string;
    path: string;
    state: HookFileState;
    /** 读/解析失败的一句话原因（`missing` 时为空）。 */
    error: string;
    /** 该文件贡献了多少条 hook。 */
    hooks: number;
}
export interface HookView {
    id: string;
    event: string;
    matcher: string;
    command: string;
    timeoutMs: number;
    source: HookFileId;
    sourcePath: string;
    supported: boolean;
}
export interface HookIssue {
    id: string;
    severity: 'error' | 'warning';
    code: string;
    message: string;
    path: string;
    event: string;
    hookId: string;
}
export interface HookEventView {
    id: string;
    label: string;
    hint: string;
    matcher: 'tool' | 'source' | 'none';
    supported: boolean;
    count: number;
}
export interface HooksSnapshot {
    readAt: number;
    enabled: boolean;
    projectDir: string;
    files: HookSourceFile[];
    hooks: HookView[];
    issues: HookIssue[];
    events: HookEventView[];
}
export interface HookStoreOptions {
    /** `$DSH_HOME`：`${DSH_HOME}` 占位符与用户级默认路径都按它解析。 */
    home: string;
    /**
     * 项目目录：项目级文件位置、hook 进程的 cwd、`${project}` 占位符。
     *
     * 传函数时每次读取都求值——桌面端 DSH 的 `process.cwd()` 是安装目录而不是用户工作区，
     * 只有跟着会话的 working directory 走，项目级 hooks 才会落在用户真正在改的仓库里。
     */
    projectDir: string | (() => string);
    /** 配置里的用户级文件；空串表示 `<home>/hooks.json`。 */
    userFile: string;
    includeProject: boolean;
    defaultTimeoutMs: number;
    /** 模块总开关：关掉后仍能看到配置，但不会执行。 */
    enabled: () => boolean;
}
interface ParsedHook {
    event: string;
    matcher: string;
    command: string;
    timeoutMs: number;
    supported: boolean;
}
/** `${...}` 占位符：DSH_HOME / project。取不到的变量原样保留，让人一眼看出写错了。 */
export declare function substitutePlaceholders(text: string, vars: Record<string, string>): string;
/**
 * 把一份已解析的 JSON 转成 hook 列表 + 诊断。
 *
 * 容错原则：**能看懂的都收下**（字符串简写、单条 hook 直接挂在分组上），看不懂的记一条
 * 诊断后跳过——绝不因为一条写错就整份作废（那样用户根本不知道是哪条错了）。
 */
export declare function parseHookDocument(raw: unknown, file: {
    id: HookFileId;
    path: string;
}, defaultTimeoutMs: number): {
    hooks: ParsedHook[];
    issues: HookIssue[];
};
export declare function resolveHookFiles(options: {
    home: string;
    projectDir: string;
    userFile: string;
    includeProject: boolean;
}): Array<{
    id: HookFileId;
    label: string;
    path: string;
}>;
export interface HookStore {
    snapshot(): Promise<HooksSnapshot>;
    /** 命中的 hook（已按 matcher 过滤，且只含已接线的事件）。 */
    hooksFor(event: string, subject: string): Promise<HookView[]>;
    /** 找出面板上某条 hook 当前对应的条目（试跑用；配置改了会返回 undefined）。 */
    find(hookId: string): Promise<HookView | undefined>;
    invalidate(): void;
    files(): Array<{
        id: HookFileId;
        label: string;
        path: string;
    }>;
}
export declare function createHookStore(options: HookStoreOptions): HookStore;
export {};
//# sourceMappingURL=files.d.ts.map