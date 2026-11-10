/**
 * 共享分页控件：调用方自己持有页码与数据，这里只做「上一页 / 页码 / 下一页」的呈现。
 * 样式以 `paginationCss` 字符串导出，模块把它拼进自己的样式表即可，不需要额外注入通道。
 */

/** 页码窗口：首尾两页 + 当前页附近，中间用 null 表示省略号。 */
export function paginationWindow(page, pages, span = 2) {
  if (!Number.isInteger(page) || !Number.isInteger(pages) || pages <= 0 || page < 0) return []
  const shown = []
  let last = -1
  for (let index = 0; index < pages; index += 1) {
    const near = Math.abs(index - page) <= span
    const edge = index === 0 || index === pages - 1
    if (!near && !edge) continue
    if (last >= 0 && index - last > 1) shown.push(null)
    shown.push(index)
    last = index
  }
  return shown
}

export function Pagination({ page = 0, pages = 1, onChange, labels = {}, disabled = false, summary }) {
  const total = Number.isInteger(pages) && pages > 0 ? pages : 1
  const shown = paginationWindow(page, total)
  const paged = shown.length > 0 && total > 1
  if (!paged && !summary) return null
  const go = (next) => {
    if (disabled) return
    if (!Number.isInteger(next) || next < 0 || next >= total || next === page) return
    if (typeof onChange === 'function') onChange(next)
  }
  return (
    <nav className="tk-pagination" aria-label={labels.label ?? 'Pagination'}>
      {summary ? <span className="tk-pageSummary">{summary}</span> : null}
      {paged && <span className="tk-pageButtons">
        <button type="button" className="tk-page" disabled={disabled || page <= 0} onClick={() => go(page - 1)}>{labels.prev ?? 'Previous'}</button>
        {shown.map((entry, index) => entry === null
          ? <span className="tk-pageGap" key={`gap:${index}`} aria-hidden="true">…</span>
          : <button type="button" key={entry} aria-current={entry === page ? 'page' : undefined} className={entry === page ? 'tk-page tk-pageCurrent' : 'tk-page'} disabled={disabled} onClick={() => go(entry)}>{entry + 1}</button>)}
        <button type="button" className="tk-page" disabled={disabled || page >= total - 1} onClick={() => go(page + 1)}>{labels.next ?? 'Next'}</button>
      </span>}
    </nav>
  )
}

export const paginationCss = `
.tk-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
.tk-pageSummary { min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-pageButtons { display: flex; flex: none; align-items: center; gap: 6px; }
.tk-pagination .tk-page { font: inherit; min-width: 30px; height: 30px; padding: 0 9px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 8px); cursor: pointer; font-variant-numeric: tabular-nums; }
.tk-pagination .tk-page:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.tk-pagination .tk-pageCurrent { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary-foreground); border-color: transparent; }
.tk-pagination .tk-page:disabled { opacity: .45; cursor: default; }
.tk-pagination .tk-page:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 3px; }
.tk-pagination .tk-pageGap { color: var(--dsw-alias-label-secondary); padding: 0 2px; }
`
