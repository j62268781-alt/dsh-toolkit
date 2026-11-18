/**
 * 共享的可调尺寸对话框。
 *
 * 宿主页面里的弹窗默认铺满整个视口，宽高跟着窗口走；这里的做法相反：
 * - 四周始终留 24px，卡片永不贴边，也不随窗口拉伸；
 * - 宽高有明确的最小/最大值，窗口变小时只夹到视口允许的上限；
 * - 右下角把手可以拖拽改尺寸（键盘方向键也可以），尺寸记在 localStorage 里。
 *
 * 有 `HTMLDialogElement.prototype.showModal` 时走原生 `<dialog>`：top layer、`::backdrop`、
 * 焦点限制、初始焦点、Esc、关闭后还原焦点全部由浏览器提供，本文件不再手写遮罩与窗口级
 * Esc 监听。测试环境（jsdom）没有 `showModal`，于是退回改造前的 `<div role="dialog">`
 * 分支——两条分支的卡片 DOM 完全一致，选择器与类名契约不动。
 *
 * 样式以 `resizableDialogCss` 导出，调用方拼进自己的样式表即可。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 遮罩四周的留白，卡片尺寸的上限要扣掉它。 */
const OVERLAY_PADDING = 24

export interface DialogSize {
  width: number
  height: number
}

export interface DialogLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export interface DialogOptions {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

export interface DialogViewport {
  width?: number
  height?: number
}

export interface ResizableDialogProps extends DialogOptions {
  open: boolean
  onClose?: () => void
  title?: string
  description?: any
  toolbar?: any
  children?: any
  footer?: any
  closeLabel?: string
  resizeLabel?: string
  storageKey?: string
  width?: number
  height?: number
}

interface DragState {
  x: number
  y: number
  width: number
  height: number
  limits: DialogLimits
}

/** 默认与会话无关的尺寸：足够放 4 列宫格，又不至于铺满屏幕。 */
export const DIALOG_DEFAULTS = { width: 920, height: 640, minWidth: 640, minHeight: 420, maxWidth: 1120, maxHeight: 860 }

/** 拖拽 / 键盘每次调整的步长。 */
const STEP = 16

/**
 * 能力检测必须落在原型上：`<dialog>` 元素本身在 jsdom 里存在，但 `showModal` 是 undefined。
 * 用渲染期判断而不是模块级常量——测试每个用例都会换一份 jsdom，模块常量会记错。
 */
function supportsModalDialog(): boolean {
  const ctor = (globalThis as any).HTMLDialogElement
  return typeof ctor === 'function' && typeof ctor.prototype?.showModal === 'function'
}

function limitsOf(base: DialogLimits, viewport?: DialogViewport): DialogLimits {
  const width = Number.isFinite(viewport?.width) && (viewport?.width as number) > 0 ? (viewport?.width as number) : base.maxWidth + OVERLAY_PADDING * 2
  const height = Number.isFinite(viewport?.height) && (viewport?.height as number) > 0 ? (viewport?.height as number) : base.maxHeight + OVERLAY_PADDING * 2
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

function clampTo(size: Partial<DialogSize> | null | undefined, limits: DialogLimits): DialogSize {
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
export function dialogLimits(options: DialogOptions = {}, viewport?: DialogViewport): DialogLimits {
  return limitsOf({ ...DIALOG_DEFAULTS, ...options }, viewport)
}

function readStored(key: string | undefined): Partial<DialogSize> | null {
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

function storeSize(key: string | undefined, size: DialogSize): void {
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
  toolbar,
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
}: ResizableDialogProps): any {
  const base: DialogLimits = { minWidth, minHeight, maxWidth, maxHeight }
  const native = supportsModalDialog()
  const [size, setSize] = useState<DialogSize>(() => {
    const viewport = typeof window === 'undefined' ? undefined : { width: window.innerWidth, height: window.innerHeight }
    const limits = limitsOf(base, viewport)
    const stored = readStored(storageKey)
    return clampTo(stored ?? { width: width ?? DIALOG_DEFAULTS.width, height: height ?? DIALOG_DEFAULTS.height }, limits)
  })
  const drag = useRef<DragState | null>(null)
  /** 拖动过程中最后一次夹取后的尺寸；`pointerup` 才用它提交 state。 */
  const pending = useRef<DialogSize | null>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  /**
   * 原生 dialog 的 `cancel`/`close`/点遮罩会各来一次，`onClose` 只能回调一次：
   * 否则父组件会收到两次关闭请求（第二次往往是空操作甚至重复发请求）。
   */
  const closeRequested = useRef(false)
  /** showModal 之前的焦点，关闭后手动还回去（见下面 layout effect 的注释）。 */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) closeRequested.current = false
  }, [open])

  const requestClose = useCallback(() => {
    if (closeRequested.current) return
    closeRequested.current = true
    if (typeof onClose === 'function') onClose()
  }, [onClose])

