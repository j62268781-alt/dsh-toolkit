/**
 * 提醒卡片的 React 层。
 *
 * 注册到公共槽位 `shell.overlay`（见 index.jsx），固定在窗口右上角：
 *   - 外层 `pointer-events: none`，卡片自身 `pointer-events: auto`，不挡住下面的设置页；
 *   - 卡片主体是按钮：点击打开对应会话并关掉卡片；右侧关闭按钮只关卡片；
 *   - Escape 关掉最新的一张（不 preventDefault / stopPropagation，宿主弹层不受影响）；
 *   - 约 8 秒后自动消失，鼠标悬停或键盘焦点落在卡片上时暂停计时；
 *   - 从不调用 focus()：卡片出现不应该把焦点从用户正在输入的地方抢走。
 *
 * 组件是工厂产物：`createNotificationToasts(React, { t, store, openSession, autoDismissMs })`，
 * 端口全部注入，因此 node 测试可以挂载它并驱动一张假 store。
 */

/** 卡片自动消失的时间（毫秒）。 */
export const TOAST_AUTO_DISMISS_MS = 8000

/**
 * 创建卡片组件。
 * @param {object} React 宿主 React（与主 bundle 的 jsxFactory 同一份）。
 * @param {object} deps 注入端口。
 * @param {(key: string, params?: object) => string} deps.t 文案函数。
 * @param {{getSnapshot: Function, subscribe: Function, dismiss: Function, setError: Function}} deps.store 卡片 store。
 * @param {(sessionId: string) => any} deps.openSession 打开会话（返回 `{ ok }`，失败时自己把错误写回 store）。
 * @param {number} [deps.autoDismissMs] 自动消失时间，测试用。
 */
export function createNotificationToasts(React, deps) {
  const { t, store, openSession } = deps ?? {}
  const translate = typeof t === 'function' ? t : (key) => key
  const autoDismissMs = Number.isFinite(deps?.autoDismissMs) && deps.autoDismissMs > 0
    ? Number(deps.autoDismissMs)
    : TOAST_AUTO_DISMISS_MS

  /**
   * 单张卡片：自己持有自动消失计时器（悬停/聚焦时暂停）。
   * @param {{item: object, dismiss: (id: number) => void}} props
   */
  function ToastCard({ item, dismiss }) {
    const [paused, setPaused] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    /** 剩余自动消失时间：暂停时把已用掉的部分扣掉。 */
    const remaining = React.useRef(autoDismissMs)
    const startedAt = React.useRef(0)

    React.useEffect(() => {
      if (paused || busy) return undefined
      startedAt.current = Date.now()
      const timer = setTimeout(() => {
        dismiss(item.id)
      }, Math.max(0, remaining.current))
      return () => {
        clearTimeout(timer)
        remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
      }
    }, [paused, busy, item.id, dismiss])

    /** 点击卡片主体：先导航，确认打开后再关卡片；失败时保留卡片展示原因。 */
    const activate = async () => {
      if (busy) return
      setBusy(true)
      try {
        const result = await openSession(item.sessionId)
        if (result === false || result?.ok === false) return
        dismiss(item.id)
      } catch {
        // never throw out of the click handler: 把原因放回卡片上。
        store.setError?.(item.id, translate('navigateFailed'))
      } finally {
        setBusy(false)
      }
    }

    return (
      <div
        className="ntf-toast"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div className="ntf-toastContent">
          <button
            type="button"
            className="ntf-toastBody"
            disabled={busy}
            title={translate('openSession')}
            onClick={() => { void activate() }}
          >
            <span className="ntf-toastTitle">{item.title || translate('untitled')}</span>
            <span className="ntf-toastText">{item.body}</span>
          </button>
          {item.error
            ? <p className="ntf-toastError" role="alert">{item.error}</p>
            : null}
        </div>
        <button
          type="button"
          className="ntf-toastClose"
          aria-label={translate('dismiss')}
          onClick={() => dismiss(item.id)}
        >×</button>
      </div>
    )
  }

  /** 槽位组件：订阅 store，渲染右上角的卡片栈。 */
  function NotificationToasts() {
    const items = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    const visible = items.length > 0

    // Escape 关掉最新的一张；没有卡片时不挂监听。
    React.useEffect(() => {
      if (!visible || typeof window === 'undefined') return undefined
      const onKeyDown = (event) => {
        if (event?.key !== 'Escape') return
        const [newest] = store.getSnapshot()
        if (newest !== undefined) store.dismiss(newest.id)
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [visible])

    if (!visible) return null
    return (
      <div className="ntf-toasts" role="region" aria-label={translate('toastsLabel')}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} dismiss={store.dismiss} />
        ))}
      </div>
    )
  }

  return NotificationToasts
}
