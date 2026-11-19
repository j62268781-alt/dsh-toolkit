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
const memory = new Set<string>();

function storageKey(sessionId: string): string {
  return `${KEY}${sessionId}`;
}

export function railHidden(sessionId: string | undefined): boolean {
  if (sessionId === undefined || sessionId === "") return true;
  try {
    return localStorage.getItem(storageKey(sessionId)) === "hidden";
  } catch {
    return memory.has(sessionId);
  }
}

export function setRailHidden(sessionId: string, hidden: boolean): void {
  if (sessionId === "") return;
  try {
    if (hidden) localStorage.setItem(storageKey(sessionId), "hidden");
    else localStorage.removeItem(storageKey(sessionId));
  } catch {
    if (hidden) memory.add(sessionId);
    else memory.delete(sessionId);
  }
  for (const listener of listeners) listener();
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

/**
 * 会话列太窄时自动退场：卡片固定 220px，挤在宽度不足的对话区里只会把消息列
 * 压到不可读。1000px 与 components/panel/style.css 的容器查询同值，改一处要
 * 同时改另一处。窄到这一步时标题栏按钮也一起消失——否则按了没反应。
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
