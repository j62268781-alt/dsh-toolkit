/**
 * composer 右座的「任务监控」触发按钮：28px 高、13px/500，与 git 分支按钮同一排规格。
 * 点击走宿主 sidebarRight.openTab(自己的 kind)；宿主没有右栏服务时给一句 toast，
 * 不装死按钮。样式在 composer（面板子树外），由 client/index.ts 全局注入。
 */
import React from "react";
import { installSlot } from "../../../../../client/ui/slot.js";
import { primitives } from "../../../../../client/ui/primitives.js";
import { toast } from "../../../../../client/ui/toast.js";
import { MONITOR_KIND } from "../../constants.js";
import { MONITOR_NS } from "../../locale.js";

export const NAME = "monitor-trigger";

export function install(ctx: any) {
  const t = ctx.locale.bind(MONITOR_NS);
  let open: ((kind: string) => void) | undefined;
  const offOpener = ctx.inject(["sidebarRight"], (scope: any) => {
    scope.effect(() => {
      open = (kind: string) => scope.sidebarRight.openTab(kind);
      return () => { open = undefined; };
    }, "dsh-toolkit-monitor:trigger-opener");
  });

  function Trigger() {
    const Icon = primitives.IconInspectOutlineRegular;
    return (
      <button
        type="button"
        className="sk-monitor-trigger"
        title={t("trigger")}
        onClick={() => {
          if (open === undefined) {
            toast.info(t("triggerUnsupported"));
            return;
          }
          try {
            open(MONITOR_KIND);
          } catch {
            toast.info(t("triggerUnsupported"));
          }
        }}
      >
        <span className="sk-monitor-trigger__icon" aria-hidden="true">{Icon === undefined ? null : <Icon size={14} />}</span>
        <span className="sk-monitor-trigger__label">{t("trigger")}</span>
      </button>
    );
  }

  const offSlot: any = installSlot(ctx, {
    name: "conversation.input.right",
    id: "dsh-toolkit-monitor",
    order: 100,
    locale: MONITOR_NS,
    label: () => t("trigger"),
  }, Trigger);
  return () => {
    offSlot?.();
    offOpener?.();
  };
}