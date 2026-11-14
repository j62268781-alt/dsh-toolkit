import { installDictionary } from "../../../client/ui/locale.js";
import { registerSettingsIcon } from "../../../client/ui/components/settings-icon/index.jsx";
import { installSettingsParts } from "../../../client/ui/components/settings-parts/install.js";
import { HOOKS_COPY, HOOKS_NS } from "./locale.js";
import * as settings from "./surfaces/settings/index.jsx";

export const inject = ["slots", "locale"];

export function apply(ctx) {
  // 面板样式由组件自己的 <style> 携带（见 surfaces/settings/index.tsx）：这一页只活在
  // settings.section 的 React 子树里，没有 portal 到面板外的节点需要全局注入。
  installDictionary(ctx, HOOKS_NS, HOOKS_COPY);
  ctx.effect(() => installSettingsParts(), "dsh-toolkit-hooks:settings-parts");
  ctx.effect(() => settings.install(ctx), `dsh-toolkit-hooks:${settings.NAME}`);
  ctx.effect(() => registerSettingsIcon(ctx, "hooks", "hook"), "dsh-toolkit-hooks:settings-icon");
}
