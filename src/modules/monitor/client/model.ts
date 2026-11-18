/**
 * 纯投影：分区分组、排序、首屏裁切、时间标签。不 import react，可单测。
 */
import { INITIAL_VISIBLE, SECTION_ORDER, type MonitorEntry, type MonitorKind } from "./constants.js";

export interface MonitorSection {
  readonly kind: MonitorKind;
  readonly entries: MonitorEntry[];
}

/** 五个分区固定顺序；组内按最近使用倒序（产出即 mtime 口径），同时间按名字稳定排。 */
export function groupSections(entries: readonly MonitorEntry[]): MonitorSection[] {
  return SECTION_ORDER.map((kind) => ({
    kind,
    entries: entries
      .filter((entry) => entry.kind === kind)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label)),
  }));
}

export function visibleOf(entries: readonly MonitorEntry[], expanded: boolean): MonitorEntry[] {
  return expanded ? [...entries] : entries.slice(0, INITIAL_VISIBLE);
}

export function hiddenOf(entries: readonly MonitorEntry[], expanded: boolean): number {
  return expanded ? 0 : Math.max(0, entries.length - INITIAL_VISIBLE);
}

export function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}