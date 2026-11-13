import css from "./styles.css";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { settingsStyles } from "../../../client/styles/settings.js";
import { ARCH_NS, ARCH_COPY } from "./locale.js";
import { installArchivedSection } from "./section.jsx";
import { registerSettingsIcon } from "../../../client/settings-icon.jsx";
import { createRemoval, installRemoval } from "./removal.jsx";
import { installHiddenRows } from "./hidden-rows.js";
import { createArchiveConfirm, installArchiveConfirm } from "./archive-confirm.jsx";

export const inject = ["slots", "locale", "sessions", "workspaces"];

export function apply(ctx) {
  const removal = createRemoval(ctx);
  const archiveConfirm = createArchiveConfirm();
  // Global, not panel-local: the delete items and the confirm dialog render through
  // `sidebar.workspaces.session.menu.item` and `shell.overlay`, which the host portals
  // outside the settings panel subtree — a <style> inside the panel would not reach them.
  ctx.effect(() => installStylesheet(`${settingsStyles("sk")}\n${css}`, "toolkit-archived"), "toolkit-archived:stylesheet");
  ctx.effect(() => ctx.locale.register(ARCH_NS, ARCH_COPY), "toolkit-archived:dictionary");
  ctx.effect(() => installRemoval(ctx, removal), "toolkit-archived:removal");
  ctx.effect(() => installHiddenRows(removal), "toolkit-archived:hidden-rows");
  ctx.effect(() => installArchiveConfirm(ctx, archiveConfirm), "toolkit-archived:archive-confirm");
  ctx.effect(() => installArchivedSection(ctx, removal), "toolkit-archived:section");
  ctx.effect(() => registerSettingsIcon(ctx, "archived-chats", "archive"), "toolkit-archived:settings-icon");
}
