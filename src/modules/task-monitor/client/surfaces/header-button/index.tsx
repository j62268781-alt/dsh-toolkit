/**
 * 会话标题行最右的「任务监控」开关：右栏是会话区右侧唯一的列，这个按钮只负责
 * 把它展开/收起（打开时再点一次收起），不再在 composer 里放第二个入口。
 *
 * 是否打开以宿主右栏的实时状态为准，不缓存：`active()` 认 tab 类型，`isExpanded()`
 * 认列状态，两者都在点击（commit 之后）读取，不会撞上 store 尚未 adopt 的窗口。
 * 面板挂载点在右栏，样式仍走 client/index.ts 的全局注入（按钮与 portal Modal
 * 都在面板子树外）。
 */
import React from "react";
import { installSlot } from "../../../../../client/ui/slot.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { toast } from "../../../../../client/ui/toast.js";
import { TASK_MONITOR_KIND } from "../../constants.js";
import { TASK_MONITOR_NS } from "../../locale.js";

export const NAME = "header-button";

export function install(ctx: any) {
  const t = ctx.locale.bind(TASK_MONITOR_NS);
  let sidebar: any;
  const offService = ctx.inject(["sidebarRight"], (scope: any) => {
    scope.effect(() => {
      sidebar = scope.sidebarRight;
      return () => { sidebar = undefined; };
    }, "dsh-toolkit-task-monitor:header-button-service");
  });

  function HeaderButton() {
    const Icon = primitives.IconInspectOutlineRegular;
    const label = t("trigger");
    return (
      <button
        type="button"
        className="sk-task-monitor-button"
        aria-label={label}
        title={label}
        onClick={() => {
          if (sidebar === undefined) {
            toast.info(t("triggerUnsupported"));
            return;
          }
          try {
            const active = sidebar.active();
            if (active?.kind === TASK_MONITOR_KIND && sidebar.isExpanded()) sidebar.toggleExpanded();
            else sidebar.openTab(TASK_MONITOR_KIND);
          } catch {
            toast.info(t("triggerUnsupported"));
          }
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
    offService?.();
  };
}
