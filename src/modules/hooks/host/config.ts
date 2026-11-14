import s from '@deepseek-ai/schemastery'
import { DEFAULT_HOOK_TIMEOUT_MS, MAX_HISTORY_ENTRIES } from './constants.js'

/**
 * Hooks 模块配置。
 *
 * 真正的钩子内容在 `hooks.json` 里（那是用户要手写、要和 Claude Code 共用的文件），
 * 这里只放「文件在哪、跑不跑、超时多少」这类宿主侧参数。
 */
export const Config = s.object({
  enabled: s.boolean().default(true),
  /** 用户级钩子文件；留空表示 `$DSH_HOME/hooks.json`。相对路径按项目目录解析。 */
  userFile: s.string().default(''),
  /** 项目级 `<项目>/.dsh/hooks.json` 与 `hooks.local.json` 是否参与合并。 */
  includeProject: s.boolean().default(true),
  /** 项目目录；留空表示宿主进程的启动目录。 */
  projectDir: s.string().default(''),
  /** 单条 hook 未写 `timeout` 时的超时（毫秒）。 */
  defaultTimeoutMs: s.number().min(1_000).max(600_000).default(DEFAULT_HOOK_TIMEOUT_MS),
  /** 「最近执行」保留多少条。 */
  maxHistory: s.number().min(0).max(500).default(MAX_HISTORY_ENTRIES),
})

export interface HooksSettings {
  enabled: boolean
  userFile: string
  includeProject: boolean
  projectDir: string
  defaultTimeoutMs: number
  maxHistory: number
}

/** 配置字段可能是 `{ get() }`（宿主把 volatile 字段做成活动引用），取值时要兼容两种形状。 */
function readField(config: any, key: string): any {
  const field = config?.[key]
  try {
    return typeof field?.get === 'function' ? field.get() : field
  } catch {
    return undefined
  }
}

function readBool(config: any, key: string, fallback: boolean): boolean {
  const value = readField(config, key)
  return typeof value === 'boolean' ? value : fallback
}

function readText(config: any, key: string): string {
  const value = readField(config, key)
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(config: any, key: string, fallback: number, min: number, max: number): number {
  const value = readField(config, key)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function readSettings(config: any = {}): HooksSettings {
  return {
    enabled: readBool(config, 'enabled', true),
    userFile: readText(config, 'userFile'),
    includeProject: readBool(config, 'includeProject', true),
    projectDir: readText(config, 'projectDir'),
    defaultTimeoutMs: readNumber(config, 'defaultTimeoutMs', DEFAULT_HOOK_TIMEOUT_MS, 1_000, 600_000),
    maxHistory: readNumber(config, 'maxHistory', MAX_HISTORY_ENTRIES, 0, 500),
  }
}
