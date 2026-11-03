import css from "./styles.css";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { settingsStyles } from "../../../client/styles/settings.js";
import { ARCH_NS, ARCH_COPY } from "./locale.js";
import { installArchivedSection } from "./section.jsx";
import { createRemoval, installRemoval } from "./removal.jsx";
import { createArchiveConfirm, installArchiveConfirm } from "./archive-confirm.jsx";

export const inject = ["slots", "locale", "sessions", "workspaces"];

export function apply(ctx) {
  const removal = createRemoval(ctx);
  const archiveConfirm = createArchiveConfirm();
  ctx.effect(() => installStylesheet(`${settingsStyles("sk")}\n${css}`, "toolkit-archived"), "toolkit-archived:stylesheet");
  ctx.effect(() => ctx.locale.register(ARCH_NS, ARCH_COPY), "toolkit-archived:dictionary");
  ctx.effect(() => installRemoval(ctx, removal), "toolkit-archived:removal");
  ctx.effect(() => installArchiveConfirm(ctx, archiveConfirm), "toolkit-archived:archive-confirm");
  ctx.effect(() => installArchivedSection(ctx, removal), "toolkit-archived:section");
}
