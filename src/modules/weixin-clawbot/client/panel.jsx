import { createQrCode } from './qr.jsx'
import { pollInterval, toneOf } from './model.js'

/**
 * 面板：hover 触发，鼠标离开关闭；面板内的开关可以让它保持展开。
 *
 * 交互细节（按设计稿）：
 *   - 侧栏底部一个入口按钮，带状态圆点；
 *   - 悬停弹出卡片，移出即关闭（指针从按钮移到卡片上的间隙有 160ms 宽限）；
 *   - 卡片底部一行「鼠标离开后保持展开」开关（对应设计稿的 toggle）；
 *   - 卡片通过 portal 挂到 body，避免被侧栏的 overflow 裁掉。
 *
 * 组件都定义在工厂闭包里、只创建一次，避免每次渲染重建组件类型导致 hooks 状态丢失。
 */
export function createPanel(React, { t, connection, portal }) {
  const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
  const h = React.createElement
  const QrCode = createQrCode(React)

  const STATE_LABEL = {
    idle: 'stateIdle',
    requesting: 'stateRequesting',
    waiting_qr: 'stateWaiting',
    scanned: 'stateScanned',
    need_code: 'stateNeedCode',
    connected: 'stateConnected',
    confirmed: 'stateConnected',
    failed: 'stateFailed',
  }

  /** 剩余秒数；没有 expiresAt 时返回 undefined。hook 本身无条件调用。 */
  function useCountdown(expiresAt) {
    const [now, setNow] = useState(() => Date.now())
    const active = Number.isFinite(expiresAt)
    useEffect(() => {
      if (!active) return undefined
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(timer)
    }, [active, expiresAt])
    if (!active) return undefined
    return Math.max(0, Math.ceil((expiresAt - now) / 1000))
  }

  function Switch({ checked, onChange, label }) {
    return h('button', {
      type: 'button',
      className: 'wc-switch',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': label,
      onClick: () => onChange(!checked),
    }, h('span', { className: 'wc-switch__knob' }))
  }

  function StatusRow({ state, children }) {
    return h('div', { className: 'wc-status' },
      h('span', { className: `wc-dot wc-dot--${toneOf(state)}`, 'aria-hidden': true }),
      h('span', null, children))
  }

  /** 未连接：一个主动作按钮。 */
  function Disconnected({ busy, onConnect }) {
    return h('div', { className: 'wc-body' },
      h(StatusRow, { state: 'idle' }, t(STATE_LABEL.idle)),
      h('div', { className: 'wc-actions' },
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--primary',
          disabled: busy,
          onClick: onConnect,
        }, busy ? t('stateRequesting') : t('connect'))))
  }

  /** 等待扫码：二维码 + 倒计时 + 刷新/取消。 */
  function Waiting({ value, busy, onCancel, onRefresh }) {
    const seconds = useCountdown(value.qr?.expiresAt)
    const expired = seconds === 0
    const label = value.state === 'scanned' ? t('stateScanned') : t('stateWaiting')
    return h('div', { className: 'wc-body' },
      h(StatusRow, { state: value.state }, label),
      value.qr === undefined
        ? h('div', { className: 'wc-hint' }, t('stateRequesting'))
        : h(QrCode, { url: value.qr.url, size: 176, label: t('title') }),
      h('div', { className: 'wc-hint' }, t('scanHint')),
      expired
        ? h('div', { className: 'wc-countdown' }, t('qrExpired'))
        : (seconds === undefined ? null : h('div', { className: 'wc-countdown' }, t('qrCountdown', { s: seconds }))),
      h('div', { className: 'wc-actions' },
        h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: onRefresh }, t('refresh')),
        h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: onCancel }, t('cancel'))))
  }

  /** 需要数字校验码。 */
  function NeedCode({ busy, attempts, onSubmit, onCancel }) {
    const [code, setCode] = useState('')
    const inputRef = useRef(null)
    useEffect(() => {
      inputRef.current?.focus()
    }, [])
    const submit = () => {
      const value = code.trim()
      if (value !== '') onSubmit(value)
    }
    return h('div', { className: 'wc-body' },
      h(StatusRow, { state: 'need_code' }, t('stateNeedCode')),
      h('div', { className: 'wc-hint' }, t('stateNeedCode')),
      h('div', { className: 'wc-code' },
        h('input', {
          ref: inputRef,
          className: 'wc-code__input',
          inputMode: 'numeric',
          pattern: '[0-9]*',
          placeholder: t('codePlaceholder'),
          value: code,
          disabled: busy,
          onChange: (event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8)),
          onKeyDown: (event) => {
            if (event.key === 'Enter') submit()
          },
        }),
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--primary',
          disabled: busy || code === '',
          onClick: submit,
        }, t('codeSubmit'))),
      attempts > 0 ? h('div', { className: 'wc-countdown' }, `#${attempts}`) : null,
      h('div', { className: 'wc-actions' },
        h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: onCancel }, t('cancel'))))
  }

  /** 已连接：脱敏账号 + 通道自检 + 断开。 */
  function Connected({ value, busy, onProbe, onLogout, onReconnect, probeNote }) {
    const message = value.lastMessage
    const monitorText = value.monitor.running
      ? `${t('monitorOn')} · ${t('received', { n: value.monitor.received })}`
      : t('monitorOff')
    return h('div', { className: 'wc-body' },
      h(StatusRow, { state: 'connected' }, t('stateConnected')),
      h('div', { className: 'wc-info' },
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('account')),
          h('span', { className: 'wc-info__value' }, value.account?.accountId ?? '—')),
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('endpoint')),
          h('span', { className: 'wc-info__value' }, value.account?.baseUrlHost ?? '—')),
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('credentialRef')),
          h('span', { className: 'wc-info__value' }, value.credentialRef)),
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('monitor')),
          h('span', { className: 'wc-info__value' }, monitorText))),
      h('div', { className: 'wc-message' },
        h('div', { className: 'wc-message__meta' }, t('lastMessage')),
        message === undefined
          ? h('div', { className: 'wc-message__text' }, t('noneYet'))
          : h('div', null,
            h('div', { className: 'wc-message__meta' }, message.from || '—'),
            h('div', { className: 'wc-message__text' }, message.text || message.note || ''))),
      probeNote === undefined ? null : h('div', { className: 'wc-hint' }, probeNote),
      h('div', { className: 'wc-actions' },
        h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: onProbe },
          busy ? t('probing') : t('probe')),
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--danger',
          disabled: busy,
          onClick: onLogout,
        }, t('disconnect'))),
      h('div', { className: 'wc-actions' },
        h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: onReconnect },
          t('reconnect'))))
  }

  /**
   * 弹出卡片。position 由触发按钮的 boundingRect 决定：
   * 侧栏在左，卡片贴右侧展开；若下方空间不足则向上对齐。
   */
  function Popover({ anchor, pinned, onPin, onClose }) {
    const value = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    const [busy, setBusy] = useState(false)
    const [probeNote, setProbeNote] = useState(undefined)
    const [localError, setLocalError] = useState(undefined)

    // 打开时读一次状态；关闭时停止本地状态机。
    useEffect(() => {
      void connection.open()
      return () => connection.close()
    }, [])

    // 轮询：只在需要时走，间隔随状态变化；页面隐藏时跳过。
    useEffect(() => {
      const interval = pollInterval(value.state)
      if (interval === 0) return undefined
      const timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void connection.refresh()
      }, interval)
      return () => clearInterval(timer)
    }, [value.state])

    // Esc 关闭。
    useEffect(() => {
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const run = useCallback(async (work) => {
      setBusy(true)
      setLocalError(undefined)
      try {
        await work()
      } catch (error) {
        setLocalError(String(error?.message ?? error))
      } finally {
        setBusy(false)
      }
    }, [])

    const style = useMemo(() => {
      if (anchor === undefined) return { left: 16, top: 16 }
      const width = 320
      const estimated = 430
      const left = Math.min(anchor.right + 12, Math.max(8, window.innerWidth - width - 8))
      const top = anchor.bottom + estimated > window.innerHeight
        ? Math.max(8, window.innerHeight - estimated - 8)
        : Math.max(8, anchor.top - 8)
      return { left: Math.max(8, left), top }
    }, [anchor])

    const state = value.state
    const connected = value.connected === true
    const error = localError ?? value.error ?? value.credentialError

    const body = (() => {
      if (connected) {
        return h(Connected, {
          value,
          busy,
          probeNote,
          onProbe: () => run(async () => {
            const result = await connection.probe()
            setProbeNote(result.messages > 0
              ? t('probeMessages', { n: result.messages })
              : t('probeOk'))
          }),
          onLogout: () => run(async () => {
            setProbeNote(undefined)
            await connection.logout()
          }),
          onReconnect: () => run(async () => {
            setProbeNote(undefined)
            await connection.startLogin()
          }),
        })
      }
      if (state === 'need_code') {
        return h(NeedCode, {
          busy,
          attempts: value.code?.attempts ?? 0,
          onSubmit: (next) => run(() => connection.submitCode(next)),
          onCancel: () => run(() => connection.cancelLogin()),
        })
      }
      if (state === 'waiting_qr' || state === 'scanned' || state === 'requesting') {
        return h(Waiting, {
          value,
          busy,
          onRefresh: () => run(() => connection.startLogin()),
          onCancel: () => run(() => connection.cancelLogin()),
        })
      }
      return h(Disconnected, {
        busy,
        onConnect: () => run(() => connection.startLogin()),
      })
    })()

    return h('div', {
      className: 'wc-popover',
      style,
      role: 'dialog',
      'aria-label': t('title'),
      onMouseEnter: () => {
        if (!pinned) connection.refresh()
      },
    },
    h('div', { className: 'wc-head' },
      h('div', { className: 'wc-head__text' },
        h('div', { className: 'wc-title' }, t('title')),
        h('div', { className: 'wc-subtitle' }, t('subtitle'))),
      h('button', {
        type: 'button',
        className: 'wc-close',
        'aria-label': t('close'),
        onClick: onClose,
      }, '×')),
    error === undefined ? null : h('div', { className: 'wc-error' }, t('failed', { reason: error })),
    body,
    h('div', { className: 'wc-footer' },
      h('span', { className: 'wc-footer__label' }, t('keepOpen')),
      h(Switch, { checked: pinned, onChange: onPin, label: t('keepOpen') })))
  }

  /**
   * 侧栏底部入口。hover 打开，mouseleave 关闭（除非被钉住）。
   * @param props.wide 侧栏是否展开（false 时只显示图标）。
   */
  function WeixinEntry({ wide = true }) {
    const [open, setOpen] = useState(false)
    const [pinned, setPinned] = useState(false)
    const [anchor, setAnchor] = useState(undefined)
    const triggerRef = useRef(null)
    const closeTimer = useRef(undefined)
    const pinnedRef = useRef(false)
    pinnedRef.current = pinned

    const value = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    const state = value.connected ? 'connected' : value.state
    const tone = toneOf(state === 'closed' ? 'idle' : state)

    // 首次挂载同步一次状态，让没打开过面板时小圆点也是准的。
    useEffect(() => {
      void connection.refresh()
      return () => clearTimeout(closeTimer.current)
    }, [])

    const openNow = useCallback(() => {
      clearTimeout(closeTimer.current)
      closeTimer.current = undefined
      const rect = triggerRef.current?.getBoundingClientRect()
      setAnchor(rect === undefined
        ? undefined
        : { top: rect.top, bottom: rect.bottom, right: rect.right })
      setOpen(true)
    }, [])

    const closeSoon = useCallback(() => {
      if (pinnedRef.current) return
      clearTimeout(closeTimer.current)
      // 留一点时间让指针从按钮移到卡片上。
      closeTimer.current = setTimeout(() => setOpen(false), 160)
    }, [])

    const closeNow = useCallback(() => {
      clearTimeout(closeTimer.current)
      closeTimer.current = undefined
      setOpen(false)
      setPinned(false)
    }, [])

    // 点击卡片外部（且未钉住）时关闭。
    useEffect(() => {
      if (!open || pinned) return undefined
      const onDown = (event) => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (triggerRef.current?.contains(target)) return
        if (target instanceof Element && target.closest('.wc-popover') !== null) return
        setOpen(false)
      }
      document.addEventListener('pointerdown', onDown, true)
      return () => document.removeEventListener('pointerdown', onDown, true)
    }, [open, pinned])

    const trigger = h('button', {
      ref: triggerRef,
      type: 'button',
      className: 'wc-trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      title: wide ? undefined : t('entryTitle'),
      onMouseEnter: openNow,
      onFocus: openNow,
      onClick: () => (open ? closeNow() : openNow()),
    },
    h('span', { className: 'wc-trigger__glyph', 'aria-hidden': true },
      h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
        h('path', {
          d: 'M8 1.8C6.2 1.8 5 3.2 5 5.1c0 2.1-.6 3-1.1 3.6-.2.2 0 .6.3.6h7.6c.3 0 .5-.4.3-.6-.5-.6-1.1-1.5-1.1-3.6 0-1.9-1.2-3.3-3-3.3Z',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.6 11.6a1.5 1.5 0 0 0 2.8 0',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }))),
    h('span', { className: 'wc-trigger__label' }, t('entry')),
    h('span', { className: `wc-dot wc-dot--${tone}`, 'aria-hidden': true }))

    // 关键：卡片自己负责「移出去就关」，而不是由外层容器的 mouseleave 决定——
    // 卡片是 portal 到 body 的，外层容器收不到它的 pointer 事件。
    const popover = open
      ? portal(h(Popover, {
        anchor,
        pinned,
        onPin: (next) => {
          setPinned(next)
          if (!next) closeSoon()
        },
        onClose: closeNow,
      }), document.body)
      : null

    return h('div', {
      className: `wc-entry${wide ? '' : ' wc-entry--rail'}`,
      onMouseLeave: closeSoon,
    }, trigger, popover)
  }

  return WeixinEntry
}
