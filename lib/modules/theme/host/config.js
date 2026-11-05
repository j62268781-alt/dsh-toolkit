import s from '@deepseek-ai/schemastery'

/** Independent style packs; the two scenic packs use the original DSH shell. */
export const PALETTES = Object.freeze(['native', 'codex', 'ocean', 'hope'])

export const Config = s.object({
  palette: s.union([...PALETTES]).default('codex').volatile(),
})

/** Read one live value; the Host keeps the entry alive for volatile leaves. */
export function readThemeConfig(config) {
  const field = config?.palette
  let palette
  try { palette = typeof field?.get === 'function' ? field.get() : field }
  catch { palette = undefined }
  return { palette: PALETTES.includes(palette) ? palette : 'codex' }
}
