/**
 * 共享的可调尺寸对话框。
 *
 * 宿主页面里的弹窗默认铺满整个视口，宽高跟着窗口走；这里的做法相反：
 * - 四周始终留 24px，卡片永不贴边，也不随窗口拉伸；
 * - 宽高有明确的最小/最大值，窗口变小时只夹到视口允许的上限；
 * - 右下角把手可以拖拽改尺寸（键盘方向键也可以），尺寸记在 localStorage 里。
 * 样式以 `resizableDialogCss` 导出，调用方拼进自己的样式表即可。
 */
import { useEffect, useRef, useState } from 'react'

/** 遮罩四周的留白，卡片尺寸的上限要扣掉它。 */
const OVERLAY_PADDING = 24

/** 默认与会话无关的尺寸：足够放 4 列宫格，又不至于铺满屏幕。 */
export const DIALOG_DEFAULTS = { width: 920, height: 640, minWidth: 640, minHeight: 420, maxWidth: 1120, maxHeight: 860 }

/** 拖拽 / 键盘每次调整的步长。 */
const STEP = 16

function limitsOf(base, viewport) {
  const width = Number.isFinite(viewport?.width) && viewport.width > 0 ? viewport.width : base.maxWidth + OVERLAY_PADDING * 2
  const height = Number.isFinite(viewport?.height) && viewport.height > 0 ? viewport.height : base.maxHeight + OVERLAY_PADDING * 2
  // 上限永远不超过「视口减留白」；窗口小到连最小值都放不下时，最小值也跟着降到上限，
  // 否则卡片会撑出视口、把留白吃掉（用户把窗口拖窄时最常见）。
  const maxWidth = Math.max(240, Math.min(base.maxWidth, width - OVERLAY_PADDING * 2))
  const maxHeight = Math.max(200, Math.min(base.maxHeight, height - OVERLAY_PADDING * 2))
  return {
    minWidth: Math.min(base.minWidth, maxWidth),
    minHeight: Math.min(base.minHeight, maxHeight),
    maxWidth,
    maxHeight,
  }
}

function clampTo(size, limits) {
  const width = Math.round(Number(size?.width))
  const height = Math.round(Number(size?.height))
  const safeWidth = Number.isFinite(width) ? width : limits.minWidth
  const safeHeight = Number.isFinite(height) ? height : limits.minHeight
  return {
    width: Math.min(Math.max(safeWidth, limits.minWidth), limits.maxWidth),
    height: Math.min(Math.max(safeHeight, limits.minHeight), limits.maxHeight),
  }
}

/** 当前视口允许的尺寸区间；窗口变化时调用方据此重新夹取。 */
export function dialogLimits(options = {}, viewport) {
  return limitsOf({ ...DIALOG_DEFAULTS, ...options }, viewport)
}

function readStored(key) {
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return { width: Number(parsed.width), height: Number(parsed.height) }
  } catch {
    return null
  }
}

function storeSize(key, size) {
  if (!key || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify({ width: size.width, height: size.height }))
  } catch {
    /* 存不下就算了，尺寸只是偏好 */
  }
}

