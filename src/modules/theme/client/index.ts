import css from "./styles.css";
import "./react.js";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { findScopedForm } from "../../../client/config.js";
import { installShellMarkers } from "./platform.js";
import { installRailTitles, installHomeRail } from "./rail.js";
import { installRailUnpin } from "./rail-unpin.js";
import { installBandHeight } from "./band.js";
import { installSidebarWidth, installWorkspaceCollapse } from "./sidebar.js";
import { installUpdateTile } from "./update-tile.js";
import { installCodexShell } from "./shell.js";
import { installSettingsNav } from "./settings-nav.js";
import { installPalette, installSceneClock, registerPaletteScene } from "./palette.js";
import { createOceanScene } from "./scenes/ocean.js";
import { createHopeScene, updateHopeSceneTime } from "./scenes/hope.js";
import { ThemeCenterPanel } from "./settings-theme.jsx";
import { installSettingsParts } from "../../../client/ui/components/settings-parts/install.js";
import { registerSettingsIcon } from "../../../client/ui/components/settings-icon/index.jsx";

export const inject = ["layout", "slots", "locale", "configForms", "theme"];

function registerScenes() {
  const disposers = [
    registerPaletteScene("ocean", createOceanScene),
    registerPaletteScene("hope", createHopeScene),
  ];
  return () => disposers.reverse().forEach(dispose => dispose());
}

/** Settings section: native Light/Dark/System cards plus the themed palettes. */
function installThemeCenter(ctx) {
  const dispose = ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "theme",
        order: 5,
        label: () => "外观",
        inject: () => {
          const { form, entryId } = findScopedForm(ctx, "theme");
          return {
            form,
            entryId,
            theme: ctx.theme,
            subscribeTheme: (listener) => ctx.on("theme/change", listener),
          };
        },
      },
      ThemeCenterPanel,
    ),
  );
  return dispose;
}

export function apply(ctx) {
  ctx.effect(registerScenes, "dsh-toolkit-theme:scene-builders");
  ctx.effect(() => installSceneClock(updateHopeSceneTime), "dsh-toolkit-theme:scene-clock");
  ctx.effect(installShellMarkers, "dsh-toolkit-theme:shell-markers");
  // Global by definition: the palette rewrites the host shell itself (sidebar, right bar,
  // settings chrome) through `[class*="_xxx"]` host-hash selectors, so no panel subtree owns it.
  ctx.effect(() => installStylesheet(css, "dsh-toolkit-theme"), "dsh-toolkit-theme:stylesheet");
  // 页头/卡片/行是九个设置面板共用的骨架，共享样式在 client 根只插一次。
  ctx.effect(() => installSettingsParts(), "dsh-toolkit-theme:settings-parts");
  ctx.effect(() => installPalette(ctx), "dsh-toolkit-theme:palette");
  ctx.effect(() => installCodexShell(ctx, [
    installRailTitles,
    installRailUnpin,
    installHomeRail,
    installBandHeight,
    installSidebarWidth,
    installWorkspaceCollapse,
    installUpdateTile,
  ], { nativeInstallers: [(ctx) => installSidebarWidth(ctx, { native: true })] }), "dsh-toolkit-theme:codex-shell");
  ctx.effect(() => installSettingsNav(ctx), "dsh-toolkit-theme:settings-nav");
  ctx.effect(() => registerSettingsIcon(ctx, "theme", "palette"), "dsh-toolkit-theme:settings-icon");
  ctx.effect(() => installThemeCenter(ctx), "dsh-toolkit-theme:settings-section");
}
