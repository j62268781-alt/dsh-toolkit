import {
  PAIRING_CODE_LENGTH,
  PAIRING_IDLE_POLL_MS,
  PAIRING_POLL_MS,
  isPairingActive,
} from './pairing.js'

/** 指纹按 4 字符分组，方便人眼比对（与 ds-harness-remote 自己的面板一致）。 */
function shortFingerprint(value) {
  if (typeof value !== 'string') return '—'
  // trusted-peers.json 里存的是上游的展示格式（'7F2C 4CE8 0A33'，带空格、可能大写、
  // 长度也不固定）；会话记录给的是 64 位十六进制。统一去掉空白再分组，别让空格错位。
  const compact = value.replace(/\s+/g, '').toLowerCase()
  if (compact === '') return '—'
  return (compact.slice(0, 16).match(/.{1,4}/g) ?? []).join(' ')
}

// 连接方式（宿主 status 里的 mode）：LAN/P2P/TURN/Relay 决定这条链路的快慢，
// 放在手机名后面当小标签，用户不用翻日志就知道走的是直连还是中继。
const MODE_KEYS = {
  LAN: 'pairModeLan',
  P2P: 'pairModeP2p',
  TURN: 'pairModeTurn',
  RELAY: 'pairModeRelay',
}

/**
 * 手机连接 tab 的全部 UI。
 *
 * 状态来自 mobile/pairing.js 的配对 store（浏览器里所有请求都打到本机上游控制路由），
 * 面板壳只负责把它放进 tab 与定位卡片，不掺和配对逻辑。
 * 组件定义在工厂闭包里只创建一次，避免每次渲染换掉组件类型、丢掉 hooks 状态。
 */
