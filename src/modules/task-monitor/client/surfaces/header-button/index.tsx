/**
 * 会话标题行最右的「任务监控」开关：控制会话内容区右栏的显隐。
 *
 * 面板本身挂在 conversation.hero.frame（见 surfaces/conversation-rail），这里只
 * 写显隐状态；状态按会话记在 localStorage 里，收起后刷新仍收起，换会话默认再打开。
 */
import React from "react";
import { installSlot } from "../../../../../client/ui/slot.js";
import { TaskMonitorIcon } from "../../components/task-icon/index.jsx";
import { TASK_MONITOR_NS } from "../../locale.js";
import { useHasContent } from "../../state/content.js";
import { setRailChoice, useRailChoice, useRailNarrow } from "../../state/rail.js";

export const NAME = "header-button";

export function install(ctx: any, useOfficialPanel: () => boolean) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);

  function HeaderButton(props: any) {
    const official = useOfficialPanel();
    const sessionId: string | undefined = props.sessionId;
    const choice = useRailChoice(sessionId);
    const narrow = useRailNarrow();
    // 会话里还没产生任何条目（新开会话）时不出现：这时候展开也只有一个空壳子。
    // undefined 是「还没拉到快照」，照常显示，免得按钮闪一下。
    const empty = useHasContent(sessionId) === false;
    const open = typeof sessionId === "string" && sessionId !== ""
      && (choice === "visible" || (choice === null && !narrow));
    const label = t("trigger");
    if (official || empty) return null;
    return (
      <button
        type="button"
        className="sk-task-monitor-button"
        aria-label={label}
        aria-pressed={open}
        title={label}
        onClick={() => {
          if (typeof sessionId !== "string" || sessionId === "") return;
          // 手动开/关都记成明确表态，窄列下也能强制展开。
          setRailChoice(sessionId, open ? "hidden" : "visible");
        }}
      >
        <TaskMonitorIcon size={16} />
      </button>
    );
  }

  const offSlot: any = installSlot(ctx, {
    name: "conversation.session.header.utilities",
    id: "dsh-toolkit-task-monitor",
    order: -3,
    locale: TASK_MONITOR_NS,
    label: () => t("trigger"),
  }, HeaderButton);
  return () => {
    offSlot?.();
  };
}
