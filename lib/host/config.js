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
  // 通知是纯客户端模块：没有 host 半，这个命名空间只服务于设置页的读写。
  // 每个可写字段都必须 .volatile()，否则设置页写不进去（见 modules/browser/host/config.ts 的注释）。
  // 字段刻意扁平（`completedSound` 而不是嵌套的 `types.completed.sound`）：schemastery 不允许
  // 把已含 volatile 叶子的对象再包一层 volatile，扁平叶子既合规又能一次写一个字段。
  notification: s.object({
    /** 通知总开关：关掉就既不弹系统通知也不响提示音。 */
    enabled: s.boolean().default(true).volatile(),
    /** 提示音开关。 */
    soundEnabled: s.boolean().default(true).volatile(),
    /** 提示音音量 0..1。 */
    volume: s.number().min(0).max(1).default(0.6).volatile(),
    /** 你正在读的会话何时也提醒。 */
    currentMode: s.union(['hidden', 'unfocused', 'always']).default('hidden').volatile(),
    /** 哪些会话提醒，以及主会话是否等子会话。 */
    scope: s.union(['all', 'main', 'main-wait']).default('main-wait').volatile(),
    completedEnabled: s.boolean().default(true).volatile(),
    completedSound: s.string().default('chime').volatile(),
    failedEnabled: s.boolean().default(true).volatile(),
    failedSound: s.string().default('fault').volatile(),
    questionEnabled: s.boolean().default(true).volatile(),
    questionSound: s.string().default('pop').volatile(),
    permissionEnabled: s.boolean().default(true).volatile(),
    permissionSound: s.string().default('alert').volatile(),
  }).default({}),
})
