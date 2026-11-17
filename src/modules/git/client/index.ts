import { installDictionary } from "../../../client/ui/locale.js";
import { installStylesheet } from "../../../client/ui/stylesheet.js";
import { registerSettingsIcon } from "../../../client/ui/components/settings-icon/index.jsx";
import { installSettingsParts } from "../../../client/ui/components/settings-parts/install.js";
import { GIT_COPY, GIT_NS } from "./locale.js";
import * as settings from "./surfaces/settings/index.jsx";
import * as branch from "./surfaces/branch-chip/index.jsx";

export const inject = ["slots", "locale", "configForms"];

export function apply(ctx) {
  // 设置面板的样式由组件自己的 <style> 携带（这一页只活在 settings.section 的 React 子树里）；
  // 分支弹层不一样：它被 portal 到 document.body（composer 会裁切溢出内容），所以必须全局注入。
  installDictionary(ctx, GIT_NS, GIT_COPY);
  // 页头/卡片/行的骨架样式是各面板共用的，安装一次即幂等。
  ctx.effect(() => installSettingsParts(), "dsh-toolkit-git:settings-parts");
  ctx.effect(() => installStylesheet(branch.CSS, "dsh-toolkit-git:branch-chip"), "dsh-toolkit-git:branch-chip-styles");
  ctx.effect(() => settings.install(ctx), `dsh-toolkit-git:${settings.NAME}`);
  ctx.effect(() => branch.install(ctx), `dsh-toolkit-git:${branch.NAME}`);
  // 新会话页顶栏与 composer 底栏互斥（同一个组件、两处注册，按 session.blank 取舍）。
  ctx.effect(() => branch.installHero(ctx), `dsh-toolkit-git:${branch.NAME}:hero`);
  ctx.effect(() => registerSettingsIcon(ctx, "git", "git"), "dsh-toolkit-git:settings-icon");
}
