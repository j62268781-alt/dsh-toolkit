import * as boot from './modules/boot/host/index.js'
import * as archived from './modules/archived/host/index.js'
import * as git from './modules/git/host/index.js'
import * as hooks from './modules/hooks/host/index.js'
import JudgmentService from './modules/judgment/host/index.js'
import * as mobile from './modules/mobile/host/index.js'
import * as notification from './modules/notification/host/index.js'
import * as pet from './modules/pet/host/index.js'
import * as skillsMcp from './modules/skills-mcp/host/index.js'
import * as remote from './modules/remote/host/index.js'
import { Config } from './host/config.js'
import { configuredPlugin, configuredService } from './host/plugins.js'

export { Config }
export const name = 'dsh-toolkit'
export const inject: string[] = []

const Judgment = configuredService(JudgmentService as any)
const SkillsMcp = configuredPlugin(skillsMcp)
const Boot = configuredPlugin(boot)

export function apply(ctx: any, config: any): void {
  // Each child retains its own inject requirements; one unavailable service
  // must not stop unrelated panels and tools from loading.
  ctx.plugin(Boot, config.boot)
  ctx.plugin(archived, config.archived)
  ctx.plugin(Judgment, config.judgement)
  ctx.plugin(mobile, config.mobile)
  ctx.plugin(notification, config.notification)
  ctx.plugin(SkillsMcp, config.skillsMcp)
  ctx.plugin(pet, config.pet)
  ctx.plugin(configuredPlugin(hooks), config.hooks)
  ctx.plugin(configuredPlugin(remote), config.remote)
  // 追加在最后：既有子插件的下标保持不变（集成测试按 children[i] 断言）。
  ctx.plugin(configuredPlugin(git), config.git)
}

export default { name, inject, Config, apply }
