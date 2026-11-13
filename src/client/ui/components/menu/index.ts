/** Viewport positioning shared by settings menus. Missing layout falls back to CSS. */

export interface MenuRect {
  top: number
  bottom: number
  right: number
}

export interface MenuMeasureInput {
  rect?: MenuRect | null
  itemCount?: number
  viewportWidth?: number
  viewportHeight?: number
}

export interface MenuAnchor {
  right: number
  top: number
  bottom: number
  placement: 'down' | 'up'
  maxHeight: number
}

export interface MenuAnchorStyle {
  position: 'fixed'
  right: string
  maxHeight: string
  overflowY: 'auto'
  top?: string
  bottom?: string
}

export function measureMenuAnchor({
  rect,
  itemCount,
  viewportWidth,
  viewportHeight,
}: MenuMeasureInput = {}): MenuAnchor | null {
  if (rect == null) return null
  const top = Number(rect.top)
  const bottom = Number(rect.bottom)
  const right = Number(rect.right)
  const width = Number(viewportWidth)
  const height = Number(viewportHeight)
  if (![top, bottom, right, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  const estimated = Math.max(0, Number(itemCount) || 0) * 30 + 10
  const spaceBelow = height - bottom - 8
  const spaceAbove = top - 8
  const placement: 'down' | 'up' = spaceBelow >= estimated || spaceBelow >= spaceAbove ? 'down' : 'up'
  return {
    right: Math.max(8, width - right),
    top: Math.round(bottom + 4),
    bottom: Math.round(height - top + 4),
    placement,
    maxHeight: Math.max(0, placement === 'up' ? spaceAbove : spaceBelow),
  }
}

export function anchorStyle(anchor: MenuAnchor | null | undefined): MenuAnchorStyle | undefined {
  if (anchor == null) return undefined
  return {
    position: 'fixed',
    right: `${anchor.right}px`,
    maxHeight: `${anchor.maxHeight}px`,
    overflowY: 'auto',
    ...(anchor.placement === 'up' ? { bottom: `${anchor.bottom}px`, top: 'auto' } : { top: `${anchor.top}px`, bottom: 'auto' }),
  }
}

/** Close on viewport changes; scroll capture includes nested scrolling panels. */
export function listenMenuDismiss(close: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const page: Document = document
  const view: Window | undefined = globalThis.window
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  page.addEventListener('keydown', onKey)
  page.addEventListener('scroll', close, true)
  view?.addEventListener?.('resize', close)
  return () => {
    page.removeEventListener('keydown', onKey)
    page.removeEventListener('scroll', close as EventListener, true)
    view?.removeEventListener?.('resize', close)
  }
}
