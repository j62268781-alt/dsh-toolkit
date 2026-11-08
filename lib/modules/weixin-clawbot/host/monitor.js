/**
 * 常驻消息监听：登录成功后用 token 长轮询 getUpdates。
 *
 * 只在内存里保存游标（get_updates_buf），不落盘：
 *   - 落盘会让「换了 token / 重装」后的首次拉取跳过历史；
 *   - 本插件的定位是「证明通道通了」，不做消息持久化。
 *
 * 明确的取舍：getUpdates 是**消费型**接口，同一账号被两个消费者同时轮询会互相抢消息。
 * 因此只要本插件开着监听，别的桥接（例如 deepseek-harness-weixin）就拿不到同一条消息。
 * 该事实写进 README，并由 panel 的开关暴露给用户。
 */

import { getUpdates, summarizeMessage, STALE_TOKEN_CODE } from './ilink.js'

const DEFAULT_TIMEOUT_MS = 40_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 120_000
const RETRY_DELAY_MS = 1_500
const STALE_PAUSE_MS = 30_000

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    resolve()
  }, { once: true })
})

/**
 * 创建一个监听器。
 * @param options.getCredential 每次操作前重新解析凭据（凭据可能被换掉）。
 * @param options.onMessage 收到消息时回调，参数是脱敏摘要。
 * @param options.logger 宿主 logger；只记录诊断，不记录消息正文与 token。
 */
export function createMonitor({ getCredential, onMessage, logger, onStateChange = () => {} }) {
  let controller
  let running = false
  let state = { running: false, connected: false, lastError: undefined, received: 0 }

  const setState = (patch) => {
    state = { ...state, ...patch }
    try {
      onStateChange(state)
    } catch {
      // 状态回调失败不影响监听。
    }
  }

  async function loop(signal) {
    let cursor = ''
    let timeoutMs = DEFAULT_TIMEOUT_MS
    let failures = 0
    while (!signal.aborted) {
      let credential
      try {
        credential = await getCredential()
      } catch (error) {
        credential = undefined
      }
      if (credential === undefined) {
        setState({ connected: false, lastError: '未找到微信凭据' })
        await sleep(RETRY_DELAY_MS, signal)
        continue
      }
      try {
        const response = await getUpdates({
          baseUrl: credential.baseUrl,
          token: credential.token,
          cursor,
          timeoutMs,
          signal,
        })
        if (signal.aborted) return
        const code = Number(response?.errcode ?? response?.ret ?? 0)
        if (code !== 0) {
          if (code === STALE_TOKEN_CODE) {
            // token 会话超时：不是永久失效，暂停后重试即可。
            setState({ connected: false, lastError: '微信会话暂时超时，稍后自动重试' })
            failures = 0
            await sleep(STALE_PAUSE_MS, signal)
            continue
          }
          failures += 1
          setState({ lastError: `getUpdates 返回错误码 ${code}` })
          await sleep(Math.min(RETRY_DELAY_MS * failures, 15_000), signal)
          continue
        }
        failures = 0
        setState({ connected: true, lastError: undefined })
        const nextTimeout = Number(response?.longpolling_timeout_ms)
        if (Number.isFinite(nextTimeout) && nextTimeout > 0) {
          timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, nextTimeout))
        }
        const nextCursor = response?.get_updates_buf
        if (typeof nextCursor === 'string' && nextCursor !== '' && nextCursor !== cursor) cursor = nextCursor
        const messages = Array.isArray(response?.msgs) ? response.msgs : []
        for (const message of messages) {
          if (signal.aborted) return
          let summary
          try {
            summary = summarizeMessage(message)
          } catch (error) {
            logger?.warn?.('[weixin-clawbot] 解析消息失败：%s', String(error?.message ?? error))
            continue
          }
          setState({ received: state.received + 1 })
          try {
            onMessage(summary)
          } catch (error) {
            logger?.warn?.('[weixin-clawbot] 处理消息失败：%s', String(error?.message ?? error))
          }
        }
      } catch (error) {
        if (signal.aborted) return
        failures += 1
        setState({ connected: false, lastError: String(error?.message ?? error) })
        await sleep(Math.min(RETRY_DELAY_MS * failures, 15_000), signal)
      }
    }
  }

  return {
    getState: () => ({ ...state }),

    start() {
      if (running) return
      running = true
      controller = new AbortController()
      setState({ running: true, connected: false, lastError: undefined })
      void loop(controller.signal)
    },

    stop() {
      if (!running) return
      running = false
      controller?.abort()
      controller = undefined
      setState({ running: false, connected: false })
    },

    /** 单次探测（不常驻）：给「测试通道」按钮用。 */
    async probe({ timeoutMs = 10_000 } = {}) {
      let credential
      try {
        credential = await getCredential()
      } catch {
        credential = undefined
      }
      if (credential === undefined) throw new Error('未找到微信凭据，请先连接微信')
      const controllerOnce = new AbortController()
      const timer = setTimeout(() => controllerOnce.abort(), timeoutMs)
      try {
        const response = await getUpdates({
          baseUrl: credential.baseUrl,
          token: credential.token,
          cursor: '',
          timeoutMs,
          signal: controllerOnce.signal,
        })
        const code = Number(response?.errcode ?? response?.ret ?? 0)
        if (code !== 0 && code !== STALE_TOKEN_CODE) {
          return { ok: false, reason: `getUpdates 返回错误码 ${code}`, messages: 0 }
        }
        const messages = Array.isArray(response?.msgs) ? response.msgs : []
        for (const message of messages) {
          try {
            onMessage(summarizeMessage(message))
          } catch {
            // 探测只关心通道是否可用。
          }
        }
        return { ok: true, messages: messages.length }
      } catch (error) {
        // 长轮询超时视为「通道空闲但可用」。
        if (controllerOnce.signal.aborted) return { ok: true, messages: 0, idle: true }
        throw error
      } finally {
        clearTimeout(timer)
      }
    },

    dispose() {
      this.stop()
    },
  }
}
