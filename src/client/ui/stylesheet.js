/** Install plugin-owned CSS and return the matching teardown. */
export function installStylesheet(css, id) {
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.dataset.pluginCss = `${id}/styles.css`
  tag.textContent = css
  ;(document.head ?? document.documentElement).appendChild(tag)
  return () => tag.remove()
}

/**
 * Install plugin-owned CSS whose rules are rewritten while the page runs.
 *
 * `installStylesheet` writes once; a rule set derived from changing data (which
 * rows are hidden, which scope is active) has to keep one <style> element and
 * replace its text instead of appending a tag per change.
 */
export function installMutableStylesheet(id) {
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
