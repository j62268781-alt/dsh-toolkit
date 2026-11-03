import s from '@deepseek-ai/schemastery'
import { Config as BrowserConfig } from '../modules/browser/host/config.js'
import { Config as JudgmentConfig } from '../modules/judgment/host/config.js'
import { Config as SkillsMcpConfig } from '../modules/skills-mcp/host/index.js'

// Keep each module's existing volatile boundaries. Schemastery forbids wrapping
// a namespace that already contains volatile fields in another volatile field.
// Keep legacy shell config accepted; the three replacement modules own their config.
export const Config = s.object({
  shell: s.any().default({}),
  boot: s.any().default({}),
  theme: s.any().default({}),
  archived: s.any().default({}),
  browser: BrowserConfig.default({}),
  judgement: JudgmentConfig.default({}),
  mobile: s.any().default({}),
  skillsMcp: SkillsMcpConfig.default({}),
})
