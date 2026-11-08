/**
 * 扫码登录状态机（host 侧，单例，同一时刻只允许一个登录会话）。
 *
 * 设计要点：
 *   - 状态保存在内存里，不落盘；进程重启即失效（符合「不需要用户敲命令」的诉求）。
 *   - token 只在这个模块内存里短暂存在，确认后立刻写入 ctx.credentials，随后丢弃。
 *   - 前端通过 poll() 读取状态；poll 不产生副作用，不在 poll 里推进协议。
 *   - 协议推进由一个后台循环负责（advance），因此前端关闭面板不影响登录完成。
 *
 * 状态迁移：
 *   idle → requesting → waiting_qr ──scaned──→ scanned ──confirmed──→ confirmed(存凭据)
 *                            ↑                     │
 *                       need_code ─────────────────┘
 *                            └── expired（超过 QR_TTL_MS 没人扫）→ idle
 *
 * 关于「过期回 idle」而不是自动换码：二维码只在用户点了「连接微信」时才申请，
 * 有效期 120s（实测）。到点还没连上就说明用户走开了，此时继续轮换新码既没意义，
 * 又会让人再打开面板时看到一张陌生的码。所以直接回到未连接，等用户重新点。
 */

import {
  pollQrStatus,
  readCredential,
  redirectBaseUrl,
  requestQrCode,
  STALE_TOKEN_CODE,
} from './ilink.js'

/**
 * 二维码有效期。
 *
 * 这个数字是实测出来的，不是猜的：`get_qrcode_status` 首次长轮询约 30s 返回 `wait`，
 * 同一张码持续约 120s 后服务端返回 `expired`（两次独立实测都是 [30.6s] wait → [122.1s] expired）。
 * 服务端申请二维码的响应里没有任何 TTL 字段，所以客户端只能按实测值给倒计时。
 */
export const QR_TTL_MS = 120_000
const POLL_TIMEOUT_MS = 35_000
const MAX_NEED_CODE = 2
/** 未完成会话的兜底回收时间，防止用户关掉面板后状态永远停在 waiting。 */
const SESSION_GC_MS = 5 * 60_000

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(signal.reason instanceof Error ? signal.reason : new Error('已取消'))
  }, { once: true })
})

let sequence = 0

/**
 * 创建一个登录管理器。
 * @param options.credentials 宿主 credentials 服务（resolve/set/unset）。
 * @param options.credentialRef 凭据引用名。
 * @param options.logger 宿主 logger；只记录状态变化，绝不记录二维码 URL 或 token。
 * @param options.onConnected 登录成功回调（用于启动监听）。
 * @param options.onDisconnected 断开回调（用于停止监听）。
 */
