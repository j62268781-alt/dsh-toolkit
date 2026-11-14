/**
 * Hooks 模块的纯常量：路由、事件表、上限与失败原因。
 *
 * client 也会求值本文件（面板要按事件分组），所以这里**不能** import 任何 Node 模块。
 */
import { pluginApiPath } from '../../../host/paths.js';
const API_PREFIX = pluginApiPath('hooks');
export const HOOKS_SNAPSHOT_PATH = `${API_PREFIX}/snapshot`;
export const HOOKS_REFRESH_PATH = `${API_PREFIX}/refresh`;
export const HOOKS_TEST_PATH = `${API_PREFIX}/test`;
/**
 * 宿主提供的事件名。前五个已接线；其余是 Claude Code 同名事件——配置里写了就在面板
 * 标成「暂不支持」，而不是静默当作生效（Qoder 的页面也把「可见 ≠ 已执行」写明）。
 */
export const HOOK_EVENTS = [
    { id: 'SessionStart', label: '会话开始', hint: '会话创建或恢复时触发；输出的 additionalContext 会作为上下文注入第一轮。', matcher: 'source', supported: true },
    { id: 'UserPromptSubmit', label: '提交提示词', hint: '每次提交提示词后、模型开始前触发；可以拒绝本轮请求或追加上下文。', matcher: 'none', supported: true },
    { id: 'PreToolUse', label: '工具调用前', hint: '每次调用工具前触发；可以放行、拒绝或要求确认。', matcher: 'tool', supported: true },
    { id: 'PostToolUse', label: '工具调用后', hint: '工具返回后触发；可以拦截这次结果（把反馈交还给模型）或追加上下文。', matcher: 'tool', supported: true },
    { id: 'Stop', label: '准备结束回合', hint: '回合并未出错、即将结束时触发；拒绝会让模型继续做一步。', matcher: 'none', supported: true },
    { id: 'SessionEnd', label: '会话结束', hint: '会话被关闭时触发。', matcher: 'source', supported: false },
    { id: 'SubagentStart', label: '子代理开始', hint: '子代理被创建时触发。', matcher: 'none', supported: false },
    { id: 'SubagentStop', label: '子代理结束', hint: '子代理结束时触发。', matcher: 'none', supported: false },
    { id: 'PostToolUseFailure', label: '工具调用失败', hint: '工具抛错后触发。', matcher: 'tool', supported: false },
    { id: 'PermissionRequest', label: '权限询问', hint: '需要用户批准时触发。', matcher: 'tool', supported: false },
    { id: 'PreCompact', label: '压缩上下文前', hint: '上下文压缩前触发。', matcher: 'source', supported: false },
    { id: 'Notification', label: '通知', hint: '宿主发出通知时触发。', matcher: 'none', supported: false },
];
export const HOOK_EVENT_IDS = new Set(HOOK_EVENTS.map((event) => event.id));
export function hookEventDefinition(id) {
    return HOOK_EVENTS.find((event) => event.id === id);
}
/** 单条 hook 的默认超时（毫秒）。与 Claude Code 的 600s 默认不同：面板上的试跑要等得起。 */
export const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
export const MAX_HOOK_TIMEOUT_MS = 600_000;
/** 一次事件最多跑多少条 hook：防止一份失控的配置把每轮对话都拖住。 */
export const MAX_HOOKS_PER_EVENT = 20;
export const MAX_MATCHER_LENGTH = 200;
export const MAX_COMMAND_LENGTH = 2_000;
export const MAX_HISTORY_ENTRIES = 60;
/** 每条 hook 输出留多少字符进历史（面板只做摘要，完整内容看配置里的命令）。 */
export const MAX_OUTPUT_SUMMARY_CHARS = 2_000;
/** hooks.json 的体积上限：正常配置只有几 KB，超过这个数一定是写错了。 */
export const MAX_CONFIG_BYTES = 1_024 * 1_024;
export const REFRESH_BODY_LIMIT = 4_096;
export const TEST_BODY_LIMIT = 8_192;
/** 路由失败的稳定原因串：client 只按这些字符串分支，不改文案。 */
export const HOOK_REASON = {
    disabled: 'hooks-disabled',
    notFound: 'hook-not-found',
    badHookId: 'bad-hook-id',
    unsupportedEvent: 'unsupported-event',
};
//# sourceMappingURL=constants.js.map