  // 打开：进 top layer。关闭（组件渲染 null → 卸载）：显式退出，别把 top layer 留给下一次。
  // 用 layout effect 是为了让 dialog 在首帧就处于模态状态，不出现「先按普通块显示」的一帧。
  useLayoutEffect(() => {
    if (!native || !open) return undefined
    const dialog = dialogRef.current
    if (dialog === null || typeof (dialog as any).showModal !== 'function') return undefined
    const previous = document.activeElement as HTMLElement | null
    if (previous !== null && previous !== document.body) opener.current = previous
    try {
      if (!dialog.open) dialog.showModal()
    } catch {
      /* 已经在 top layer 里（重复打开）：open 由浏览器维护，close 事件照样回调 */
    }
    return () => {
      // 卸载时主动 close() 会再触发一次 `close` 事件；那不是用户关闭，别让父组件收到回调。
      closeRequested.current = true
      try {
        if (dialog.open) dialog.close()
      } catch {
        /* 宿主可能已经把节点摘掉了 */
      }
      // 焦点还原要自己补：本组件的「关闭」是父组件把节点卸掉，Chromium 在 removal 时
      // 不走 close() 的焦点还原步骤（Esc 那条路径被 preventDefault 拦了，同样不走）。
      const back = opener.current
      opener.current = null
      if (back !== null && back.isConnected && typeof back.focus === 'function') {
        try {
          back.focus()
        } catch {
          /* 打开者已经不可聚焦 */
        }
      }
    }
  }, [native, open])

  // 只有退化分支需要自己抓 Esc：原生 `<dialog>` 的 Esc 走 `cancel` 事件（浏览器还会顺手
  // 还原焦点），这里再监听一次只会和它抢。div 没有任何模态行为，只能由我们兜。
  useEffect(() => {
    if (!open || native) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, native, requestClose])

  useEffect(() => {
    if (!open) return undefined
    const reflow = () => setSize((prev) => clampTo(prev, limitsOf(base, { width: window.innerWidth, height: window.innerHeight })))
    reflow()
    window.addEventListener('resize', reflow)
    return () => window.removeEventListener('resize', reflow)
  }, [open, minWidth, minHeight, maxWidth, maxHeight])

  // localStorage 只在提交时写：拖动中直接改 DOM，不经过这里。
  useEffect(() => {
    if (!open) return undefined
    storeSize(storageKey, size)
    return undefined
  }, [open, size, storageKey])

  // 拖到一半被卸载（父组件直接切换页面）时把监听与 body 类名收干净。
  useEffect(() => () => stopDrag.current?.(), [])

  if (!open) return null

