export declare const HOOKS_SNAPSHOT_PATH: string;
export declare const HOOKS_REFRESH_PATH: string;
export declare const HOOKS_TEST_PATH: string;
/** 事件 matcher 的匹配对象：工具名 / 会话来源 / 不匹配。 */
export type HookMatcherTarget = 'tool' | 'source' | 'none';
export interface HookEventDefinition {
    readonly id: string;
    readonly label: string;
    readonly hint: string;
    readonly matcher: HookMatcherTarget;
    readonly supported: boolean;
}
/**
 * 宿主提供的事件名。前五个已接线；其余是 Claude Code 同名事件——配置里写了就在面板
 * 标成「暂不支持」，而不是静默当作生效（Qoder 的页面也把「可见 ≠ 已执行」写明）。
 */
export declare const HOOK_EVENTS: readonly HookEventDefinition[];
export declare const HOOK_EVENT_IDS: ReadonlySet<string>;
export declare function hookEventDefinition(id: string): HookEventDefinition | undefined;
/** 单条 hook 的默认超时（毫秒）。与 Claude Code 的 600s 默认不同：面板上的试跑要等得起。 */
export declare const DEFAULT_HOOK_TIMEOUT_MS = 60000;
export declare const MAX_HOOK_TIMEOUT_MS = 600000;
/** 一次事件最多跑多少条 hook：防止一份失控的配置把每轮对话都拖住。 */
export declare const MAX_HOOKS_PER_EVENT = 20;
export declare const MAX_MATCHER_LENGTH = 200;
export declare const MAX_COMMAND_LENGTH = 2000;
export declare const MAX_HISTORY_ENTRIES = 60;
/** 每条 hook 输出留多少字符进历史（面板只做摘要，完整内容看配置里的命令）。 */
export declare const MAX_OUTPUT_SUMMARY_CHARS = 2000;
/** hooks.json 的体积上限：正常配置只有几 KB，超过这个数一定是写错了。 */
export declare const MAX_CONFIG_BYTES: number;
export declare const REFRESH_BODY_LIMIT = 4096;
export declare const TEST_BODY_LIMIT = 8192;
/** 路由失败的稳定原因串：client 只按这些字符串分支，不改文案。 */
export declare const HOOK_REASON: {
    readonly disabled: "hooks-disabled";
    readonly notFound: "hook-not-found";
    readonly badHookId: "bad-hook-id";
    readonly unsupportedEvent: "unsupported-event";
};
//# sourceMappingURL=constants.d.ts.map