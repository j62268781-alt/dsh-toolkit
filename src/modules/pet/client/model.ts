export const CONFIG_NS = 'pet'
export const DEFAULT_SETTINGS = Object.freeze({ activePet: 'deepseek-whale', petEnabled: false, petSize: 100, bubbleWidth: 280, islandEnabled: false, islandIdle: true, islandAllDisplays: true, islandWidth: 100, islandHeight: 100 })
export const LIMITS = Object.freeze({ petSize: [50, 100, 10], bubbleWidth: [240, 480, 20], islandWidth: [75, 150, 1], islandHeight: [75, 150, 1] })
export function readSettings(snapshot) {
  const value = snapshot?.value ?? snapshot ?? {}
  const result = { ...DEFAULT_SETTINGS }
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