  const dragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const limits = limitsOf(base, { width: window.innerWidth, height: window.innerHeight })
    drag.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height, limits }
    pending.current = { width: size.width, height: size.height }
    const handle = event.currentTarget
    // 捕获指针：拖出把手、拖出窗口也还能收到 move；jsdom 没有 setPointerCapture，靠 window 监听兜底。
    if (typeof (handle as any).setPointerCapture === 'function' && typeof event.pointerId === 'number') {
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        /* 指针已经抬起：按普通拖动继续 */
      }
    }
    if (typeof document !== 'undefined' && document.body) document.body.classList.add('tk-dialogDragging')

    function onMove(move: PointerEvent): void {
      const start = drag.current
      if (!start) return
      const next = clampTo({ width: start.width + (move.clientX - start.x), height: start.height + (move.clientY - start.y) }, start.limits)
      pending.current = next
      // 拖动中直接写 DOM：每个 pointermove 一次 setState 会把整个弹窗子树重渲染一遍，
      // 列表越长越跟手不起来；这里只改两个数字，React 在 pointerup 后补一次。
      const card = cardRef.current
      if (card !== null) {
        card.style.width = `${next.width}px`
        card.style.height = `${next.height}px`
      }
    }

    function onEnd(): void {
      const committed = pending.current
      drag.current = null
      pending.current = null
      teardown()
      if (committed !== null) setSize((prev) => (prev.width === committed.width && prev.height === committed.height ? prev : committed))
    }

    function teardown(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      if (typeof document !== 'undefined' && document.body) document.body.classList.remove('tk-dialogDragging')
      stopDrag.current = null
    }

    stopDrag.current = teardown
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const resizeKeys = (event: React.KeyboardEvent) => {
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

  const card = (
    <div className="tk-dialogCard" ref={cardRef} style={{ width: `${size.width}px`, height: `${size.height}px` }}>
      <div className="tk-dialogHead">
        <div className="tk-dialogHeading">
          <h3 className="tk-dialogTitle">{title}</h3>
          {description && <p className="tk-dialogDesc">{description}</p>}
        </div>
        <button type="button" className="tk-dialogClose" aria-label={closeLabel} onClick={requestClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <path d="M2.5 2.5L13.5 13.5" />
            <path d="M13.5 2.5L2.5 13.5" />
          </svg>
        </button>
      </div>
      {toolbar && <div className="tk-dialogToolbar">{toolbar}</div>}
      <div className="tk-dialogBody">{children}</div>
      {footer && <div className="tk-dialogFoot">{footer}</div>}
      <button
        type="button"
        className="tk-dialogResize"
        aria-label={resizeLabel}
        title={resizeLabel}
        onPointerDown={dragStart}
        onKeyDown={resizeKeys}
      />
    </div>
  )

  if (native) {
    // 原生分支刻意不写 role/aria-modal：`showModal()` 已经给出模态语义，
    // 重复声明只会让读屏与浏览器各说一套。点遮罩由 `closedby="any"` 负责，
    // 下面那个 click 只是给不认识 closedby 的宿主兜底（target 是 dialog 本身才算遮罩）。
    return (
      <dialog
        ref={dialogRef}
        className="tk-dialog"
        closedby="any"
        aria-label={title}
        onCancel={(event: React.SyntheticEvent) => {
          event.preventDefault()
          requestClose()
        }}
        onClose={requestClose}
        onClick={(event: React.MouseEvent) => {
          if (event.target === event.currentTarget) requestClose()
        }}
      >
        {card}
      </dialog>
    )
  }

  // 退化分支：与改造前的 DOM 一模一样（jsdom 走的就是这条）。
  return (
    <div
      className="tk-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event: React.MouseEvent) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      {card}
    </div>
  )
}

export const resizableDialogCss = `
/* 布局共用；display 不在这里声明，只在下面跟着「正在显示」声明一条。 */
.tk-dialog { position: fixed; inset: 0; z-index: 1000; align-items: center; justify-content: center; padding: ${OVERLAY_PADDING}px; }
/* display 只跟着「这一层正在显示」走：原生 dialog 只有 [open] 时可见，退化分支是 div
   （组件只在 open=true 时渲染它），用 :not(dialog) 认。绝不能在裸 .tk-dialog 上写 display，
   否则关闭态的原生 dialog 会被作者样式顶出来。 */
.tk-dialog[open], .tk-dialog:not(dialog) { display: flex; }
/* 退化分支（div）仍然自绘遮罩；原生分支的遮罩是 ::backdrop。 */
.tk-dialog:not(dialog) { background: rgba(0, 0, 0, .42); }
/* 收回 <dialog> 的 UA 默认（边框、margin:auto、1em 内边距、Canvas 背景、fit-content 宽高）。 */
dialog.tk-dialog { box-sizing: border-box; width: auto; height: auto; max-width: none; max-height: none; margin: 0; border: 0; background: transparent; color: inherit; overflow: visible; }
dialog.tk-dialog::backdrop { background: rgba(0, 0, 0, .42); }
.tk-dialogCard { position: relative; box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 14px; box-shadow: 0 18px 48px rgba(0, 0, 0, .24); }
.tk-dialogHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px 10px; }
.tk-dialogHeading { min-width: 0; }
.tk-dialogTitle { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
.tk-dialogDesc { margin: 4px 0 0; max-width: 60ch; }
/* 关闭按钮沿用宿主的 DSH 图标：16×16 两笔 45° 交叉线，28×28 的透明按钮。 */
.tk-dialogClose { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; color: var(--dsw-alias-label-secondary); background: transparent; border: 0; border-radius: var(--dsw-radius-sm, 6px); cursor: pointer; }
@media (hover: hover) { .tk-dialogClose:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); } }
.tk-dialogClose:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.tk-dialogToolbar { flex: none; padding: 0 18px 10px; }
.tk-dialogBody { flex: 1; min-height: 0; overflow: auto; padding: 2px 18px 16px; }
.tk-dialogFoot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 18px 14px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
/* touch-action: none 让触屏/手写笔的 pointermove 不被浏览器的滚动接管。 */
.tk-dialogResize { position: absolute; right: 3px; bottom: 3px; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 5px; background: transparent; cursor: nwse-resize; touch-action: none; }
.tk-dialogResize::after { content: ''; position: absolute; inset: 3px; background-image: repeating-linear-gradient(135deg, var(--dsw-alias-border-l3) 0 1px, transparent 1px 4px); pointer-events: none; }
.tk-dialogResize:hover::after, .tk-dialogResize:focus-visible::after { background-image: repeating-linear-gradient(135deg, var(--dsw-alias-label-secondary) 0 1px, transparent 1px 4px); }
.tk-dialogResize:focus-visible { outline: 2px solid var(--dsw-alias-state-focus-primary, var(--dsw-alias-label-secondary)); outline-offset: 1px; }
body.tk-dialogDragging { cursor: nwse-resize; user-select: none; }
`
