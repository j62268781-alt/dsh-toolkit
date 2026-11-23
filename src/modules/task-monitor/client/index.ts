import { installDictionary } from "../../../client/ui/locale.js";
import { composeStyles, installStylesheet } from "../../../client/ui/stylesheet.js";
import { TASK_MONITOR_COPY, TASK_MONITOR_NS } from "./locale.js";
import * as button from "./surfaces/header-button/index.jsx";
import * as rail from "./surfaces/conversation-rail/index.jsx";
import * as sessionPanel from "./surfaces/session-panel/index.jsx";
import { createStore, useStore } from "../../../client/ui/store.js";
import buttonCss from "./surfaces/header-button/style.css";
import publishCss from "../../git/client/components/publish/style.css";
import sessionPanelCss from "./surfaces/session-panel/style.css";

export const inject = ["slots", "locale"];

export function apply(ctx: any) {
  installDictionary(ctx, TASK_MONITOR_NS, TASK_MONITOR_COPY);
  // 宿主分别挂载标题栏按钮、发布确认弹层和官方会话侧栏，样式不能只放在旧面板子树内。
  ctx.effect(() => installStylesheet(composeStyles(buttonCss, publishCss, sessionPanelCss), "dsh-toolkit-task-monitor"), "dsh-toolkit-task-monitor:stylesheet");
  const panel = createStore({ available: false });
  const useOfficialPanel = () => useStore(panel).available;
  ctx.effect(() => sessionPanel.install(ctx, (available) => panel.set({ available })), `dsh-toolkit-task-monitor:${sessionPanel.NAME}`);
  ctx.effect(() => rail.install(ctx, useOfficialPanel), `dsh-toolkit-task-monitor:${rail.NAME}`);
  ctx.effect(() => button.install(ctx, useOfficialPanel), `dsh-toolkit-task-monitor:${button.NAME}`);
}
