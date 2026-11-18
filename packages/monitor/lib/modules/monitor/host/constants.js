/**
 * 任务监控的共享定义：路由、业务码、纯规则。
 *
 * 与 git 模块同一套路：client 只能 import host 下的 constants.ts，所以「链接是否合法」
 * 这类两边都要用的规则只此一份；这里不许出现任何 Node 依赖。
 */
import { pluginApiPath } from '../../../host/paths.js';
export const NAME = 'dsh-toolkit-monitor';
const API_PREFIX = pluginApiPath('monitor');
export const MONITOR_SNAPSHOT_PATH = `${API_PREFIX}/snapshot`;
export const MONITOR_SOURCE_ADD_PATH = `${API_PREFIX}/source-add`;
export const MONITOR_SOURCE_REMOVE_PATH = `${API_PREFIX}/source-remove`;
/** 右栏 tab 类型与 keyed body 的注册身份（页类型，不认领资源地址）。 */
export const MONITOR_KIND = 'toolkit-monitor';
export const MONITOR_TAB_ID = 'dsh-toolkit-monitor';
/** 五个分区的固定顺序，与 Qoder 任务监控的设置页一致。 */
export const SECTION_ORDER = ['capability', 'artifact', 'web', 'source', 'knowledge'];
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
export const MONITOR_REASON = {
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
//# sourceMappingURL=constants.js.map