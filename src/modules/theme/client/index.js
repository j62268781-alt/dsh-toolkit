import css from "./styles.css";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { installDesktopMarker } from "./platform.js";
import { installRailTitles, installHomeRail } from "./rail.js";
import { installBandHeight } from "./band.js";
import { installSidebarWidth, installWorkspaceCollapse } from "./sidebar.js";

export const inject = ["layout"];

export function apply(ctx) {
  ctx.effect(installDesktopMarker, "toolkit-theme:desktop-marker");
  ctx.effect(() => installStylesheet(css, "toolkit-theme"), "toolkit-theme:stylesheet");
  ctx.effect(installRailTitles, "toolkit-theme:rail-titles");
  ctx.effect(() => installHomeRail(ctx), "toolkit-theme:home-rail");
  ctx.effect(installBandHeight, "toolkit-theme:band-height");
  ctx.effect(() => installSidebarWidth(ctx), "toolkit-theme:sidebar-width");
  ctx.effect(() => installWorkspaceCollapse(ctx), "toolkit-theme:workspace-collapse");
}
