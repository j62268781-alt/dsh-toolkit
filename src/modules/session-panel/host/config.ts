import s from '@deepseek-ai/schemastery'

/**
 * 任务监控配置：只有一个总开关。
 *
 * 关掉后 host 不再聚合工具事件（监听器直接放行），面板仍可读历史快照——
 * 「不记录」与「清空」是两件事，这里只做前者。
 */
export const Config = s.object({
  enabled: s.boolean().default(true),
})

export interface TaskMonitorSettings {
  enabled: boolean
}

/** 配置字段可能是 `{ get() }` 活动引用（volatile 字段），两种形状都要认。 */
function readField(config: any, key: string): any {
  const field = config?.[key]
  try {
    return typeof field?.get === 'function' ? field.get() : field
  } catch {
    return undefined
  }
}

/** 启动路径上不能抛错：坏字段退回默认值。 */
export function readSettings(config: any = {}): TaskMonitorSettings {
  const enabled = readField(config, 'enabled')
  return { enabled: typeof enabled === 'boolean' ? enabled : true }
}