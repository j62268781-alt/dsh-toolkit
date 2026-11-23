/**
 * 任务监控的共享定义：路由、业务码、纯规则。
 *
 * 与 git 模块同一套路：client 只能 import host 下的 constants.ts，所以「链接是否合法」
 * 这类两边都要用的规则只此一份；这里不许出现任何 Node 依赖。
 */
import { pluginApiPath } from '../../../host/paths.js';
export const NAME = 'dsh-toolkit-session-panel';
const API_PREFIX = pluginApiPath('session-panel');
export const TASK_MONITOR_SNAPSHOT_PATH = `${API_PREFIX}/snapshot`;
export const TASK_MONITOR_SOURCE_ADD_PATH = `${API_PREFIX}/source-add`;
export const TASK_MONITOR_SOURCE_REMOVE_PATH = `${API_PREFIX}/source-remove`;
/**
 * 面板展示的四个分区（固定顺序）。知识条目仍按 knowledge 记录，只是不占分区：
 * Qoder 的任务监控没有这一栏，用户也明确要求去掉。
 */
export const SECTION_ORDER = ['capability', 'artifact', 'web', 'source'];
/** 允许入库的条目分区：知识仍记录（供未来的检索视图用），只是不占面板分区。 */
export const ENTRY_KINDS = [...SECTION_ORDER, 'knowledge'];
/** 首屏每个分区最多露几条，其余收进「查看更多」。 */
export const INITIAL_VISIBLE = 5;
/** 单会话条目上限：超出先淘汰最旧的非手动条目，手动来源永远保留。 */
export const MAX_ENTRIES = 400;
/** 手动来源（路径 / 链接）的长度上限。 */
export const MAX_SOURCE_LENGTH = 2048;
/**
 * 失败码表：4xxx 改输入 / 换状态可能解决，5xxx 环境坏了。
 * routes 用一张 code→status 映射折算 HTTP，client 只读 code 与 detail。
 */
export const TASK_MONITOR_REASON = {
    invalidSession: 4101,
    invalidSource: 4102,
    notManual: 4103,
    notFound: 4104,
    disabled: 4105,
    storeFailed: 5101,
};
/** 手动链接只认 http/https：javascript: 之类进面板就是 XSS 入口。 */
export function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
