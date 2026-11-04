import s from '@deepseek-ai/schemastery'

export const Config = s.object({
  animation: s.union(['draw', 'water', 'abyss']).default('draw').volatile(),
  durationMs: s.number().min(1700).max(8000).default(2400).volatile(),
  theme: s.union(['auto', 'light', 'dark']).default('auto').volatile(),
  showWordmark: s.boolean().default(true).volatile(),
  allowSkip: s.boolean().default(true).volatile(),
})

export function readBootConfig(config) {
  const read = (key) => {
    const field = config?.[key]
    try { return typeof field?.get === 'function' ? field.get() : field }
    catch { return undefined }
  }
  const animation = read('animation')
  const durationMs = read('durationMs')
  const theme = read('theme')
  const showWordmark = read('showWordmark')
  const allowSkip = read('allowSkip')
  return {
    animation: ['draw', 'water', 'abyss'].includes(animation) ? animation : 'draw',
    durationMs: Number.isFinite(durationMs) ? Math.min(8000, Math.max(1700, durationMs)) : 2400,
    theme: ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto',
    showWordmark: showWordmark !== false,
    allowSkip: allowSkip !== false,
  }
}
