import { installDictionary } from "../../../client/ui/locale.js";
import { composeStyles, installStylesheet } from "../../../client/ui/stylesheet.js";
import { MONITOR_COPY, MONITOR_NS } from "./locale.js";
import * as tab from "./surfaces/monitor-tab/index.jsx";
import * as trigger from "./surfaces/monitor-trigger/index.jsx";
import dialogCss from "./surfaces/monitor-tab/dialog.css";
import triggerCss from "./surfaces/monitor-trigger/style.css";

export const inject = ["slots", "locale", "sidebarRightTabs"];

export function apply(ctx: any) {
  installDictionary(ctx, MONITOR_NS, MONITOR_COPY);
  // 触发按钮挂在 composer、添加来源的 Modal 被 portal 到面板子树外：这两份样式
  // 面板内 <style> 覆盖不到，必须全局注入；面板自身样式仍随组件 <style> 走。
  ctx.effect(() => installStylesheet(composeStyles(triggerCss, dialogCss), "dsh-toolkit-monitor"), "dsh-toolkit-monitor:stylesheet");
  ctx.effect(() => tab.install(ctx), `dsh-toolkit-monitor:${tab.NAME}`);
  ctx.effect(() => trigger.install(ctx), `dsh-toolkit-monitor:${trigger.NAME}`);
}