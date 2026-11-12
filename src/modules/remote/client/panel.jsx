import { createQrCode } from './qr.jsx'
import { pollInterval, toneOf } from './model.js'
import { placePopover } from './position.js'
import {
  PAIRING_CODE_LENGTH,
  PAIRING_POLL_MS,
  createPairing,
  isPairingActive,
} from './pairing.js'

/** 指纹按 4 字符分组，方便人眼比对（与 ds-harness-remote 自己的面板一致）。 */
function shortFingerprint(value) {
  if (typeof value !== 'string' || value === '') return '—'
  return (value.slice(0, 16).match(/.{1,4}/g) ?? []).join(' ')
}

/** 视口尺寸；定位用的是 `position: fixed`，所以基准必须是视口而不是文档。 */
function readViewport() {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/** 收起动画时长；与 styles.css 里 `.wc-popover--closing` 的 animation-duration 保持一致。 */
const PANEL_CLOSE_MS = 150

/**
 * 面板：点击入口按钮开关，卡片带进出动画。
 *
 * 交互细节（按用户反馈定稿）：
 *   - 侧栏底部一个入口按钮，带状态圆点，打开时按钮保持选中底色；
 *   - 只由点击切换（不再跟随 hover），两个 tab 内容高度不同也不会因为指针移出而闪关；
 *   - 点卡片外面或 Esc 收起，收起时播一段短动画再卸载；
 *   - 卡片通过 portal 挂到 body，避免被侧栏的 overflow 裁掉。
 *
 * 组件都定义在工厂闭包里、只创建一次，避免每次渲染重建组件类型导致 hooks 状态丢失。
 */
export function createPanel(React, { t, connection, portal }) {
  const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React
  const h = React.createElement
  const QrCode = createQrCode(React)
  // 手机配对的会话状态与微信连接彼此独立：一个 store 给 tab 与子视图共享。
  const pairing = createPairing()

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

  /** 宿主 primitives 的 IconCloseOutlineRegular：16×16、两笔 45° 交叉线。 */
  function CloseIcon() {
    return h('svg', {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1,
      'aria-hidden': true,
    },
    h('path', { d: 'M2.5 2.5L13.5 13.5' }),
    h('path', { d: 'M13.5 2.5L2.5 13.5' }))
  }

  /**
   * 未连接：只有一个主动作按钮。
   *
   * 不再单独写一行「未连接」——卡片里有「连接微信」按钮时，状态本身就是不言自明的，
   * 多一行灰字读起来像两个互相矛盾的信息（B 阶段实测：用户第一反应就是「都让我连了，
   * 干嘛还告诉我没连」）。真正的连接状态由入口按钮右上角的小圆点表达。
   */
  function Disconnected({ busy, onConnect }) {
    return h('div', { className: 'wc-body' },
      h('div', { className: 'wc-actions' },
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--primary',
          disabled: busy,
          onClick: onConnect,
        }, busy ? t('stateRequesting') : t('connect'))))
  }

  /**
   * 扫码阶段：二维码 + 四态蒙层。
   *
   * 四态来自产品设计图：等待扫码（纯二维码）/ 已扫码（蒙层「连接中」）/
   * 已过期（蒙层「已过期 + 点击刷新」）/ 已连接（不归这个组件管）。
   * 蒙层用绝对定位压在二维码上，所以二维码本身尺寸不变，卡片不会因为换态而跳动。
   */
  function Waiting({ value, busy, onCancel, onRefresh }) {
    const seconds = useCountdown(value.qr?.expiresAt)
    // 过期有两个信号：服务端已经判死（state==='expired'），或本地倒计时归零。
    const expired = value.state === 'expired' || seconds === 0
    const scanned = value.state === 'scanned'
    // 不写「等待扫码 / 已扫码 / 已过期」状态行：二维码本身、蒙层和倒计时已经把话说完了。
    // 蒙层内容包一层衬底：二维码本身是黑白高对比，白字直接压上去几乎看不清。
    const maskPanel = (title, action) => h('span', { className: 'wc-qr-mask__panel' },
      h('span', { className: 'wc-qr-mask__title' }, title),
      action === undefined ? null : h('span', { className: 'wc-qr-mask__action' }, action))
    const mask = expired
      ? h('button', {
        type: 'button',
        className: 'wc-qr-mask wc-qr-mask--expired',
        disabled: busy,
        onClick: onRefresh,
      }, maskPanel(t('qrExpiredTitle'), t('qrExpiredAction')))
      : (scanned
        ? h('div', { className: 'wc-qr-mask' }, maskPanel(t('qrConnecting')))
        : null)
    return h('div', { className: 'wc-body' },
      value.qr === undefined
        ? h('div', { className: 'wc-hint' }, t('stateRequesting'))
        : h('div', { className: 'wc-qr-wrap' },
          h(QrCode, { url: value.qr.url, size: 176, label: t('title') }),
          mask),
      h('div', { className: 'wc-hint' }, t('scanHint')),
      expired || seconds === undefined
        ? null
        : h('div', { className: 'wc-countdown' }, t('qrCountdown', { s: seconds })),
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
      // 状态行与提示是同一句话，只保留提示，避免上下两行重复。
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

  /**
   * 已连接：账号 + 端点 + 监听/收发 + 断开。
   *
   * 桥接是固定开启、只对自己开放的（登录即生效），面板里不再提供开关/策略/测试按钮，
   * 收发计数并进「消息监听」这一行。底部只有一行操作：左「重新登录」、右「断开连接」。
   */
  function Connected({ value, busy, degraded, onLogout, onReconnect }) {
    const message = value.lastMessage
    const bridge = value.bridge
    // 断线（服务端拒了 token）时「消息监听」这一行改成说人话的错误，而不是继续显示「监听中 · 收 N」。
    const traffic = degraded === true
      ? (value.monitor?.lastError ?? t('stateReconnecting'))
      : t(value.monitor.running ? 'monitorTraffic' : 'monitorIdle', {
        r: bridge.received,
        s: bridge.replied,
      })
    return h('div', { className: 'wc-body' },
      h('div', { className: 'wc-info' },
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('account')),
          h('span', { className: 'wc-info__value' }, value.account?.accountId ?? '—')),
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('endpoint')),
          h('span', { className: 'wc-info__value' }, value.account?.baseUrlHost ?? '—')),
        h('div', { className: 'wc-info__row' },
          h('span', { className: 'wc-info__key' }, t('monitor')),
          h('span', {
            className: 'wc-info__value',
            ...(degraded === true ? { 'data-state': 'bad' } : {}),
          }, traffic))),
      h('div', { className: 'wc-message' },
        h('div', { className: 'wc-message__meta' }, t('lastMessage')),
        message === undefined
          ? h('div', { className: 'wc-message__text' }, t('noneYet'))
          : h('div', null,
            h('div', { className: 'wc-message__meta' }, message.from || '—'),
            h('div', { className: 'wc-message__text' }, message.text || message.note || ''))),
      h('div', { className: 'wc-actions wc-actions--full' },
        h('button', {
          type: 'button',
          className: degraded === true
            ? 'wc-button wc-button--half wc-button--primary'
            : 'wc-button wc-button--half',
          disabled: busy,
          onClick: onReconnect,
        }, t('reconnect')),
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--half wc-button--danger-solid',
          disabled: busy,
          onClick: onLogout,
        }, t('disconnect'))))
  }

  /**
   * 顶部 tab：浅灰胶囊容器 + 白色内嵌选中块（对齐插件页「已安装 / 发现」的分段控件）。
   * 用两段式：容器只做底色与内边距，按钮自己画选中块，这样切换时不会整条重排。
   */
  function TabBar({ tab, onTab }) {
    const items = [['pair', t('tabPair')], ['claw', t('tabClaw')]]
    const index = Math.max(0, items.findIndex(([key]) => key === tab))
    const item = (key, label) => h('button', {
      type: 'button',
      role: 'tab',
      id: `wc-tab-${key}`,
      className: tab === key ? 'wc-tab wc-tab--active' : 'wc-tab',
      'aria-selected': tab === key,
      'aria-controls': 'wc-tabpanel',
      onClick: () => onTab(key),
    }, label)
    // 白色指示块由 CSS 画，位置靠 transform 平移；按钮自己保持透明。
    return h('div', { className: 'wc-tabs', role: 'tablist', 'aria-label': t('tabsLabel') },
      h('div', {
        className: 'wc-tab-indicator',
        'aria-hidden': 'true',
        style: { transform: `translateX(${index * 100}%)` },
      }),
      ...items.map(([key, label]) => item(key, label)))
  }

  /** 服务器地址一行：默认展示，点「修改」变成输入框（自部署 server 时要用）。 */
  function ServerRow({ serverUrl, busy, onSave }) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const startEdit = () => {
      setDraft(typeof serverUrl === 'string' ? serverUrl : '')
      setEditing(true)
    }
    const save = () => {
      const next = draft.trim()
      if (next === '') return
      void Promise.resolve(onSave(next)).then(() => setEditing(false))
    }
    if (!editing) {
      return h('div', { className: 'wc-info__row' },
        h('span', { className: 'wc-info__key' }, t('pairServer')),
        h('span', { className: 'wc-info__value wc-info__value--muted', title: serverUrl }, serverUrl ?? '—'),
        h('button', {
          type: 'button',
          className: 'wc-link',
          disabled: busy,
          onClick: startEdit,
        }, t('pairServerEdit')))
    }
    return h('div', { className: 'wc-field' },
      h('input', {
        className: 'wc-field__input',
        inputMode: 'url',
        placeholder: 'https://your-server.example.com',
        value: draft,
        disabled: busy,
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') save()
          if (event.key === 'Escape') setEditing(false)
        },
      }),
      h('button', {
        type: 'button',
        className: 'wc-button wc-button--half wc-button--primary',
        disabled: busy || draft.trim() === '',
        onClick: save,
      }, t('pairServerSave')),
      h('button', {
        type: 'button',
        className: 'wc-button wc-button--half',
        disabled: busy,
        onClick: () => setEditing(false),
      }, t('cancel')))
  }

  /**
   * 手机配对 tab：对齐 ds-harness-remote 的配对状态机
   * created(二维码) → claimed(手机显示 8 位码，这里输入) → approved → completed。
   *
   * 手机端（dsh-Go）自己完成 resolve/claim/status；桌面端只负责生成会话、确认验证码。
   * 所有请求走本机控制路由，不经过插件自己的 HTTP 路由。
   */
  function PairingTab({ active }) {
    const value = useSyncExternalStore(pairing.subscribe, pairing.getSnapshot, pairing.getSnapshot)
    const view = value.view
    const state = view?.state
    const busy = value.busy
    const [code, setCode] = useState('')
    const codeRef = useRef(null)
    const seconds = useCountdown(view?.expiresAt)

    // 切到配对 tab 才读状态：默认 tab 是配对，所以打开面板就会读一次。
    useEffect(() => {
      if (!active) return
      void pairing.open()
    }, [active])

    useEffect(() => {
      if (state === 'claimed') codeRef.current?.focus()
    }, [state])

    // 活动会话才轮询：手机扫码/确认都发生在远端，只能靠短轮询感知。
    useEffect(() => {
      // `halted` 是致命错误（如账号冲突）：停掉轮询，否则错误行每 2.5 秒闪一次。
      if (!active || value.halted || !isPairingActive(view)) return undefined
      const timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void pairing.refresh()
      }, PAIRING_POLL_MS)
      return () => clearInterval(timer)
    }, [active, state, value.halted])

    // 本地倒计时归零等价于「这张二维码已经不能用了」，状态文案要立刻改口。
    const expired = state === 'created' && seconds === 0
    const terminal = state === 'failed' || state === 'cancelled' || state === 'expired' || expired

    const start = () => void pairing.start()
    const cancel = () => void pairing.cancel()
    const submit = async () => {
      const next = await pairing.confirm(code)
      if (next !== undefined) setCode('')
    }

    const body = (() => {
      if (state === 'completed') {
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-info' },
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairPhone')),
              h('span', { className: 'wc-info__value' }, view.mobile?.name ?? '—')),
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairFingerprint')),
              h('span', { className: 'wc-info__value' }, shortFingerprint(view.mobile?.fingerprint))),
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairServer')),
              h('span', { className: 'wc-info__value wc-info__value--muted', title: view.serverUrl }, view.serverUrl ?? '—'))),
          h('div', { className: 'wc-hint' }, t('pairCompletedHint')),
          h('div', { className: 'wc-actions' },
            h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: start }, t('pairAgain'))))
      }
      if (state === 'claimed') {
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-hint' }, view.mobile?.name === undefined
            ? t('pairClaimedHint')
            : t('pairClaimedHintNamed', { name: view.mobile.name })),
          h('div', { className: 'wc-code' },
            h('input', {
              ref: codeRef,
              className: 'wc-code__input',
              inputMode: 'numeric',
              pattern: '[0-9]*',
              maxLength: PAIRING_CODE_LENGTH,
              placeholder: t('pairCodePlaceholder'),
              value: code,
              disabled: busy,
              onChange: (event) => setCode(event.target.value.replace(/\D/g, '').slice(0, PAIRING_CODE_LENGTH)),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && code.length === PAIRING_CODE_LENGTH && !busy) void submit()
              },
            }),
            h('button', {
              type: 'button',
              className: 'wc-button wc-button--primary',
              disabled: busy || code.length !== PAIRING_CODE_LENGTH,
              onClick: () => void submit(),
            }, t('pairBind'))),
          seconds === undefined
            ? null
            : h('div', { className: 'wc-countdown' }, t('pairCountdown', { s: seconds })),
          h('div', { className: 'wc-actions' },
            h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: cancel }, t('cancel'))))
      }
      if (state === 'approved') {
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-hint' }, t('pairApprovedHint')),
          h('div', { className: 'wc-actions' },
            h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: cancel }, t('cancel'))))
      }
      if (state === 'created' && !expired) {
        // 二维码 + 倒计时已经说明「等手机扫」，不再重复一行「等待扫码」。
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-qr-wrap' },
            h(QrCode, { url: view.qrPayload, size: 176, label: t('tabPair') })),
          h('div', { className: 'wc-hint' }, t('pairScanHint')),
          seconds === undefined
            ? null
            : h('div', { className: 'wc-countdown' }, t('pairCountdown', { s: seconds })),
          h('div', { className: 'wc-actions' },
            h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: start }, t('refresh')),
            h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: cancel }, t('cancel'))))
      }
      // 两个 tab 都不再写状态行：二维码、蒙层、倒计时、信息行和主按钮已经把状态说完了。
      return h('div', { className: 'wc-body' },
        h('div', { className: 'wc-hint' }, terminal ? t('pairTerminalHint') : t('pairIdleHint')),
        h('div', { className: 'wc-actions' },
          h('button', {
            type: 'button',
            className: 'wc-button wc-button--primary',
            disabled: busy,
            onClick: start,
          }, terminal ? t('pairRegenerate') : t('pairGenerate'))),
        state === undefined || state === 'idle' || terminal
          ? h(ServerRow, {
            serverUrl: value.serverUrl ?? view?.serverUrl,
            busy,
            onSave: (next) => pairing.setServer(next),
          })
          : null)
    })()

    return h('div', { className: 'wc-tabview' },
      body,
      value.error === undefined
        ? null
        : h('div', { className: 'wc-body' },
          h('div', { className: 'wc-error' }, t('pairError', {
            code: value.error.code,
            reason: value.error.message,
          })),
          value.error.conflict === true
            ? h('div', { className: 'wc-hint' }, t('pairConflictHint'))
            : null,
          value.error.conflict === true
            ? h('div', { className: 'wc-actions' },
              h('button', {
                type: 'button',
                className: 'wc-button wc-button--primary',
                disabled: busy,
                onClick: () => void pairing.unbind(),
              }, t('pairUnbind')))
            : null))
  }

  /**
   * 弹出卡片。位置由触发按钮的 boundingRect 与卡片的**实测**尺寸共同决定：
   * 卡片长在按钮**上方**，横向从按钮的**右边缘**起（见 position.js），上方放不下才翻到下方。
   *
   * 为什么不能在渲染前一次算定：卡片高度随登录状态变化（未连接 187px、二维码 430px），
   * 用估计值定位必然在某个状态下错位。所以先渲染、再用 `useLayoutEffect` 量回来重排，
   * 并在打开期间用 ResizeObserver 跟随内容高度变化。
   *
   * 开关完全由入口按钮的点击决定（不再跟随 hover）：两个 tab 的内容高度不同，
   * 指针在卡片外一移动就收起会很别扭。`closing` 只负责退出动画期间的渲染。
   */
  function Popover({ anchor, closing, onClose }) {
    const value = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    const [busy, setBusy] = useState(false)
    const [localError, setLocalError] = useState(undefined)
    const nodeRef = useRef(null)
    const [box, setBox] = useState(undefined)
    const [viewport, setViewport] = useState(readViewport)
    // 两个入口：手机配对（默认，新能力）与原有微信 ClawBot。
    const [tab, setTab] = useState('pair')

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

    // 首帧还没有实测尺寸（box === undefined），placePopover 会按 0×0 退化，
    // 随后 useLayoutEffect 在**同一次提交内**量到真实盒子并重排，所以看不到中间态。
    const style = useMemo(() => {
      const { left, top, maxHeight } = placePopover({ anchor, size: box, viewport })
      return { left, top, maxHeight, overflowY: 'auto' }
    }, [anchor, box, viewport])

    // 量卡片自身的盒子。用 ResizeObserver 而不是只在挂载时量一次：
    // 登录状态切换会换掉整段 body，卡片高度随之变化（187px ↔ 430px），位置必须跟着重算。
    useLayoutEffect(() => {
      const node = nodeRef.current
      if (node === null) return undefined
      const measure = () => {
        const rect = node.getBoundingClientRect()
        setBox((prev) => (prev !== undefined && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }))
      }
      measure()
      if (typeof ResizeObserver !== 'function') return undefined
      const observer = new ResizeObserver(measure)
      observer.observe(node)
      return () => observer.disconnect()
    }, [])

    // 视口尺寸也要跟随：窗口缩放后夹紧值就变了。
    useEffect(() => {
      const onResize = () => setViewport(readViewport())
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [])

    const state = value.state
    const connected = value.connected === true
    const error = localError ?? value.error ?? value.credentialError

    const clawBody = (() => {
      if (connected) {
        return h(Connected, {
          value,
          busy,
          degraded: state === 'reconnecting',
          onLogout: () => run(async () => {
            await connection.logout()
          }),
          onReconnect: () => run(async () => {
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
      if (state === 'waiting_qr' || state === 'scanned' || state === 'requesting' || state === 'expired') {
        return h(Waiting, {
          value,
          busy,
          onRefresh: () => run(() => connection.startLogin({ force: true })),
          onCancel: () => run(() => connection.cancelLogin()),
        })
      }
      return h(Disconnected, {
        busy,
        onConnect: () => run(() => connection.startLogin()),
      })
    })()

    return h('div', {
      ref: nodeRef,
      className: closing ? 'wc-popover wc-popover--closing' : 'wc-popover',
      style,
      role: 'dialog',
      'aria-label': t('title'),
    }, h('div', { className: 'wc-head' },
      h('div', { className: 'wc-head__text' },
        h('div', { className: 'wc-title' }, t('title')),
        h('div', { className: 'wc-subtitle' }, t('subtitle'))),
      h('button', {
        type: 'button',
        className: 'wc-close',
        'aria-label': t('close'),
        title: t('close'),
        onClick: onClose,
      }, h(CloseIcon))),
    h(TabBar, { tab, onTab: setTab }),
    // 两个 tab 的错误互不影响：微信的错误只在微信 tab 里显示，配对错误由 PairingTab 自己渲染。
    tab !== 'claw' || error === undefined
      ? null
      : h('div', { className: 'wc-error' }, t('failed', { reason: error })),
    h('div', {
      className: 'wc-tabpanel',
      id: 'wc-tabpanel',
      role: 'tabpanel',
      'aria-labelledby': `wc-tab-${tab}`,
    }, tab === 'pair' ? h(PairingTab, { active: true }) : clawBody))
  }

  /**
   * 账户行里的入口：只有一个图标按钮，状态用右上角小圆点表示。
   * 点击开关卡片（和宿主侧栏按钮一样），打开期间按钮保持选中底色；
   * 卡片飞出/收起各有一段短动画。
   */
  function RemoteEntry() {
    const [open, setOpen] = useState(false)
    const [closing, setClosing] = useState(false)
    const [anchor, setAnchor] = useState(undefined)
    const triggerRef = useRef(null)
    const closeTimer = useRef(undefined)

    const value = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    // 失败/重连态优先：这两种情况下凭据还在（connected 仍为 true），若让 connected 先决，
    // 圆点会停在 ok —— 掉线时用户永远看不出通道已经断了（B17 实测 + 被顶号场景）。
    const state = value.state === 'failed' || value.state === 'reconnecting'
      ? value.state
      : value.connected ? 'connected' : value.state
    // 小圆点跟随真实连接状态；面板开不开都不影响它（见 model.js 里 close() 的注释）。
    const tone = toneOf(state)

    // 首次挂载同步一次状态，让没打开过面板时小圆点也是准的。
    useEffect(() => {
      void connection.refresh()
      return () => clearTimeout(closeTimer.current)
    }, [])

    const sampleAnchor = useCallback(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      setAnchor(rect === undefined || rect === null
        ? undefined
        : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
    }, [])

    const openNow = useCallback(() => {
      clearTimeout(closeTimer.current)
      closeTimer.current = undefined
      setClosing(false)
      sampleAnchor()
      setOpen(true)
    }, [sampleAnchor])

    // 打开期间按钮可能被滚走或窗口被缩放（侧栏可折叠、窗口可改大小）。
    // 锚点只在打开那一刻采样一次的话，卡片就留在原地与按钮脱开，所以要跟着重采。
    useEffect(() => {
      if (!open) return undefined
      const onMove = () => sampleAnchor()
      // scroll 不冒泡，用捕获阶段才能听到侧栏内部滚动。
      window.addEventListener('scroll', onMove, true)
      window.addEventListener('resize', onMove)
      return () => {
        window.removeEventListener('scroll', onMove, true)
        window.removeEventListener('resize', onMove)
      }
    }, [open, sampleAnchor])

    // 收起：先挂上 closing 播退出动画，等动画结束再真正卸载。
    // 动画期间再次点击按钮会走 openNow()，清掉定时器后回到展开态。
    const closeNow = useCallback(() => {
      clearTimeout(closeTimer.current)
      setClosing(true)
      closeTimer.current = setTimeout(() => {
        closeTimer.current = undefined
        setOpen(false)
        setClosing(false)
      }, PANEL_CLOSE_MS)
    }, [])

    // 点击卡片外部或入口按钮以外的地方时关闭。
    useEffect(() => {
      if (!open || closing) return undefined
      const onDown = (event) => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (triggerRef.current?.contains(target)) return
        if (target instanceof Element && target.closest('.wc-popover') !== null) return
        closeNow()
      }
      document.addEventListener('pointerdown', onDown, true)
      return () => document.removeEventListener('pointerdown', onDown, true)
    }, [open, closing, closeNow])

    const trigger = h('button', {
      ref: triggerRef,
      type: 'button',
      className: open ? 'wc-icon wc-icon--active' : 'wc-icon',
      'aria-haspopup': 'dialog',
      'aria-expanded': open && !closing,
      'aria-label': t('entryTitle'),
      title: t('entryTitle'),
      onClick: () => (open ? closeNow() : openNow()),
    },
    // 「显示器 + 手机」轮廓：扫码登录是在浏览器里操作，手机与屏幕的关系就是这个交互的形状。
    h('span', { className: 'wc-icon__glyph', 'aria-hidden': true },
      h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 18 18',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      // 显示器：圆角矩形 + 底座。
      h('rect', { x: 2.2, y: 3.2, width: 10.6, height: 7.6, rx: 1.6 }),
      h('path', { d: 'M6.5 13.2h3.4M7.6 10.8v2.4M9.4 10.8v2.4' }),
      // 手机：压在显示器右下角。
      h('rect', { x: 10.9, y: 8.6, width: 4.9, height: 6.6, rx: 1.3 }))),
    h('span', { className: 'wc-dot', 'data-state': tone, 'aria-hidden': true }))

    // 卡片是 portal 到 body 的，所以状态与关闭逻辑都挂在入口这一层。
    const popover = open
      ? portal(h(Popover, {
        anchor,
        closing,
        onClose: closeNow,
      }), document.body)
      : null

    return h('div', { className: 'wc-entry' }, trigger, popover)
  }

  return RemoteEntry
}
