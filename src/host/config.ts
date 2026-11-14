import s from '@deepseek-ai/schemastery'
import { Config as BrowserConfig } from '../modules/browser/host/config.js'
import { Config as JudgmentConfig } from '../modules/judgment/host/config.js'
import { Config as SkillsMcpConfig } from '../modules/skills-mcp/host/index.js'
import { Config as NotificationConfig } from '../modules/notification/host/config.js'
import { Config as PetConfig } from '../modules/pet/host/config.js'
import { Config as BootConfig } from '../modules/boot/host/config.js'
import { Config as ThemeConfig } from '../modules/theme/host/config.js'
import { Config as HooksConfig } from '../modules/hooks/host/config.js'
import { Config as RemoteConfig } from '../modules/remote/host/wechat/config.js'

// Compatibility schema for legacy composition tests and configuration migration.
// Module packages use these same module-owned definitions directly.
export const Config = s.object({
  shell: s.any().default({}),
  boot: BootConfig.default({}),
  theme: ThemeConfig.default({}),
  archived: s.any().default({}),
  browser: BrowserConfig.default({}),
  judgement: JudgmentConfig.default({}),
  mobile: s.any().default({}),
  skillsMcp: SkillsMcpConfig.default({}),
  notification: NotificationConfig.default({}),
  pet: PetConfig.default({}),
  hooks: HooksConfig.default({}),
  remote: RemoteConfig.default({}),
})
