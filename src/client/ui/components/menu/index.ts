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

/**
 * 原生 popover 是否可用。
 *
 * 可用时菜单进 top layer：层叠顺序、Esc、点外关闭（light dismiss）都不必自己实现，
 * 遮罩那一层也可以删掉。jsdom 没有这个属性，所以测试跑的是手写兜底路径。
 */
export const CAN_POPOVER = typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover')

/** 菜单容器要摊开的属性；不支持时返回空对象，调用方保持手写实现。 */
export function popoverMenuAttrs(): Record<string, string> {
  return CAN_POPOVER ? { popover: 'auto' } : {}
}

export function showMenu(element: any): void {
  if (!CAN_POPOVER || !element) return
  try {
    if (!element.matches(':popover-open')) element.showPopover()
  } catch {
    /* 还没挂载或已经关掉：状态由 React 兜着 */
  }
}

export function hideMenu(element: any): void {
  if (!CAN_POPOVER || !element) return
  try {
    if (element.matches(':popover-open')) element.hidePopover()
  } catch {
    /* 同上 */
  }
}

/**
 * 方向键 / Home / End 的菜单键盘契约。
 *
 * `role="menu"` 只有在真的实现这套移动时才合法；原生 `focusgroup` 目前只有
 * Chromium 150+，所以三个菜单共用这一份兜底，而不是各自写一遍。
 */
export function menuKeydown(event: any, container: any): boolean {
  const key = event?.key
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return false
  if (!container) return false
  const seen = new Set()
  const items = [...container.querySelectorAll('[role="menuitem"], button')].filter((node: any) => {
    if (seen.has(node)) return false
    seen.add(node)
    return node.disabled !== true && node.getAttribute?.('aria-disabled') !== 'true' && node.hidden !== true
  })
  if (items.length === 0) return false
  event.preventDefault()
  const index = items.indexOf(event.target)
  const next = key === 'Home' ? 0
    : key === 'End' ? items.length - 1
      : index < 0 ? (key === 'ArrowUp' ? items.length - 1 : 0)
        : (index + (key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[next].focus?.()
  return true
}
