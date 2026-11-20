import React from "react";

/**
 * 这个会话到底有没有「可展示的内容」。
 *
 * 新开会话一句都没说过时，面板里除了环境信息（分支 / 目录）什么都没有：那几行对用户
 * 没有信息量，还让人以为监控已经在跑了。所以由面板把「拉到的快照里有没有条目」报给
 * 这里，会话内右栏和标题行按钮都按它决定要不要出现。
 *
 * 状态有三档，不能只用 boolean：
 *   undefined 还没拉到快照 —— 当成「有内容」，避免加载中整条栏闪一下又消失
 *   true      有内容
 *   false     确实空（新会话，或只聊了几句没动过工具）
 *
 * 一个模块一份内存记账（跟 rail.ts 一样不落盘）：内容不是用户偏好，刷新后重新问一次
 * 快照就好，没必要把它写进 localStorage。
 */

const readings = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setHasContent(sessionId: string, hasContent: boolean): void {
  if (sessionId === "") return;
  if (readings.get(sessionId) === hasContent) return;
  readings.set(sessionId, hasContent);
  emit();
}

export function hasContentOf(sessionId: string | undefined): boolean | undefined {
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return readings.get(sessionId);
}

export function subscribeContent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHasContent(sessionId: string | undefined): boolean | undefined {
  return React.useSyncExternalStore(
    subscribeContent,
    () => hasContentOf(sessionId),
    () => hasContentOf(sessionId),
  );
}
