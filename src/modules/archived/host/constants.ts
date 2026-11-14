import { pluginApiPath } from "../../../host/paths.js";

/**
 * Route paths shared by the host route table and the client that calls them.
 *
 * Only `/api/plugins/toolkit/<module>/…` is generated here; the client bundle
 * evaluates this file too, so a Node-only import would break the browser.
 */
const API_PREFIX = pluginApiPath("archived");

export const DELETE_SESSION_PATH = `${API_PREFIX}/delete-session`;
export const DELETE_SESSIONS_PATH = `${API_PREFIX}/delete-sessions`;
export const PENDING_DELETIONS_PATH = `${API_PREFIX}/pending-deletions`;

/**
 * 删除结果码 —— host 与 client 共用的唯一一份数字表。
 *
 * 数字而不是字符串：两件事各自独立、谁也不像谁。`4xxx` 这次请求或当前状态不允许
 * （用户重试、刷新、等会话闲下来都可能变），`5xxx` 环境坏了（重试无用，要人来处理），
 * `1xxx` 已经完成。客户端因此可以只认区间做粗分类，也可以认到具体码；宿主与 HTTP
 * 状态之间的映射留在 `host/routes/deletion.ts`，绝不在这里反推。
 *
 * 代价是数字本身不自解释，所以**只允许通过这张表的键引用**（`DELETION_CODE.sessionBusy`），
 * 不要在业务代码里写 4104 这种字面量。
 *
 * client 会求值本文件，因此这里不能出现 Node 依赖。
 */
export const DELETION_CODE = {
  /** 目录已搬进回收站。 */
  deleted: 1001,
  /** 文件搬走了，但归档登记作为 tombstone 留在宿主里（宿主还持有这个 session）。 */
  retained: 1002,
  invalidSessionId: 4101,
  /** 文件本来就不在了：视作成功，只需清掉归档登记。 */
  notFound: 4102,
  /** 宿主持有该 session，但它已经不在归档里 —— 用户在普通侧栏里能看到它。 */
  sessionLoaded: 4103,
  /** 会话还在跑，等它停下来再删。 */
  sessionBusy: 4104,
  /** rename 失败：句柄被占用或没有权限，可重试。 */
  moveFailed: 4105,
  /** 整个 `sessions/` 目录读不到：profile 坏了或 DSH_HOME 指错。 */
  noSessionsDirectory: 5101,
  unknown: 5199,
} as const;

export type DeletionCode = (typeof DELETION_CODE)[keyof typeof DELETION_CODE];
export type DeletionSuccessCode = typeof DELETION_CODE.deleted | typeof DELETION_CODE.retained;
export type DeletionFailureCode = Exclude<DeletionCode, DeletionSuccessCode>;
