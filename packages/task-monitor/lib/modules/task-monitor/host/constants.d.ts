export declare const NAME = "dsh-toolkit-task-monitor";
export declare const TASK_MONITOR_SNAPSHOT_PATH: string;
export declare const TASK_MONITOR_SOURCE_ADD_PATH: string;
export declare const TASK_MONITOR_SOURCE_REMOVE_PATH: string;
/** 右栏 tab 类型与 keyed body 的注册身份（页类型，不认领资源地址）。 */
export declare const TASK_MONITOR_KIND = "toolkit-task-monitor";
export declare const TASK_MONITOR_TAB_ID = "dsh-toolkit-task-monitor";
/** 五个分区的固定顺序，与 Qoder 任务监控的设置页一致。 */
export declare const SECTION_ORDER: readonly ["capability", "artifact", "web", "source", "knowledge"];
export type TaskMonitorKind = typeof SECTION_ORDER[number];
/** 首屏每个分区最多露几条，其余收进「查看更多」。 */
export declare const INITIAL_VISIBLE = 5;
/** 单会话条目上限：超出先淘汰最旧的非手动条目，手动来源永远保留。 */
export declare const MAX_ENTRIES = 400;
/** 手动来源（路径 / 链接）的长度上限。 */
export declare const MAX_SOURCE_LENGTH = 2048;
/**
 * 失败码表：4xxx 改输入 / 换状态可能解决，5xxx 环境坏了。
 * routes 用一张 code→status 映射折算 HTTP，client 只读 code 与 detail。
 */
export declare const TASK_MONITOR_REASON: {
    readonly invalidSession: 4101;
    readonly invalidSource: 4102;
    readonly notManual: 4103;
    readonly notFound: 4104;
    readonly disabled: 4105;
    readonly storeFailed: 5101;
};
export type TaskMonitorReasonCode = typeof TASK_MONITOR_REASON[keyof typeof TASK_MONITOR_REASON];
/** 手动链接只认 http/https：javascript: 之类进面板就是 XSS 入口。 */
export declare function isHttpUrl(value: string): boolean;
/** 一条监控条目：host 聚合产出，client 只投影不改造。 */
export interface TaskMonitorEntry {
    readonly id: string;
    readonly kind: TaskMonitorKind;
    readonly label: string;
    readonly detail: string;
    /** 可打开的目标：文件路径或 http(s) 链接；没有则行不可点。 */
    readonly target?: string;
    /** 用户手动添加的来源：可移除，自动聚合的不可。 */
    readonly manual?: boolean;
    readonly count: number;
    readonly status: 'ok' | 'failed';
    readonly updatedAt: number;
}
export interface TaskMonitorSnapshot {
    readonly ok: true;
    readonly sessionId: string;
    readonly updatedAt: number;
    readonly entries: readonly TaskMonitorEntry[];
}
export interface TaskMonitorFailure {
    readonly ok: false;
    readonly code: TaskMonitorReasonCode;
    readonly detail: string;
}
export type TaskMonitorResult = TaskMonitorSnapshot | TaskMonitorFailure;
//# sourceMappingURL=constants.d.ts.map