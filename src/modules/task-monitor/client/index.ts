import { installDictionary } from "../../../client/ui/locale.js";
import { composeStyles, installStylesheet } from "../../../client/ui/stylesheet.js";
import { TASK_MONITOR_COPY, TASK_MONITOR_NS } from "./locale.js";
import * as button from "./surfaces/header-button/index.jsx";
import * as tab from "./surfaces/sidebar-tab/index.jsx";
import dialogCss from "./surfaces/sidebar-tab/dialog.css";
import buttonCss from "./surfaces/header-button/style.css";

export const inject = ["slots", "locale", "sidebarRightTabs"];

export function apply(ctx: any) {
  installDictionary(ctx, TASK_MONITOR_NS, TASK_MONITOR_COPY);
  // 标题栏按钮挂在会话 header、添加来源的 Modal 被 portal 到面板子树外：这两份
  // 样式面板内 <style> 覆盖不到，必须全局注入；面板自身样式仍随组件 <style> 走。
  ctx.effect(() => installStylesheet(composeStyles(buttonCss, dialogCss), "dsh-toolkit-task-monitor"), "dsh-toolkit-task-monitor:stylesheet");
  ctx.effect(() => tab.install(ctx), `dsh-toolkit-task-monitor:${tab.NAME}`);
  // 会话开始自动把面板露出来一次；按钮随时可以再开/收。
  ctx.effect(() => tab.installAutoOpen(ctx), `dsh-toolkit-task-monitor:${tab.NAME}-auto-open`);
  ctx.effect(() => button.install(ctx), `dsh-toolkit-task-monitor:${button.NAME}`);
}