export function createLoginManager({
  credentials,
  credentialRef,
  logger,
  onConnected = () => {},
  onDisconnected = () => {},
  now = () => Date.now(),
}) {
  let session
  let disposed = false

  const emitStatus = () => {
    const snapshot = publicStatus()
    if (snapshot.state !== session?.lastReported) {
      if (session !== undefined) session.lastReported = snapshot.state
      logger?.info?.('[weixin-clawbot] 登录状态：%s', snapshot.state)
    }
    return snapshot
  }

  /** 当前值得返回给前端的状态（脱敏，绝不含 token）。 */
  function publicStatus() {
    if (session === undefined) {
      return { state: 'idle', qrUrl: undefined, account: undefined, error: undefined, code: undefined }
    }
    return {
      state: session.state,
      loginId: session.id,
      qrUrl: session.qrUrl,
      expiresAt: session.expiresAt,
      // 脱敏账号信息：只给掩码后的 accountId 与 baseUrl 的 host。
      account: session.account === undefined
        ? undefined
        : { accountId: session.account.accountIdMasked, baseUrlHost: session.account.baseUrlHost },
      code: session.needCode ? { attempts: session.codeAttempts } : undefined,
      error: session.error,
      lastMessage: session.lastMessage,
    }
  }

  function reset(nextState) {
    if (session?.abort !== undefined && !session.abort.signal.aborted) session.abort.abort()
    session = {
      id: `login-${++sequence}`,
      state: nextState,
      abort: new AbortController(),
      startedAt: now(),
      lastReported: undefined,
    }
    return session
  }

  function fail(message) {
    if (session === undefined) return publicStatus()
    if (session.abort !== undefined && !session.abort.signal.aborted) session.abort.abort()
    session.state = 'failed'
    session.error = message
    session.qrUrl = undefined
    return emitStatus()
  }

  /**
   * 会话结束但不算错误：回到未连接。
   *
   * 用于「二维码过期没人扫」和「闲置太久」。这里刻意不用 fail()：过期不是故障，
   * 前端不该弹出红色错误条，用户重新点「连接微信」就好。
   */
  function settleIdle() {
    if (session === undefined) return publicStatus()
    if (session.abort !== undefined && !session.abort.signal.aborted) session.abort.abort()
    session.state = 'idle'
    session.error = undefined
    session.qrUrl = undefined
    session.qrId = undefined
    session.expiresAt = undefined
    session.expiredAt = undefined
    session.needCode = false
    session.account = undefined
    return emitStatus()
  }

  /**
   * 二维码到点没人扫：进入「已过期」态，保留这张码供前端画蒙版。
   *
   * 为什么不像以前那样直接回 idle：过期是用户看得见的一个状态（设计稿四态之一），
   * 卡片上要显示「过期二维码 + 蒙版 + 点击刷新」。回到 idle 会把二维码一起抹掉，
   * 用户只看到「未连接」，分不清是没开始还是刚才那张码过期了。
   */
  function settleExpired() {
    if (session === undefined) return publicStatus()
    if (session.abort !== undefined && !session.abort.signal.aborted) session.abort.abort()
    session.state = 'expired'
    session.error = undefined
    session.needCode = false
    // qrUrl / expiresAt 刻意保留：前端要靠它们渲染那张过期码。
    return emitStatus()
  }

  async function refreshQr(active) {
    const { id, url } = await requestQrCode({ localTokens: active.localTokens, signal: active.signal })
    if (disposed || session !== active) return
    active.qrId = id
    active.qrUrl = url
    active.expiresAt = now() + QR_TTL_MS
    active.expiredAt = now() + QR_TTL_MS
    active.state = 'waiting_qr'
    active.needCode = false
    active.codeAttempts = 0
    active.verifyCode = undefined
    emitStatus()
  }

  /**
   * 会话里是否已经有一张还能用的二维码。
   *
   * 复用是硬需求：用户可能反复把鼠标挪上按钮再挪开，每次都重新申请二维码既慢又会
   * 让手机上扫到的码在下一帧失效。只有到点之后才允许换新码。
   */
  function reusableQr(active) {
    if (active === undefined) return false
    if (active.state === 'confirmed' || active.state === 'failed') return false
    if (active.state === 'requesting' || active.state === 'idle') return false
    return active.qrUrl !== undefined && active.expiresAt !== undefined && active.expiresAt > now()
  }

  /**
   * 后台推进循环：轮询二维码 → 直到 confirmed 或过期。
   *
   * 二维码不在这里自动续期。有效期到点还没人扫，就停在「已过期」态：
   * 用户已经走开，继续换新码毫无意义，而且会让人下次打开时看到一张陌生的码；
   * 换新码由用户点「点击刷新」显式触发。
   */
  async function advance(active) {
    try {
      // 只有走到这里才会真的申请新码：start() 发现手里有未过期的码就直接复用了。
      await refreshQr(active)
      let scanned = false
      while (!disposed && session === active && !active.signal.aborted) {
        const remaining = active.expiredAt - now()
        if (remaining <= 0) {
          // 到期：进入「已过期」态并退出循环（刷新由用户点按钮触发）。
          return settleExpired()
        }
        let response
        try {
          response = await pollQrStatus({
            baseUrl: active.baseUrl,
            id: active.qrId,
            verifyCode: active.verifyCode,
            timeoutMs: Math.max(5_000, Math.min(POLL_TIMEOUT_MS, remaining)),
            signal: active.signal,
          })
        } catch (error) {
          if (active.signal.aborted || disposed) return
          // 网络抖动或服务端超时：退避后重试，不改变状态。
          logger?.warn?.('[weixin-clawbot] 二维码状态查询暂时失败，正在重试：%s', String(error?.message ?? error))
          await sleep(1_000, active.signal)
          continue
        }
        if (disposed || session !== active || active.signal.aborted) return

        const ret = Number(response?.ret ?? 0)
        if (ret !== 0 && response?.status === undefined) {
          return fail(`查询二维码状态失败：ret=${ret}`)
        }

        switch (response?.status) {
          case 'wait':
            break
          case 'scaned':
            if (!scanned) {
              scanned = true
              active.state = 'scanned'
              active.needCode = false
              emitStatus()
            }
            break
          case 'need_verifycode': {
            active.codeAttempts += 1
            if (active.codeAttempts > MAX_NEED_CODE) return fail('微信数字校验码多次错误，请重新发起登录')
            active.state = 'need_code'
            active.needCode = true
            emitStatus()
            // 等前端回传数字；submitCode 会写 active.verifyCode 并唤醒。
            await new Promise((resolve) => {
              const done = () => {
                active.signal.removeEventListener('abort', done)
                active.codeWaiter = undefined
                resolve()
              }
              active.codeWaiter = done
              active.signal.addEventListener('abort', done, { once: true })
            })
            if (disposed || session !== active || active.signal.aborted) return
            break
          }
          case 'scaned_but_redirect':
            active.baseUrl = redirectBaseUrl(response?.redirect_host)
            break
          case 'expired':
            // 服务端确认这张码作废（实测约 120s）。保留这张码，标记为已过期。
            return settleExpired()
          case 'verify_code_blocked':
            return fail('微信数字校验被暂时封禁，请稍后再试')
          case 'binded_redirect':
            return fail('这个微信账号已绑定其他实例，请先在微信里解除旧连接')
          case 'confirmed': {
            let credential
            try {
              credential = readCredential(response)
            } catch (error) {
              return fail(String(error?.message ?? error))
            }
            // token 只在此处流转：写入凭据后立刻丢弃明文引用。
            await credentials.set(credentialRef, JSON.stringify(credential))
            active.credentialToken = undefined
            active.state = 'confirmed'
            active.qrUrl = undefined
            active.account = {
              accountIdMasked: mask(credential.accountId),
              baseUrlHost: safeHost(credential.baseUrl),
            }
            active.baseUrl = credential.baseUrl
            active.credential = credential
            emitStatus()
            logger?.info?.('[weixin-clawbot] 微信授权成功，账号 %s', active.account.accountIdMasked)
            try {
              await onConnected(credential, active)
            } catch (error) {
              logger?.warn?.('[weixin-clawbot] 连接后处理失败：%s', String(error?.message ?? error))
            }
            return
          }
          default:
            return fail(`微信二维码服务器返回未知状态：${String(response?.status)}`)
        }
        await sleep(500, active.signal)
      }
    } catch (error) {
      if (disposed || active.signal.aborted) return
      fail(String(error?.message ?? error))
    }
  }

  return {
    /** 读取当前状态（无副作用）。 */
    status() {
      if (session !== undefined && session.state === 'waiting_qr'
        && session.expiredAt !== undefined && session.expiredAt <= now()) {
        // 二维码到点：立刻转「已过期」，不等后台循环下一轮（后台可能正卡在一次长轮询里）。
        settleExpired()
      }
      // 闲置太久：回到未连接，而不是报错——用户只是走开了，不算失败。
      if (session !== undefined && session.state !== 'confirmed'
        && session.state !== 'failed' && now() - session.startedAt > SESSION_GC_MS) {
        settleIdle()
      }
      return emitStatus()
    },

    /**
     * 发起登录（申请二维码）。
     *
     * @param options.localTokens 旧 token，供服务端判断是否同一账号。
     * @param options.force 丢弃手上还没过期的二维码，强制换新码。
     *   默认 false：只要会话里有一张未过期的码就复用它，避免每次打开面板都刷新，
     *   也让手机上正在扫的码不会突然失效。
     */
    async start({ localTokens = [], force = false } = {}) {
      if (disposed) throw new Error('插件已停止')
      // 复用未过期的二维码：直接把当前状态交回去，不重新申请。
      if (!force && reusableQr(session)) return publicStatus()
      const active = reset('requesting')
      active.localTokens = localTokens
      active.baseUrl = undefined
      active.verifyCode = undefined
      active.needCode = false
      active.codeAttempts = 0
      active.signal = active.abort.signal
      emitStatus()
      // 后台推进，start 立刻返回，前端随后轮询。
      void advance(active)
      // 等第一张二维码就绪，便于前端一次拿到 QR；超时交给轮询。
      const deadline = now() + 15_000
      while (now() < deadline && session === active && active.qrUrl === undefined && !active.signal.aborted) {
        if (active.state === 'failed') break
        await sleep(80)
      }
      return publicStatus()
    },

    /** 回传微信要求的数字校验码。 */
    submitCode(code) {
      const value = typeof code === 'string' ? code.trim() : ''
      if (session === undefined || session.state !== 'need_code') {
        throw new Error('当前没有等待校验码的登录会话')
      }
      if (!/^\d{2,8}$/.test(value)) throw new Error('校验码必须是 2-8 位数字')
      session.verifyCode = value
      session.needCode = false
      session.state = 'scanned'
      const wake = session.codeWaiter
      session.codeWaiter = undefined
      wake?.()
      return emitStatus()
    },

    /** 主动取消（面板关闭、用户点取消）。 */
    cancel() {
      if (session === undefined) return publicStatus()
      if (session.state === 'confirmed') {
        // 已确认的会话不能被 cancel 回退；它属于「已连接」。
        return emitStatus()
      }
      if (!session.abort.signal.aborted) session.abort.abort()
      session.state = 'idle'
      session.qrUrl = undefined
      return emitStatus()
    },

    /** 断开：清空凭据并停止监听。 */
    async logout() {
      const wasConnected = session?.state === 'confirmed'
      if (!session?.abort.signal.aborted) session?.abort.abort()
      try {
        await credentials.unset(credentialRef)
      } catch (error) {
        logger?.warn?.('[weixin-clawbot] 清除凭据失败：%s', String(error?.message ?? error))
      }
      session = undefined
      if (wasConnected) await onDisconnected()
      return publicStatus()
    },

    /** 记录最近一条消息（供 UI 显示，证明通道是通的）。 */
    recordMessage(summary) {
      if (session !== undefined) session.lastMessage = summary
    },

    dispose() {
      disposed = true
      if (session?.abort !== undefined && !session.abort.signal.aborted) session.abort.abort()
      session = undefined
    },
  }
}

/** 与 ilink.maskId 同规则，但此处独立实现以免循环依赖。 */
function mask(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return ''
  if (text.length <= 10) return '*'.repeat(text.length)
  return `${text.slice(0, 4)}${'*'.repeat(Math.min(6, text.length - 8))}${text.slice(-4)}`
}

function safeHost(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export { STALE_TOKEN_CODE }
