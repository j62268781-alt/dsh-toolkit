/**
 * 微信（ClawBot / iLink）tab 的视图。
 *
 * 全部是纯展示组件，状态来自 client/wechat/model.js 的连接 store，动作由面板壳注入
 * （壳负责 busy 包装与错误提示）。依赖用参数传入而不是 import：这些组件要在
 * createPanel 闭包里拿到同一个 React 实例、同一个翻译函数与同一个二维码渲染器。
 */
export function createWechatViews({ React, t, useCountdown, QrCode }) {
  const { useEffect, useRef, useState } = React
  const h = React.createElement

  /**
   * 未连接：只留一个「连接微信」主按钮。
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
    const maskPanel = (title, action = undefined) => h('span', { className: 'wc-qr-mask__panel' },
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

  return { Disconnected, Waiting, NeedCode, Connected }
}
