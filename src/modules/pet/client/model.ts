export const CONFIG_NS = 'pet'

/**
 * 面板读到的配置形状（`readSettings()` 的返回类型）。
 * 与 host 侧 `PetSettings` 字段一致，但不能 import host 的文件，所以这里单独声明。
 */
export interface PetSettings {
  activePet: string
  petEnabled: boolean
  petSize: number
  bubbleWidth: number
  islandEnabled: boolean
  islandIdle: boolean
  islandAllDisplays: boolean
  islandWidth: number
  islandHeight: number
}

export const DEFAULT_SETTINGS = Object.freeze({ activePet: 'deepseek-whale', petEnabled: false, petSize: 100, bubbleWidth: 280, islandEnabled: false, islandIdle: true, islandAllDisplays: true, islandWidth: 100, islandHeight: 100 })
export const LIMITS = Object.freeze({ petSize: [50, 100, 10], bubbleWidth: [240, 480, 20], islandWidth: [75, 150, 1], islandHeight: [75, 150, 1] })
export function readSettings(snapshot): PetSettings {
  const value = snapshot?.value ?? snapshot ?? {}
  // 显式 `PetSettings`：`Object.freeze` 会把字面量收成 `'deepseek-whale'` 这类单值类型，
  // 不标注的话下面按 key 赋值（`activePet` 可能是任意字符串）全部报错。
  const result: PetSettings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'boolean' && typeof value[key] === 'boolean') result[key] = value[key]
    if (key === 'activePet' && typeof value[key] === 'string' && value[key]) result[key] = value[key]
    if (LIMITS[key] && typeof value[key] === 'number' && Number.isFinite(value[key])) {
      const [min, max, step] = LIMITS[key]
      result[key] = Math.min(max, Math.max(min, min + Math.round((value[key] - min) / step) * step))
    }
  }
  return result
}
export function formSnapshot(form) {
  try { return form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot } catch { return undefined }
}
