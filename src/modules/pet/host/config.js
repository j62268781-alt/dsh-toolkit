import s from '@deepseek-ai/schemastery'

export const Config = s.object({
  activePet: s.string().default('qoduck-lab').volatile(),
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

export function readSettings(config = {}) {
  const number = (key, fallback, min, max) => Number.isFinite(config[key]) ? Math.min(max, Math.max(min, config[key])) : fallback
  return {
    activePet: typeof config.activePet === 'string' ? config.activePet : 'qoduck-lab',
    petEnabled: config.petEnabled === true,
    petSize: number('petSize', 100, 50, 100),
    bubbleWidth: number('bubbleWidth', 280, 240, 480),
    islandEnabled: config.islandEnabled === true,
    islandIdle: config.islandIdle !== false,
    islandAllDisplays: config.islandAllDisplays !== false,
    islandWidth: number('islandWidth', 100, 75, 150),
    islandHeight: number('islandHeight', 100, 75, 150),
  }
}
