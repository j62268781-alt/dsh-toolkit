import * as boot from './modules/boot/host/index.js'
import * as archived from './modules/archived/host/index.js'
import AgentBrowserService from './modules/browser/host/index.js'
import JudgmentService from './modules/judgment/host/index.js'
import * as mobile from './modules/mobile/host/index.js'
import * as skillsMcp from './modules/skills-mcp/host/index.js'
import * as usage from './modules/usage/host/index.js'
import { Config } from './host/config.js'
import { configuredPlugin, configuredService } from './host/plugins.js'

export { Config }
export const name = 'dsh-toolkit'
export const inject = []

const Browser = configuredService(AgentBrowserService)
const Judgment = configuredService(JudgmentService)
const SkillsMcp = configuredPlugin(skillsMcp)
// The root Config already validated `usage`; without this wrapper the child
// plugin re-validates the parent's resolved (volatile-wrapped) values and
// refuses to mount, so its route never registers.
const Usage = configuredPlugin(usage)

export function apply(ctx, config) {
  // Each child retains its own inject requirements; one unavailable service
  // must not stop unrelated panels and tools from loading.
  ctx.plugin(boot, config.boot)
  ctx.plugin(archived, config.archived)
  ctx.plugin(Judgment, config.judgement)
  ctx.plugin(mobile, config.mobile)
  ctx.plugin(Browser, config.browser)
  ctx.plugin(SkillsMcp, config.skillsMcp)
  ctx.plugin(Usage, config.usage)
}

export default { name, inject, Config, apply }
