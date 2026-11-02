/**
 * dsh-toolkit — 组合根（唯一的 cordis 插件行）
 *
 * ── 为什么要有这一层 ────────────────────────────────────────────────────
 *
 * DSH 的约束是「一个包 = 一份 dsh.bundle.patch + 一份 dsh.client」，所以合并
 * 多个插件之后，cordis 图里只能有**一个**插件行。子模块不能各占一行，只能由
 * 这里用 ctx.plugin() 依次挂载。
 *
 * 好处是子模块保留各自的 name / inject / Config，inject 不必合并成一个大列表：
 * cordis 会按每个子插件自己的声明解析依赖，缺服务的模块自然不启用，不会因为
 * 某一个模块的前置缺失而整体失败。
 *
 * ── 当前状态 ────────────────────────────────────────────────────────────
 *
 * 只挂了 modules/shell（皮肤 + 开机动画 + 会话删除通道）。其余 4 个模块的代码
 * 已搬入 modules/，但它们的运行时依赖（@deepseek-ai/cordis、dsh-tools、
 * dsh-typert-protocol、yaml 等）还没有在本仓库声明并安装，直接 import 会让整条
 * 插件加载失败，所以先不挂。接入顺序与依赖清单见 docs/ARCHITECTURE.md 的 P5。
 */

import shell from "./modules/shell/index.js";
import judgement from "./modules/judgement/lib/index.js";

/** 包名：改名时需与 package.json / cordis.patch.yml / profile 三处同步。 */
export const name = "dsh-shell-kit";

/** 组合根自身的注入：目前不需要任何服务（子插件的 inject 由 cordis 单独解析）。 */
export const inject = [];

/**
 * 挂载全部子模块。
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx cordis 上下文
 * @param {object} [config] 组合配置，按模块命名空间分组（config.shell 等）
 */
export function apply(ctx, config = {}) {
  ctx.plugin(shell, config.shell ?? {});
  // judgement 是 Service 类（默认导出），cordis 会按它自己的
  // static inject=['credentials'] 解析依赖。
  ctx.plugin(judgement, config.judgement ?? {});
}
