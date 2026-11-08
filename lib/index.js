import * as boot from './modules/boot/host/index.js'
import * as archived from './modules/archived/host/index.js'
import AgentBrowserService from './modules/browser/host/index.js'
import JudgmentService from './modules/judgment/host/index.js'
import * as mobile from './modules/mobile/host/index.js'
import * as notification from './modules/notification/host/index.js'
import * as pet from './modules/pet/host/index.js'
import * as skillsMcp from './modules/skills-mcp/host/index.js'
import * as weixinClawbot from './modules/weixin-clawbot/host/index.js'
import { Config } from './host/config.js'
import { configuredPlugin, configuredService } from './host/plugins.js'

export { Config }
export const name = 'dsh-toolkit'
export const inject = []

const Browser = configuredService(AgentBrowserService)
const Judgment = configuredService(JudgmentService)
const SkillsMcp = configuredPlugin(skillsMcp)
const Boot = configuredPlugin(boot)

export function apply(ctx, config) {
  // Each child retains its own inject requirements; one unavailable service
  // must not stop unrelated panels and tools from loading.
  ctx.plugin(Boot, config.boot)
  ctx.plugin(archived, config.archived)
  ctx.plugin(Judgment, config.judgement)
  ctx.plugin(mobile, config.mobile)
  ctx.plugin(Browser, config.browser)
  ctx.plugin(notification, config.notification)
  ctx.plugin(SkillsMcp, config.skillsMcp)
  ctx.plugin(pet, config.pet)
  ctx.plugin(configuredPlugin(weixinClawbot), config.weixinClawbot)
}

export default { name, inject, Config, apply }
