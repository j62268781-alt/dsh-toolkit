import s from '@deepseek-ai/schemastery'

export const Config = s.object({
  activePet: s.string().default('deepseek-whale').volatile(),
  petEnabled: s.boolean().default(false).volatile(),
  petSize: s.number().min(50).max(100).default(100).volatile(),
  bubbleWidth: s.number().min(240).max(480).default(280).volatile(),
  islandEnabled: s.boolean().default(false).volatile(),
  islandIdle: s.boolean().default(true).volatile(),
  islandAllDisplays: s.boolean().default(true).volatile(),
  islandWidth: s.number().min(75).max(150).default(100).volatile(),
  islandHeight: s.number().min(75).max(150).default(100).volatile(),
  electronPath: s.string().default('').volatile(),
})

/**
 * 读一个配置字段。
 *
 * 当前宿主把 `.volatile()` 字段作为「活动引用」对象（`{ get() }`）交给 `apply()`，
 * 而不是普通值：设置面板改写时宿主原地更新引用里的值，插件必须用的时候再取值。
 * 直接当普通值用会拿到 `{}` —— 例如 `path.isAbsolute(config.electronPath)` 会抛
 * `The "path" argument must be of type string. Received an instance of Object`。
 * `boot` / `remote` 两个模块的 `readConfig` 用的是同一套写法。
 */
export function readField(config, key) {
  const field = config?.[key]
  try { return typeof field?.get === 'function' ? field.get() : field } catch { return undefined }
}

/** 显式指定的桌面运行时二进制路径；空字符串表示按缓存/下载解析。 */
export function readElectronPath(config) {
  const value = readField(config, 'electronPath')
  return typeof value === 'string' ? value.trim() : ''
}

export function readSettings(config = {}) {
  const number = (key, fallback, min, max) => {
    const value = readField(config, key)
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  }
  const text = (key, fallback) => {
    const value = readField(config, key)
    return typeof value === 'string' && value !== '' ? value : fallback
  }
  const bool = (key, fallback) => {
    const value = readField(config, key)
    return typeof value === 'boolean' ? value : fallback
  }
  return {
    activePet: text('activePet', 'deepseek-whale'),
    petEnabled: bool('petEnabled', false),
    petSize: number('petSize', 100, 50, 100),
    bubbleWidth: number('bubbleWidth', 280, 240, 480),
    islandEnabled: bool('islandEnabled', false),
    islandIdle: bool('islandIdle', true),
    islandAllDisplays: bool('islandAllDisplays', true),
    islandWidth: number('islandWidth', 100, 75, 150),
    islandHeight: number('islandHeight', 100, 75, 150),
  }
}
