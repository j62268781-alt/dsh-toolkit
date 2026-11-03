/** One DSH client module; each existing UI keeps its own injection scope. */
import * as theme from '../modules/theme/client/index.js'
import * as archived from '../modules/archived/client/index.js'
import * as browser from '../modules/browser/client/index.jsx'
import * as judgment from '../modules/judgment/client/index.jsx'
import createMobile from '../modules/mobile/client/index.jsx'
import createSkillsMcp from '../modules/skills-mcp/client/client.js'

export const inject = []

export function apply(ctx) {
  ctx.plugin({ name: 'toolkit-theme-client', ...theme })
  ctx.plugin({ name: 'toolkit-archived-client', ...archived })
  ctx.plugin({ name: 'toolkit-skills-mcp-client', ...createSkillsMcp(require) })
  ctx.plugin({ name: 'toolkit-judgment-client', ...judgment })
  ctx.plugin({ name: 'toolkit-browser-client', ...browser })
  ctx.plugin({ name: 'toolkit-mobile-client', ...createMobile(require) })
}