export function ResizableDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close',
  resizeLabel = 'Resize dialog',
  storageKey,
  width,
  height,
  minWidth = DIALOG_DEFAULTS.minWidth,
  minHeight = DIALOG_DEFAULTS.minHeight,
  maxWidth = DIALOG_DEFAULTS.maxWidth,
  maxHeight = DIALOG_DEFAULTS.maxHeight,
}) {
  const base = { minWidth, minHeight, maxWidth, maxHeight }
  const [size, setSize] = useState(() => {
    const viewport = typeof window === 'undefined' ? undefined : { width: window.innerWidth, height: window.innerHeight }
    const limits = limitsOf(base, viewport)
    const stored = readStored(storageKey)
    return clampTo(stored ?? { width: width ?? DIALOG_DEFAULTS.width, height: height ?? DIALOG_DEFAULTS.height }, limits)
  })
  const drag = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const reflow = () => setSize((prev) => clampTo(prev, limitsOf(base, { width: window.innerWidth, height: window.innerHeight })))
    reflow()
    window.addEventListener('resize', reflow)
    return () => window.removeEventListener('resize', reflow)
  }, [open, minWidth, minHeight, maxWidth, maxHeight])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (typeof onClose === 'function') onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return undefined
    storeSize(storageKey, size)
    return undefined
  }, [open, size, storageKey])

  if (!open) return null

  const dragStart = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const limits = limitsOf(base, { width: window.innerWidth, height: window.innerHeight })
    drag.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height, limits }
    if (typeof document !== 'undefined' && document.body) document.body.classList.add('tk-dialogDragging')
    const onMove = (move) => {
      const start = drag.current
      if (!start) return
      setSize(clampTo({ width: start.width + (move.clientX - start.x), height: start.height + (move.clientY - start.y) }, start.limits))
    }
    const onUp = () => {
      drag.current = null
      if (typeof document !== 'undefined' && document.body) document.body.classList.remove('tk-dialogDragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const resizeKeys = (event) => {
    const step = event.shiftKey ? STEP * 4 : STEP
    const limits = limitsOf(base, { width: window.innerWidth, height: window.innerHeight })
    const next = { width: size.width, height: size.height }
    if (event.key === 'ArrowRight') next.width += step
    else if (event.key === 'ArrowLeft') next.width -= step
    else if (event.key === 'ArrowDown') next.height += step
    else if (event.key === 'ArrowUp') next.height -= step
    else return
    event.preventDefault()
    setSize(clampTo(next, limits))
  }

  return (
    <div
      className="tk-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && typeof onClose === 'function') onClose()
      }}
    >
      <div className="tk-dialogCard" style={{ width: `${size.width}px`, height: `${size.height}px` }}>
        <div className="tk-dialogHead">
          <div className="tk-dialogHeading">
            <h3 className="tk-dialogTitle">{title}</h3>
            {description && <p className="tk-dialogDesc">{description}</p>}
          </div>
          <button type="button" className="tk-dialogClose" aria-label={closeLabel} onClick={onClose}>×</button>
        </div>
        <div className="tk-dialogBody">{children}</div>
        {footer && <div className="tk-dialogFoot">{footer}</div>}
        <button
          type="button"
          className="tk-dialogResize"
          aria-label={resizeLabel}
          title={resizeLabel}
          onMouseDown={dragStart}
          onKeyDown={resizeKeys}
        />
      </div>
    </div>
  )
}

export const resizableDialogCss = `
.tk-dialog { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: ${OVERLAY_PADDING}px; background: rgba(0, 0, 0, .42); }
.tk-dialogCard { position: relative; box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 14px; box-shadow: 0 18px 48px rgba(0, 0, 0, .24); }
.tk-dialogHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px 10px; }
.tk-dialogHeading { min-width: 0; }
.tk-dialogTitle { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
.tk-dialogDesc { margin: 4px 0 0; max-width: 60ch; }
.tk-dialogClose { flex: none; width: 26px; height: 26px; padding: 0; font-size: 17px; line-height: 1; color: var(--dsw-alias-label-secondary); background: transparent; border: 0; border-radius: 7px; cursor: pointer; }
.tk-dialogClose:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.tk-dialogBody { flex: 1; min-height: 0; overflow: auto; padding: 2px 18px 16px; }
.tk-dialogFoot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 18px 14px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.tk-dialogResize { position: absolute; right: 3px; bottom: 3px; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 5px; background: transparent; cursor: nwse-resize; }
.tk-dialogResize::after { content: ''; position: absolute; inset: 3px; background-image: repeating-linear-gradient(135deg, var(--dsw-alias-border-l3) 0 1px, transparent 1px 4px); pointer-events: none; }
.tk-dialogResize:hover::after, .tk-dialogResize:focus-visible::after { background-image: repeating-linear-gradient(135deg, var(--dsw-alias-label-secondary) 0 1px, transparent 1px 4px); }
.tk-dialogResize:focus-visible { outline: 2px solid var(--dsw-alias-state-focus-primary, var(--dsw-alias-label-secondary)); outline-offset: 1px; }
body.tk-dialogDragging { cursor: nwse-resize; user-select: none; }
`
