import { installDictionary } from "../../../client/ui/locale.js";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { TASK_MONITOR_COPY, TASK_MONITOR_NS } from "./locale.js";
import * as sessionPanel from "./surfaces/session-panel/index.jsx";
import sessionPanelCss from "./surfaces/session-panel/style.css";

export const inject = ["slots", "locale"];

export function apply(ctx: any) {
  installDictionary(ctx, TASK_MONITOR_NS, TASK_MONITOR_COPY);
  // The host mounts the same panel in the dock or a separate overlay.
  ctx.effect(() => installStylesheet(sessionPanelCss, "dsh-toolkit-session-panel"), "dsh-toolkit-session-panel:stylesheet");
  ctx.effect(() => sessionPanel.install(ctx), `dsh-toolkit-session-panel:${sessionPanel.NAME}`);
}
