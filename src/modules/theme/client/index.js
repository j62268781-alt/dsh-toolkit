import css from "./styles.css";
import "./react.js";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { findScopedForm } from "../../../client/config.js";
import { installDesktopMarker } from "./platform.js";
import { installRailTitles, installHomeRail } from "./rail.js";
import { installBandHeight } from "./band.js";
import { installSidebarWidth, installWorkspaceCollapse } from "./sidebar.js";
import { installSettingsNav } from "./settings-nav.js";
import { installPalette, registerPaletteScene } from "./palette.js";
import { createOceanScene } from "./scenes/ocean.js";
import { createHopeScene } from "./scenes/hope.js";
import { ThemeCenterPanel } from "./settings-theme.jsx";

export const inject = ["layout", "slots", "locale", "configForms", "theme"];

function registerScenes() {
  registerPaletteScene("ocean", createOceanScene);
  registerPaletteScene("hope", createHopeScene);
}

/** Settings section: native Light/Dark/System cards plus the themed palettes. */
function installThemeCenter(ctx) {
  registerScenes();
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
  ctx.effect(installDesktopMarker, "toolkit-theme:desktop-marker");
  ctx.effect(() => installStylesheet(css, "toolkit-theme"), "toolkit-theme:stylesheet");
  ctx.effect(installRailTitles, "toolkit-theme:rail-titles");
  ctx.effect(() => installHomeRail(ctx), "toolkit-theme:home-rail");
  ctx.effect(installBandHeight, "toolkit-theme:band-height");
  ctx.effect(() => installSidebarWidth(ctx), "toolkit-theme:sidebar-width");
  ctx.effect(() => installWorkspaceCollapse(ctx), "toolkit-theme:workspace-collapse");
  ctx.effect(() => installSettingsNav(ctx), "toolkit-theme:settings-nav");
  ctx.effect(() => installPalette(ctx), "toolkit-theme:palette");
  ctx.effect(() => installThemeCenter(ctx), "toolkit-theme:settings-section");
}
