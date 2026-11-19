/**
 * 纯投影：分区分组、排序、首屏裁切、时间标签。不 import react，可单测。
 */
import { INITIAL_VISIBLE, SECTION_ORDER, type TaskMonitorEntry, type TaskMonitorSectionKind } from "./constants.js";

export interface TaskMonitorSection {
  readonly kind: TaskMonitorSectionKind;
  readonly entries: TaskMonitorEntry[];
}

/** 四个分区固定顺序；组内按最近使用倒序（产出即 mtime 口径），同时间按名字稳定排。 */
export function groupSections(entries: readonly TaskMonitorEntry[]): TaskMonitorSection[] {
  return SECTION_ORDER.map((kind) => ({
    kind,
    entries: entries
      .filter((entry) => entry.kind === kind)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label)),
  }));
}

export function visibleOf(entries: readonly TaskMonitorEntry[], expanded: boolean): TaskMonitorEntry[] {
  return expanded ? [...entries] : entries.slice(0, INITIAL_VISIBLE);
}

export function hiddenOf(entries: readonly TaskMonitorEntry[], expanded: boolean): number {
  return expanded ? 0 : Math.max(0, entries.length - INITIAL_VISIBLE);
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

export function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/**
 * 官方「代码审查和变更」tab 的地址：`dsh-resource://changes-review/session/<enc>/<seq>/<turn>`。
 *
 * 它由宿主 deliverables 插件按回合注册（`parseChangesReviewAddress` 只认这个三段式），
 * 所以 seq / turn 必须是 `workspace/changes` 事件自己的，不能拿回合序号硬凑。
 */
export function changesReviewAddress(sessionId: string, seq: number, turn: number): string {
  return `dsh-resource://changes-review/session/${encodeURIComponent(sessionId)}/${seq}/${turn}`;
}
