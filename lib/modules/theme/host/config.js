import s from '@deepseek-ai/schemastery'

/** Codex keeps the shipped look; the two themed palettes add animated hero art. */
export const PALETTES = Object.freeze(['codex', 'ocean', 'hope'])

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
