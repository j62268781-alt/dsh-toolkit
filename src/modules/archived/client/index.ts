import { composeStyles, installStylesheet } from "../../../client/ui/stylesheet.js";
import { settingsStyles } from "../../../client/styles/settings.js";
import { installDictionary } from "../../../client/ui/locale.js";
import { registerSettingsIcon } from "../../../client/ui/components/settings-icon/index.jsx";
import { ARCH_COPY, ARCH_NS } from "./locale.js";
import { createRemoval } from "./state/removal.js";
import { createArchiveConfirm } from "./state/archive-confirm.js";
import { installHiddenRows } from "./dom/hidden-rows.js";
import { css as deleteButtonCss } from "./components/delete-button/index.jsx";
import * as archiveConfirm from "./surfaces/archive-confirm/index.jsx";
import * as deleteConfirm from "./surfaces/delete-confirm/index.jsx";
import * as sessionMenu from "./surfaces/session-menu/index.jsx";
import * as settings from "./surfaces/settings/index.jsx";

export const inject = ["slots", "locale", "sessions", "workspaces"];

/** Every surface this module mounts, in install order. */
const SURFACES = [settings, sessionMenu, deleteConfirm, archiveConfirm];

export function apply(ctx) {
  const host = { removal: createRemoval(ctx), archiveConfirm: createArchiveConfirm() };

  // Global, not per-component: the row menu entry and both overlays are portaled by the
  // host outside the settings panel subtree (`shell.overlay`, `....menu.item`), so
  // neither React unmount nor an ancestor-scoped <style> would ever reach them.
  ctx.effect(() => installStylesheet(
    composeStyles(settingsStyles("sk"), settings.css, deleteButtonCss),
    "dsh-toolkit-archived",
  ), "dsh-toolkit-archived:stylesheet");

  installDictionary(ctx, ARCH_NS, ARCH_COPY);
  ctx.effect(() => installHiddenRows(host.removal), "dsh-toolkit-archived:hidden-rows");
  for (const surface of SURFACES) {
    ctx.effect(() => surface.install(ctx, host), `dsh-toolkit-archived:${surface.NAME}`);
  }
  ctx.effect(() => registerSettingsIcon(ctx, "archived-chats", "archive"), "dsh-toolkit-archived:settings-icon");
}
