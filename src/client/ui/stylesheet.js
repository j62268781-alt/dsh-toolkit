/** Install plugin-owned CSS and return the matching teardown. */
export function installStylesheet(css, id) {
  const tag = document.createElement('style')
  tag.dataset.plugin = id
  tag.dataset.pluginCss = `${id}/styles.css`
  tag.textContent = css
  ;(document.head ?? document.documentElement).appendChild(tag)
  return () => tag.remove()
}
