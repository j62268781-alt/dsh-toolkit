/**
 * 纯投影：分区分组、排序、首屏裁切、时间标签。不 import react，可单测。
 */
import { SECTION_ORDER, type TaskMonitorEntry, type TaskMonitorSectionKind } from "./constants.js";

export interface TaskMonitorSection {
  readonly kind: TaskMonitorSectionKind;
  readonly entries: TaskMonitorEntry[];
}

/** 产出按文件修改时间，其余分区按任务事件时间。 */
export function groupSections(entries: readonly TaskMonitorEntry[]): TaskMonitorSection[] {
  return SECTION_ORDER.map((kind) => ({
    kind,
    entries: entries.filter((entry) => entry.kind === kind).sort((left, right) => {
      const byName = () => left.label.localeCompare(right.label);
      if (kind !== "artifact") return right.updatedAt - left.updatedAt || byName();
      return Number(left.unavailable === true) - Number(right.unavailable === true)
        || (right.modifiedAt ?? -Infinity) - (left.modifiedAt ?? -Infinity) || byName();
    }),
  }));
}

/**
 * 复刻宿主的 `fileAddressFor`：右栏 `sidebarRight.openResource` 只认
 * `dsh-resource://file/session/<encSession>/<encPath>` 这一种拼写。
 *
 * 为什么不直接 require：提供它的 `@deepseek-ai/dsh-util-workspace-path` 是宿主
 * **host** 侧包，浏览器模块表里没有它（`@deepseek-ai/dsh-client-ui-open-in-app`
 * 里有同名函数但不导出），client 侧 require 必抛。编码规则与那份实现逐字对齐：
 * 逐段 encodeURIComponent 后再把 `%3A` 还原成 `:`（盘符），绝对路径按会话 cwd
 * 折叠成相对路径，落在 cwd 外的绝对路径原样带进 session 地址交给宿主解析。
 */
const FILE_ADDRESS_PREFIX = "dsh-resource://file/";

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeSegment).join("/");
}

function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\");
}

export function fileAddressFor(sessionId: string, cwd: string, path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
  if (root !== "" && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  return sessionFileAddress(sessionId, normalized);
}
