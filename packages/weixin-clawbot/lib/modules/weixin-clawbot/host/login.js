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
 *                            └── expired（自动换码，最多 MAX_QR_REFRESHES 次）→ failed
 */

import {
  pollQrStatus,
  readCredential,
  redirectBaseUrl,
  requestQrCode,
  STALE_TOKEN_CODE,
} from './ilink.js'

/** 二维码轮询在服务端约 30s 才返回，前端据此显示倒计时。 */
export const QR_TTL_MS = 60_000
const POLL_TIMEOUT_MS = 35_000
const MAX_QR_REFRESHES = 3
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

  /** 后台推进循环：申请二维码 → 轮询 → 直到 confirmed/failed。 */
  async function advance(active) {
    try {
      await refreshQr(active)
      let refreshes = 0
      let scanned = false
      while (!disposed && session === active && !active.signal.aborted) {
        const remaining = active.expiredAt - now()
        if (remaining <= 0 && active.state === 'waiting_qr') {
          refreshes += 1
          if (refreshes > MAX_QR_REFRESHES) return fail('二维码多次过期，请重新发起登录')
          active.localTokens = active.localTokens ?? []
          await refreshQr(active)
          scanned = false
          continue
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
            refreshes += 1
            if (refreshes > MAX_QR_REFRESHES) return fail('二维码多次过期，请重新发起登录')
            scanned = false
            await refreshQr(active)
            break
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
      // 会话闲置太久自动回收，避免 UI 卡在 waiting。
      if (session !== undefined && session.state !== 'confirmed'
        && session.state !== 'failed' && now() - session.startedAt > SESSION_GC_MS) {
        fail('登录已超时，请重新发起')
      }
      return emitStatus()
    },

    /** 发起一个新登录会话；会取消上一个未完成会话。 */
    async start({ localTokens = [] } = {}) {
      if (disposed) throw new Error('插件已停止')
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
