/**
 * 任务监控的共享定义：路由、业务码、纯规则。
 *
 * 与 git 模块同一套路：client 只能 import host 下的 constants.ts，所以「链接是否合法」
 * 这类两边都要用的规则只此一份；这里不许出现任何 Node 依赖。
 */
import { pluginApiPath } from '../../../host/paths.js'

export const NAME = 'dsh-toolkit-task-monitor'

const API_PREFIX = pluginApiPath('task-monitor')
export const TASK_MONITOR_SNAPSHOT_PATH = `${API_PREFIX}/snapshot`
export const TASK_MONITOR_SOURCE_ADD_PATH = `${API_PREFIX}/source-add`
export const TASK_MONITOR_SOURCE_REMOVE_PATH = `${API_PREFIX}/source-remove`

/** 右栏 tab 类型与 keyed body 的注册身份（页类型，不认领资源地址）。 */
export const TASK_MONITOR_KIND = 'toolkit-task-monitor'
export const TASK_MONITOR_TAB_ID = 'dsh-toolkit-task-monitor'

/**
 * 面板展示的四个分区（固定顺序）。知识条目仍按 knowledge 记录，只是不占分区：
 * Qoder 的任务监控没有这一栏，用户也明确要求去掉。
 */
export const SECTION_ORDER = ['capability', 'artifact', 'web', 'source'] as const
export type TaskMonitorSectionKind = typeof SECTION_ORDER[number]
export type TaskMonitorKind = TaskMonitorSectionKind | 'knowledge'
/** 允许入库的条目分区：知识仍记录（供未来的检索视图用），只是不占面板分区。 */
export const ENTRY_KINDS = [...SECTION_ORDER, 'knowledge'] as const satisfies readonly TaskMonitorKind[]

/** 首屏每个分区最多露几条，其余收进「查看更多」。 */
export const INITIAL_VISIBLE = 5

/** 单会话条目上限：超出先淘汰最旧的非手动条目，手动来源永远保留。 */
export const MAX_ENTRIES = 400

/** 手动来源（路径 / 链接）的长度上限。 */
export const MAX_SOURCE_LENGTH = 2048

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
} as const
export type TaskMonitorReasonCode = typeof TASK_MONITOR_REASON[keyof typeof TASK_MONITOR_REASON]

/** 手动链接只认 http/https：javascript: 之类进面板就是 XSS 入口。 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 一条监控条目：host 聚合产出，client 只投影不改造。 */
export interface TaskMonitorEntry {
  readonly id: string
  readonly kind: TaskMonitorKind
  readonly label: string
  readonly detail: string
  /** 可打开的目标：文件路径或 http(s) 链接；没有则行不可点。 */
  readonly target?: string
  /** 用户手动添加的来源：可移除，自动聚合的不可。 */
  readonly manual?: boolean
  readonly count: number
  readonly status: 'ok' | 'failed'
  readonly updatedAt: number
}

/**
 * 官方「代码审查和变更」tab 的坐标。
 *
 * `seq` 是会话里那条 `workspace/changes` 事件自己的序号、`turn` 是事件 data 里的回合号：
 * 官方 tab 的地址按 `<sessionId>/<seq>/<turn>` 三段解析，缺一段就打不开，而事件序号不是回合号，
 * 所以只能由宿主从事件里记下来，不能拿面板轮询的次数硬凑。
 */
export interface ChangesReviewCoordinates {
  readonly seq: number
  readonly turn: number
}

export interface TaskMonitorSnapshot {
  readonly ok: true
  readonly sessionId: string
  readonly updatedAt: number
  readonly entries: readonly TaskMonitorEntry[]
  /** 最近一次变更记录的坐标：有值且官方审查插件装着时，面板那行可点。 */
  readonly review: ChangesReviewCoordinates | null
}

export interface TaskMonitorFailure {
  readonly ok: false
  readonly code: TaskMonitorReasonCode
  readonly detail: string
}

export type TaskMonitorResult = TaskMonitorSnapshot | TaskMonitorFailure