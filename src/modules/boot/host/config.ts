import s from '@deepseek-ai/schemastery'

export const Config = s.object({
  animation: s.union(['draw', 'water', 'abyss']).default('draw').volatile(),
  theme: s.union(['auto', 'light', 'dark']).default('auto').volatile(),
  showWordmark: s.boolean().default(true).volatile(),
  allowSkip: s.boolean().default(true).volatile(),
})

export function readBootConfig(config: any) {
  const read = (key: string): any => {
    const field = config?.[key]
    try { return typeof field?.get === 'function' ? field.get() : field }
    catch { return undefined }
  }
  const animation = read('animation')
  const theme = read('theme')
  const showWordmark = read('showWordmark')
  const allowSkip = read('allowSkip')
  return {
    animation: ['draw', 'water', 'abyss'].includes(animation) ? animation : 'draw',
    theme: ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto',
    showWordmark: showWordmark !== false,
    allowSkip: allowSkip !== false,
  }
}
