/**
 * Join the CSS a module owns into the one sheet the shell gets.
 *
 * A module now keeps one stylesheet per surface and per component; the host still
 * receives a single <style> per plugin, so the parts are joined here instead of
 * every `apply` building the same template literal again.
 */
export function composeStyles(...parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join('\n')
}

/** Install plugin-owned CSS and return the matching teardown. */
export function installStylesheet(css: string, id: string): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.dataset.pluginCss = `${id}/styles.css`
  tag.textContent = css
  ;(document.head ?? document.documentElement).appendChild(tag)
  return () => tag.remove()
}

/** A stylesheet whose text is rewritten while the page runs. */
export interface MutableStylesheet {
  set(css: string): void
  dispose(): void
}

/**
 * Install plugin-owned CSS whose rules are rewritten while the page runs.
 *
 * `installStylesheet` writes once; a rule set derived from changing data (which
 * rows are hidden, which scope is active) has to keep one <style> element and
 * replace its text instead of appending a tag per change.
 */
export function installMutableStylesheet(id: string): MutableStylesheet {
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.dataset.pluginCss = `${id}/runtime.css`
  ;(document.head ?? document.documentElement).appendChild(tag)
  return {
    set(css) {
      if (tag.textContent !== css) tag.textContent = css
    },
    dispose() {
      tag.remove()
    },
  }
}
