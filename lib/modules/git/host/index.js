/**
 * git 模块的装配层：读配置 → 注册内置工具、装 shell 守卫、生成提示词段，外加分支按钮的三条路由。
 *
 * 设置项活在 DSH 的配置文档里，面板直接写它（见 `client/surfaces/settings`），宿主写配置后
 * 按 cordis 的语义重启本插件，`apply` 重新跑一遍就把新设置换上去了。所以这里**不要**
 * 再去监听配置变化。
 *
 * 路由是可选的：没有 Web 服务（终端里跑 agent）时提示词照旧生效，`ctx.inject` 只是让
 * 路由那条回调永远不触发。工具同理——`tools` 服务缺席时退化成「只有提示词」。
 */
import { registerJsonRoutes } from '../../../host/routes.js';
import { Config, readSettings } from './config.js';
import { gitPromptText } from './prompt.js';
import { NAME, PROMPT_ORDER, PROMPT_SECTION } from './constants.js';
import { createRepository } from './repository.js';
import { createGitRoutes } from './routes/branches.js';
import { createGitTools } from './tools.js';
import { installGitGuard } from './guard.js';
export const name = NAME;
/**
 * 唯一必需依赖：系统提示词服务。没有它就无可作为（不注册路由、不留空转的监听），
 * 所以直接声明成 inject 而不是在 `apply` 里 `ctx.inject` 里套一层。
 */
export const inject = ['systemPrompt'];
export { Config };
export function apply(ctx, config = {}) {
    // 工具、守卫、提示词共用同一个读取入口：三处各算一份「当前设置」迟早漂移。
    const settings = () => readSettings(config);
    // 分支按钮的路由与提示词互不影响：先挂路由，再按需挂提示词段。
    const repository = createRepository();
    ctx.inject(['webServer', 'connection'], (routeCtx) => {
        registerJsonRoutes(routeCtx, createGitRoutes({ repository }));
    });
    // 工具是可选依赖：没有 tools 服务的宿主里，提示词与路由照旧工作。
    ctx.inject(['tools'], (toolCtx) => {
        for (const tool of createGitTools({ settings })) {
            toolCtx.effect(() => toolCtx.tools.register(tool), `dsh-toolkit-git:tool:${tool.name}`);
        }
    });
    // 守卫无服务依赖，直接挂；它只在 shell 类工具、且开关打开时动手。
    installGitGuard(ctx, settings);
    const text = gitPromptText(settings());
    // 三项都没填时不留一个空段落：空段会在最终提示词里留下一个只有标题的空块。
    if (text === '')
        return;
    // 包一层 effect：宿主重启本插件（改配置就会重启）时，旧段落必须跟着注销，
    // 否则两次设置的文本会同时出现在提示词里。
    ctx.effect(() => ctx.systemPrompt.section({
        name: PROMPT_SECTION,
        order: PROMPT_ORDER,
        // 提交说明是用户自由文本，可能带 `{{…}}`——宿主默认做严格插值，未知引用会直接抛错。
        interpolate: false,
        text,
    }), `dsh-toolkit-git:${PROMPT_SECTION}`);
}
export default { name, inject, Config, apply };
//# sourceMappingURL=index.js.map