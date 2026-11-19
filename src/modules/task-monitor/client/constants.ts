/**
 * 面板与宿主共用的规则/常量：直接取 host 的 constants.ts（纯函数、无 Node 依赖），
 * 不复制第二份。
 */
export {
  INITIAL_VISIBLE,
  MAX_SOURCE_LENGTH,
  TASK_MONITOR_SNAPSHOT_PATH,
  TASK_MONITOR_SOURCE_ADD_PATH,
  TASK_MONITOR_SOURCE_REMOVE_PATH,
  SECTION_ORDER,
  isHttpUrl,
  type TaskMonitorEntry,
  type TaskMonitorKind,
  type TaskMonitorSnapshot,
} from "../host/constants.js";

/** 面板可见时的轮询间隔：宿主事件只活在 host 进程里，client 用轻量轮询追新。 */
export const TASK_MONITOR_POLL_MS = 2500;