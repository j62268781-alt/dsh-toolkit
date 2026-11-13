import css from './settings.css'

/** Keep each panel's stylesheet independent, including when panels coexist. */
export function settingsStyles(namespace: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (_, selectors: string, declarations: string) => {
    const scoped = selectors.split(',').map((selector) => selector.trim())
      .filter((selector) => selector.startsWith(`.${namespace}-`))
    return scoped.length > 0 ? `${scoped.join(',')}{${declarations}}` : ''
  })
}
