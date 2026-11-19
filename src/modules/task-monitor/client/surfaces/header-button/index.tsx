/**
 * 会话标题行最右的「任务监控」开关：控制会话内容区右栏的显隐。
 *
 * 面板本身挂在 conversation.hero.frame（见 surfaces/conversation-rail），这里只
 * 写显隐状态；状态按会话记在 localStorage 里，收起后刷新仍收起，换会话默认再打开。
 */
import React from "react";
import { installSlot } from "../../../../../client/ui/slot.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { TASK_MONITOR_NS } from "../../locale.js";
import { setRailHidden, useRailHidden, useRailNarrow } from "../../state/rail.js";

export const NAME = "header-button";

export function install(ctx: any) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);

  function HeaderButton(props: any) {
    const sessionId: string | undefined = props.sessionId;
    const hidden = useRailHidden(sessionId);
    const narrow = useRailNarrow();
    const open = !hidden && !narrow && typeof sessionId === "string" && sessionId !== "";
    const label = t("trigger");
    const Icon = primitives.IconInspectOutlineRegular;
    // 对话列窄到放不下卡片时整栏已经自动退场，按钮留着只会「按了没反应」。
    if (narrow) return null;
    return (
      <button
        type="button"
        className="sk-task-monitor-button"
        aria-label={label}
        aria-pressed={open}
        title={label}
        onClick={() => {
          if (typeof sessionId !== "string" || sessionId === "") return;
          setRailHidden(sessionId, !hidden);
        }}
      >
        {Icon === undefined ? null : <Icon size={16} />}
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