export function createPairingTab({ React, t, useCountdown, QrCode, pairing }) {
  const { useEffect, useRef, useState, useSyncExternalStore } = React
  const h = React.createElement

  function ModeTag({ mode }) {
    if (typeof mode !== 'string') return null
    const key = MODE_KEYS[mode.toUpperCase()]
    if (key === undefined) return null
    return h('span', { className: 'wc-tag', 'data-mode': mode.toUpperCase() }, t(key))
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
      // onSave 只在真的切换成功时才回 true。失败（例如新地址连不上、运行时重建失败）就留在
      // 编辑态：用户还能就地改地址重试，而不是被弹回只读行、只剩面板底部一行报错不知道点哪。
      void Promise.resolve(onSave(next)).then((saved) => {
        if (saved === true) setEditing(false)
      })
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
      }, busy ? t('pairServerSaving') : t('pairServerSave')),
      h('button', {
        type: 'button',
        className: 'wc-button wc-button--half',
        disabled: busy,
        onClick: () => setEditing(false),
      }, t('cancel')))
  }

  /**
   * 终态文案：同样是「本次配对结束」，原因却完全不同（超时/取消/验证码错/设备冲突/登记失败）。
   * 服务端的 status 响应带 `failureReason`，按它分开说，才能让用户知道下一步该做什么。
   */
  function terminalHintKey(state, failureReason, expired) {
    if (expired === true || state === 'expired') return 'pairEndExpired'
    if (state === 'cancelled') return 'pairEndCancelled'
    if (state === 'failed') {
      switch (failureReason) {
        case 'verification_failed': return 'pairEndCodeWrong'
        case 'PAIRING_NOT_CLAIMED': return 'pairEndNotClaimed'
        case 'PAIRING_DEVICE_CONFLICT': return 'pairEndDeviceConflict'
        default: return 'pairEndFailed'
      }
    }
    return 'pairTerminalHint'
  }

  /**
   * 授权失效的原因文案：被服务器移除和 token 过期给用户看的下一步不一样，
   * 但都指向「重新配对」。
   */
  function authErrorKey(code) {
    if (code === 'DEVICE_REVOKED') return 'pairAuthRevoked'
    if (code === 'DEVICE_OWNERSHIP_REQUIRED') return 'pairAuthOwnership'
    if (code === 'ACCOUNT_AUTH_REQUIRED') return 'pairAuthRevoked'
    if (code === 'TOKEN_EXPIRED' || code === 'AUTH_INVALID') return 'pairAuthInvalid'
    return 'pairAuthFailed'
  }

  /**
   * 配对错误行文案。
   *
   * 限流（429）与服务器会话打满时，上游给的是固定英文
   * "Pairing failed; recover the original submission if sent."，把 code + 原文一起画出来
   * 等于没解释（真机连点「重新生成二维码」后看到的就是这个）。这类错误码换成人话＋下一步，
   * 其余仍保留原始 code/reason，方便定位。
   */
  function pairErrorText(error) {
    if (error.code === 'RATE_LIMITED') return t('pairRateLimited')
    if (error.code === 'PAIRING_BUSY') return t('pairServerBusy')
    // 上一次服务器切换还没走完又点保存，上游直接拒绝（见 control-runtime.js 的 setServer）。
    if (error.code === 'SERVER_SWITCH_BUSY') return t('pairSwitchBusy')
    return t('pairError', { code: error.code, reason: error.message })
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
    // 重新配对/解除绑定都是破坏性动作（会先把服务器上的旧绑定撤销掉），先就地确认一次。
    // 取值 null | 'repair' | 'unbind'。
    const [confirmAction, setConfirmAction] = useState(null)
    const codeRef = useRef(null)
    const seconds = useCountdown(view?.expiresAt)
    // 限流冷却（store 里 429 后设的 60 秒窗口）：按钮禁用 + 倒计时，连点不再发请求。
    const cooldown = useCountdown(value.cooldownUntil)
    const cooling = cooldown !== undefined && cooldown > 0

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

    // 一直盯着宿主状态：手机连上来、授权被移除都可能在任何时候发生（包括已经
    // completed、本地还留着会话记录的时候）。窗口重新可见/拿回焦点时立刻补查一次。
    useEffect(() => {
      if (!active || value.halted) return undefined
      const check = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void pairing.hostStatus()
      }
      const timer = setInterval(check, PAIRING_IDLE_POLL_MS)
      const onVisible = () => check()
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onVisible)
      return () => {
        clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', onVisible)
      }
    }, [active, state, value.halted])

    // 本地倒计时归零等价于「这张二维码已经不能用了」，状态文案要立刻改口。
    const expired = state === 'created' && seconds === 0
    const terminal = state === 'failed' || state === 'cancelled' || state === 'expired' || expired
    const failureReason = typeof view?.failureReason === 'string' && view.failureReason !== ''
      ? view.failureReason
      : undefined
    const terminalHint = terminalHintKey(state, failureReason, expired)

    const start = () => void pairing.start()
    const cancel = () => void pairing.cancel()
    const submit = async () => {
      const next = await pairing.confirm(code)
      if (next !== undefined) setCode('')
    }
    // 分支一变（配对完成、解绑成功、授权失效），确认态就该归零，别把红按钮留在新卡片上。
    useEffect(() => {
      setConfirmAction(null)
    }, [state, value.binding])

    const unbind = () => void pairing.unbind()
    const changePhone = () => void pairing.unbind({ restart: true })
    /**
     * 已绑定卡片的两个动作，区别只在终点：
     *   - 更换手机：撤销服务器上的旧设备，紧接着开一张新二维码（目标就是马上换一台）；
     *   - 解除绑定：撤销旧设备后停在未绑定状态，不替用户决定「现在就要配新手机」。
     * 两者都必须真的注销旧设备：上游 re-pair 会拿新账号去 adopt 旧凭据，
     * 直接撞 PAIRING_ACCOUNT_CONFLICT（用户报过的「重新配对就报错」）。
     */
    const confirming = confirmAction !== null
    const boundHint = (key) => h('div', { className: 'wc-hint' },
      t(confirmAction === 'unbind'
        ? 'pairUnbindConfirm'
        : confirmAction === 'change' ? 'pairChangeConfirm' : key))
    const boundActions = () => confirming
      ? h('div', { className: 'wc-actions wc-actions--full' },
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--half',
          disabled: busy,
          onClick: () => setConfirmAction(null),
        }, t('cancel')),
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--half wc-button--danger-solid',
          disabled: busy,
          onClick: confirmAction === 'change' ? changePhone : unbind,
        }, t(confirmAction === 'unbind' ? 'pairUnbindNowConfirm' : 'pairChangeNow')))
      : h('div', { className: 'wc-actions wc-actions--full' },
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--half',
          disabled: busy,
          onClick: () => setConfirmAction('change'),
        }, t('pairChangePhone')),
        h('button', {
          type: 'button',
          className: 'wc-button wc-button--half wc-button--danger',
          disabled: busy,
          onClick: () => setConfirmAction('unbind'),
        }, t('pairUnbindNow')))

    const body = (() => {
      // 首次状态还没读回来：先占住位置转圈。
      // 否则面板会先画「生成配对二维码」（未绑定态），再被真实的「手机已连接」替换，闪一下很难看。
      if (value.loaded !== true) {
        return h('div', { className: 'wc-body wc-pending', 'aria-busy': 'true' },
          h('div', { className: 'wc-spinner', 'aria-hidden': 'true' }))
      }
      // 「更换手机」：注销旧设备 → 清盘上残留 → 建新会话。中途 view 与 binding 都是空的，
      // 不拦住就会先掉回未绑定首页、再弹到二维码，看着像被踢出去又回来。
      if (value.renewing === true && !isPairingActive(view)) {
        return h('div', { className: 'wc-body wc-pending', 'aria-busy': 'true' },
          h('div', { className: 'wc-spinner', 'aria-hidden': 'true' }),
          h('div', { className: 'wc-hint' }, t('pairRenewing')))
      }
      // 授权失效优先于任何旧会话记录（哪怕本地还留着 completed，也必须画「授权失效」），
      // 但让位于正在进行的配对会话：用户点了「重新配对」后要能看到二维码/输入框。
      if (value.authError !== undefined && !isPairingActive(view)) {
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-error' }, t(authErrorKey(value.authError), { reason: value.authError })),
          h('div', { className: 'wc-actions' },
            h('button', {
              type: 'button',
              className: 'wc-button wc-button--primary',
              disabled: busy,
              onClick: start,
            }, t('pairAgain'))),
          h(ServerRow, {
            serverUrl: value.serverUrl,
            busy,
            onSave: (next) => pairing.setServer(next),
          }))
      }
      if (state === 'completed') {
        const liveClients = Array.isArray(value.clients) ? value.clients : []
        const live = liveClients.find((client) => client?.deviceId !== undefined && client.deviceId === view.mobile?.deviceId)
          ?? liveClients[0]
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-info' },
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairPhone')),
              h('span', { className: 'wc-info__value' }, view.mobile?.name ?? '—',
                h(ModeTag, { mode: live?.mode }))),
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairFingerprint')),
              h('span', { className: 'wc-info__value' }, shortFingerprint(view.mobile?.fingerprint))),
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairServer')),
              h('span', { className: 'wc-info__value wc-info__value--muted', title: view.serverUrl }, view.serverUrl ?? '—'))),
          boundHint('pairCompletedHint'),
          boundActions())
      }
      if (state === 'claimed') {
        // 说明和倒计时归一组，输入框独占一行，按钮再占一行：视线路径是「读说明 → 填码 → 提交」。
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-hintblock' },
            h('div', { className: 'wc-hint' }, view.mobile?.name === undefined
              ? t('pairClaimedHint')
              : t('pairClaimedHintNamed', { name: view.mobile.name })),
            seconds === undefined
              ? null
              : h('div', { className: 'wc-countdown' }, t('pairCountdown', { s: seconds }))),
          h('input', {
            ref: codeRef,
            className: 'wc-code__input wc-code__input--block',
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
          h('div', { className: 'wc-actions wc-actions--full' },
            h('button', {
              type: 'button',
              className: 'wc-button wc-button--primary wc-button--half',
              disabled: busy || code.length !== PAIRING_CODE_LENGTH,
              onClick: () => void submit(),
            }, t('pairBind')),
            h('button', {
              type: 'button',
              className: 'wc-button wc-button--half',
              disabled: busy,
              onClick: cancel,
            }, t('cancel'))))
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
            h('button', {
              type: 'button',
              className: 'wc-button',
              disabled: busy || cooling,
              onClick: start,
            }, cooling ? t('pairCooldownWait', { s: cooldown }) : t('refresh')),
            h('button', { type: 'button', className: 'wc-button', disabled: busy, onClick: cancel }, t('cancel'))))
      }
      // 没有活动会话，但本机已经和这台服务器绑过：配对记录被回收不代表掉线。
      // 这里必须画「已绑定」，否则每次 DSH 重启后都会假装没连过，诱导用户重复配对。
      if (state === undefined && value.binding === true) {
        const clients = Array.isArray(value.clients) ? value.clients : []
        const phone = clients.find((client) => typeof client?.name === 'string' && client.name.trim() !== '')
        // 会话记录过期后只剩本地快照：手机名/指纹来自最近一次配对成功时存下的那份，
        // 是否还能连由上面读到的宿主状态（binding/clients/authError）决定。
        const snapshot = value.lastPaired
        const last = snapshot === undefined
          || snapshot.serverUrl === undefined
          || value.serverUrl === undefined
          || snapshot.serverUrl === value.serverUrl
          ? snapshot
          : undefined
        // 最后一道兜底：本机 trusted-peers.json（host 只读路由读出来的 value.peers）。
        // 配对早于快照版本、或 localStorage 随端口换了 origin 时，只有它还记得手机是谁。
        const peers = Array.isArray(value.peers) ? value.peers : []
        const peer = peers.find((item) => typeof item?.fingerprint === 'string' && item.fingerprint.trim() !== '')
          ?? peers[0]
        const phoneName = phone?.name ?? last?.name ?? peer?.name ?? t('pairPhoneFallback')
        const fingerprint = last?.fingerprint ?? peer?.fingerprint
        return h('div', { className: 'wc-body' },
          h('div', { className: 'wc-info' },
            h('div', { className: 'wc-info__row' },
              h('span', { className: 'wc-info__key' }, t('pairPhone')),
              h('span', { className: 'wc-info__value' }, phoneName,
                h(ModeTag, { mode: clients[0]?.mode }))),
            fingerprint === undefined
              ? null
              : h('div', { className: 'wc-info__row' },
                h('span', { className: 'wc-info__key' }, t('pairFingerprint')),
                h('span', { className: 'wc-info__value' }, shortFingerprint(fingerprint)))),
          boundHint(value.clients.length > 0 ? 'pairBoundOnline' : 'pairBoundOffline'),
          boundActions(),
          h(ServerRow, {
            serverUrl: value.serverUrl,
            busy,
            onSave: (next) => pairing.setServer(next),
          }))
      }
      // 两个 tab 都不再写状态行：二维码、蒙层、倒计时、信息行和主按钮已经把状态说完了。
      return h('div', { className: 'wc-body' },
        h('div', { className: 'wc-hint' }, terminal
          ? t(terminalHint, { reason: failureReason ?? '—' })
          : t('pairIdleHint')),
        h('div', { className: 'wc-actions' },
          h('button', {
            type: 'button',
            className: 'wc-button wc-button--primary',
            disabled: busy || cooling,
            onClick: start,
          }, cooling
            ? t('pairCooldownWait', { s: cooldown })
            : terminal ? t('pairRegenerate') : t('pairGenerate'))),
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
          h('div', { className: 'wc-error' }, pairErrorText(value.error)),
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

  return { PairingTab }
}
