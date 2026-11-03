import css from "./styles.css";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { ARCH_NS, ARCH_COPY } from "./locale.js";
import { installArchivedSection } from "./section.jsx";

export const inject = ["slots", "locale", "sessions", "workspaces"];

export function apply(ctx) {
  ctx.effect(() => installStylesheet(css, "toolkit-archived"), "toolkit-archived:stylesheet");
  ctx.effect(() => ctx.locale.register(ARCH_NS, ARCH_COPY), "toolkit-archived:dictionary");
  ctx.effect(() => installArchivedSection(ctx), "toolkit-archived:section");
}
