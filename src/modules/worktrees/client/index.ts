import { registerSettingsIcon } from "../../../client/ui/components/settings-icon/index.jsx";
import { installDictionary } from "../../../client/ui/locale.js";
import { installSettingsParts } from "../../../client/ui/components/settings-parts/install.js";
import { WORKTREES_COPY, WORKTREES_NS } from "./locale.js";
import { install } from "./surfaces/settings/index.jsx";

export const inject = ["slots", "locale", "configForms"];

export function apply(ctx: any): void {
  installDictionary(ctx, WORKTREES_NS, WORKTREES_COPY);
  ctx.effect(() => installSettingsParts(), "dsh-toolkit-worktrees:settings-parts");
  ctx.effect(() => install(ctx), "dsh-toolkit-worktrees:settings");
  ctx.effect(() => registerSettingsIcon(ctx, "worktrees", "worktrees"), "dsh-toolkit-worktrees:settings-icon");
}
