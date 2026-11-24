/**
 * git 模块的装配层：读配置 → 注册内置工具、装 shell 守卫、生成提示词段，外加分支按钮的三条路由。
 *
 * 设置项由 DSH 的 configForms 写入 volatile 字段。工具、守卫和提示词在使用时读取当前值，
 * 不需要重启插件或重新注册。
 *
 * 路由是可选的：没有 Web 服务（终端里跑 agent）时提示词照旧生效，`ctx.inject` 只是让
 * 路由那条回调永远不触发。工具同理——`tools` 服务缺席时退化成「只有提示词」。
 */
import { registerJsonRoutes } from '../../../host/routes.js'
import { Config, readSettings, type GitSettings } from './config.js'
import { gitPromptText } from './prompt.js'
import { GIT_WORKTREE_CONFIG_PATH, NAME, PROMPT_ORDER, PROMPT_SECTION } from './constants.js'
import { createRepository } from './repository.js'
import { createGitRoutes } from './routes/branches.js'
import { registerWorktreeConfigRoutes } from './routes/worktree-config.js'
import { createGitPublishRoutes } from './routes/publish.js'
import { createPublishService } from './publish.js'
import { createGitTools } from './tools.js'
import { installGitGuard } from './guard.js'

export const name = NAME

/**
 * 唯一必需依赖：系统提示词服务。没有它就无可作为（不注册路由、不留空转的监听），
 * 所以直接声明成 inject 而不是在 `apply` 里 `ctx.inject` 里套一层。
 */
export const inject: string[] = ['systemPrompt']

export { Config }

export function apply(ctx: any, config: unknown = {}): void {
  // 工具、守卫、提示词共用同一个读取入口：三处各算一份「当前设置」迟早漂移。
  const settings = (): GitSettings => readSettings(config)

  // 工作区路由与提示词互不影响：先挂路由，再按需挂提示词段。
  const repository = createRepository()
  ctx.inject(['webServer', 'connection'], (routeCtx: any) => {
    registerJsonRoutes(routeCtx, [
      ...createGitRoutes({ repository }),
      ...createGitPublishRoutes(createPublishService()),
    ])
    registerWorktreeConfigRoutes(routeCtx, GIT_WORKTREE_CONFIG_PATH)
  })

  // 工具是可选依赖：没有 tools 服务的宿主里，提示词与路由照旧工作。
  ctx.inject(['tools'], (toolCtx: any) => {
    for (const tool of createGitTools({ settings })) {
      toolCtx.effect(() => toolCtx.tools.register(tool), `dsh-toolkit-git:tool:${tool.name}`)
    }
  })

  // 守卫无服务依赖，直接挂；它只在 shell 类工具、且开关打开时动手。
  installGitGuard(ctx, settings)

  // 宿主每次组装提示词都会调用 provider，并跳过空文本。
  ctx.effect(() => ctx.systemPrompt.section({
    name: PROMPT_SECTION,
    order: PROMPT_ORDER,
    // 提交说明是用户自由文本，可能带 `{{…}}`——宿主默认做严格插值，未知引用会直接抛错。
    interpolate: false,
    text: () => gitPromptText(settings()),
  }), `dsh-toolkit-git:${PROMPT_SECTION}`)
}

export default { name, inject, Config, apply }
