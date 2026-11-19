import { installDictionary } from "../../../client/ui/locale.js";
import { composeStyles, installStylesheet } from "../../../client/ui/stylesheet.js";
import { TASK_MONITOR_COPY, TASK_MONITOR_NS } from "./locale.js";
import * as button from "./surfaces/header-button/index.jsx";
import * as rail from "./surfaces/conversation-rail/index.jsx";
import dialogCss from "./components/panel/dialog.css";
import buttonCss from "./surfaces/header-button/style.css";

export const inject = ["slots", "locale"];

export function apply(ctx: any) {
  installDictionary(ctx, TASK_MONITOR_NS, TASK_MONITOR_COPY);
  // 标题栏按钮与「添加来源」Modal 都在面板子树外，样式必须全局注入；
  // 面板与分栏自身的样式随组件 <style> 走。
  ctx.effect(() => installStylesheet(composeStyles(buttonCss, dialogCss), "dsh-toolkit-task-monitor"), "dsh-toolkit-task-monitor:stylesheet");
  ctx.effect(() => rail.install(ctx), `dsh-toolkit-task-monitor:${rail.NAME}`);
  ctx.effect(() => button.install(ctx), `dsh-toolkit-task-monitor:${button.NAME}`);
}
