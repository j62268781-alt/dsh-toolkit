/** One DSH client module; each existing UI keeps its own injection scope. */
import * as theme from '../modules/theme/client/index.js'
import * as archived from '../modules/archived/client/index.js'
import * as browser from '../modules/browser/client/index.jsx'
import * as judgment from '../modules/judgment/client/index.jsx'
import createMobile from '../modules/mobile/client/index.jsx'
import createSkillsMcp from '../modules/skills-mcp/client/client.js'
import createNotification from '../modules/notification/client/index.jsx'
import createPet from '../modules/pet/client/index.jsx'
import createRemote from '../modules/remote/client/index.jsx'
import * as boot from '../modules/boot/client/index.jsx'

export const inject: readonly string[] = []

export function apply(ctx: any): void {
  ctx.plugin({ name: 'dsh-toolkit-theme-client', ...theme })
  ctx.plugin({ name: 'dsh-toolkit-archived-client', ...archived })
  ctx.plugin({ name: 'dsh-toolkit-skills-mcp-client', ...createSkillsMcp(require) })
  ctx.plugin({ name: 'dsh-toolkit-judgment-client', ...judgment })
  ctx.plugin({ name: 'dsh-toolkit-browser-client', ...browser })
  ctx.plugin({ name: 'dsh-toolkit-mobile-client', ...createMobile(require) })
  // 追加在最后：既有子插件的下标与顺序保持不变（集成测试按 children[i] 断言）。
  ctx.plugin({ name: 'dsh-toolkit-notification-client', ...createNotification(require) })
  ctx.plugin({ name: 'dsh-toolkit-boot-client', ...boot })
  ctx.plugin({ name: 'dsh-toolkit-pet-client', ...createPet(require) })
  ctx.plugin({ name: 'dsh-toolkit-remote-client', ...createRemote(require) })
}
