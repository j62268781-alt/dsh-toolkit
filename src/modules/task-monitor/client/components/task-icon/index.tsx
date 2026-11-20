/**
 * 任务监控自己的图标：两行「勾选 + 任务文本」的清单。
 *
 * 之前用的是宿主 primitives 的 IconInspectOutlineRegular——放大镜在标题行里
 * 读起来像「搜索」，跟「任务」无关。清单的语义更直白，也不用替宿主维护一个新
 * 图标（primitives 是按名取用的模块表，加不进去）。
 * 纯 SVG、随 currentColor 走，尺寸由调用方给（标题行是 16）。
 */
import React from "react";

export function TaskMonitorIcon(props: { size?: number }): React.ReactElement {
  const size = props.size ?? 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.8 7.3l2 2 3.5-3.6" />
      <path d="M12.6 7h7.6" />
      <path d="M3.8 16.7l2 2 3.5-3.6" />
      <path d="M12.6 16.7h7.6" />
    </svg>
  );
}
