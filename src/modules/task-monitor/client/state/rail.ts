import React from "react";

/**
 * 会话内监控栏的显隐状态。
 *
 * 默认显示：会话开始时就能看到本次会话生成了什么，是这一栏存在的理由。
 * 用户点标题栏按钮收起后按会话记住——刷新页面仍然保持收起；换一个新会话
 * 又是默认可见。localStorage 不可用（隐私模式 / 存储被禁）时退回进程内记账。
 */
const KEY = "dsh-toolkit-task-monitor:rail:";

const listeners = new Set<() => void>();
const memory = new Map<string, RailChoice>();

function storageKey(sessionId: string): string {
  return `${KEY}${sessionId}`;
}

/** null 表示用户还没表态：跟对话列宽度走（窄了就自动收起）。 */
export type RailChoice = "visible" | "hidden" | null;

export function railChoice(sessionId: string | undefined): RailChoice {
  if (sessionId === undefined || sessionId === "") return null;
  try {
    const value = localStorage.getItem(storageKey(sessionId));
    return value === "hidden" || value === "visible" ? value : null;
  } catch {
    return memory.get(sessionId) ?? null;
  }
}

export function setRailChoice(sessionId: string, choice: RailChoice): void {
  if (sessionId === "") return;
  try {
    if (choice === null) localStorage.removeItem(storageKey(sessionId));
    else localStorage.setItem(storageKey(sessionId), choice);
  } catch {
    if (choice === null) memory.delete(sessionId);
    else memory.set(sessionId, choice);
  }
  for (const listener of listeners) listener();
}

/** 用户明确收起过。null/visible 都算「没收起」。 */
export function railHidden(sessionId: string | undefined): boolean {
  if (sessionId === undefined || sessionId === "") return true;
  return railChoice(sessionId) === "hidden";
}

export function setRailHidden(sessionId: string, hidden: boolean): void {
  setRailChoice(sessionId, hidden ? "hidden" : null);
}

export function subscribeRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 只订阅当前会话那一位，避免别的会话切换时整栏重渲染。 */
export function useRailHidden(sessionId: string | undefined): boolean {
  return React.useSyncExternalStore(
    subscribeRail,
    () => railHidden(sessionId),
    () => railHidden(sessionId),
  );
}

export function useRailChoice(sessionId: string | undefined): RailChoice {
  return React.useSyncExternalStore(
    subscribeRail,
    () => railChoice(sessionId),
    () => railChoice(sessionId),
  );
}

/**
 * 会话列太窄时默认收起（用户没表过态时才生效）：卡片固定 220px，挤不下就不
 * 硬挤。1000px 与 surfaces/conversation-rail/style.css 的容器查询同值，改一处
 * 要同时改另一处。标题栏按钮始终保留——用户仍可手动展开覆盖这个默认。
 */
export const RAIL_HIDE_WIDTH = 1000;

let narrow = false;
const narrowListeners = new Set<() => void>();

export function railNarrow(): boolean {
  return narrow;
}

export function setRailNarrow(next: boolean): void {
  if (next === narrow) return;
  narrow = next;
  for (const listener of narrowListeners) listener();
}

export function subscribeRailNarrow(listener: () => void): () => void {
  narrowListeners.add(listener);
  return () => {
    narrowListeners.delete(listener);
  };
}

export function useRailNarrow(): boolean {
  return React.useSyncExternalStore(subscribeRailNarrow, railNarrow, railNarrow);
}
