/**
 * 把 DSH 的审批请求（approval/request）转发到微信，并把用户的回复翻译成审批结论。
 *
 * 为什么需要它：微信是一条异步的、可能延迟很久的通道，
 * 而 approval/request 是同步 waterfall —— 必须返回一个结论。
 * 因此这里用「挂起 + 等待回复 + 超时取消」的方式桥接：
 *   · 一个用户同时只允许一个待审批请求（第二个直接拒绝，避免串台）；
 *   · 超时（默认 120s）返回 'cancelled'，让 Agent 侧的这次调用干净地结束；
 *   · 结论只能是 allowed-once / rejected / cancelled / unavailable 之一。
 */

const DEFAULT_TIMEOUT_MS = 120_000

const APPROVE_WORDS = new Set(['/approve', 'approve', 'allow', '/allow', 'y', 'yes', 'ok', '允许', '同意', '好'])
const REJECT_WORDS = new Set(['/reject', 'reject', 'deny', '/deny', 'n', 'no', '拒绝', '不同意', '不允许'])

/** 把用户回复归类为允许/拒绝；不是审批回答时返回 undefined。 */
export function parseApprovalAnswer(text) {
  const value = typeof text === 'string' ? text.trim().toLowerCase() : ''
  if (value === '') return undefined
  if (APPROVE_WORDS.has(value)) return 'allowed-once'
  if (REJECT_WORDS.has(value)) return 'rejected'
  return undefined
}

/** 工具名，缺省给个能读的占位。 */
function toolNameOf(request) {
  return typeof request?.toolName === 'string' && request.toolName !== '' ? request.toolName : '未知工具'
}

/**
 * 审批请求发到微信时的提示文案。
 *
 * 带上会话 id：DSH 里同时可能开着多个会话，收到「需要授权」时必须知道
 * 这是哪一条会话在等 —— 否则回 /approve 就是在盲批。
 * @param {object} request approval/request 的载荷
 * @param {{ sessionId?: string }} [context] 发起请求的会话
 */
export function approvalPrompt(request, context = {}) {
  const tool = toolNameOf(request)
  const reason = typeof request?.reason === 'string' && request.reason.trim() !== '' ? request.reason.trim() : ''
  const sessionId = typeof context?.sessionId === 'string' ? context.sessionId.trim() : ''
  return [
    ...(sessionId === '' ? [] : [`会话：${sessionId}`]),
    `【需要授权】工具「${tool}」请求执行。`,
    ...(reason === '' ? [] : [`原因：${reason}`]),
    '回复 /approve 允许一次，回复 /reject 拒绝（120 秒内有效）。',
  ].join('\n')
}

/**
 * @param options.notify (userId, text) => Promise<void>：把提示发到微信
 * @param options.onSettled (userId, outcome) => void：可选，用于面板/日志
 */
export function createApprovals({ notify, logger, timeoutMs = DEFAULT_TIMEOUT_MS, onSettled } = {}) {
  /** userId → { resolve, timer, request, sessionId } */
  const pending = new Map()

  function settle(userId, outcome) {
    const entry = pending.get(userId)
    if (entry === undefined) return false
    pending.delete(userId)
    clearTimeout(entry.timer)
    entry.resolve(outcome)
    try {
      onSettled?.(userId, outcome)
    } catch {
      // 通知失败不影响审批结论。
    }
    return true
  }

  return {
    /** 是否有待审批请求（用于把用户的下一条消息优先解释成审批回答）。 */
    hasPending(userId) {
      return pending.has(userId)
    },

    /**
     * 处理一条 approval/request：发微信询问并等待回复。
     * @returns Promise<'allowed-once'|'rejected'|'cancelled'|'unavailable'>
     */
    async request(userId, request, context = {}) {
      const sessionId = typeof context?.sessionId === 'string' ? context.sessionId.trim() : ''
      const current = pending.get(userId)
      if (current !== undefined) {
        logger?.warn?.('[weixin-clawbot] 同一用户已有待审批请求，直接拒绝新的请求')
        // 不能静默丢弃：否则用户会以为「刚那次」被处理了。把两条都点名。
        void notify?.(
          userId,
          [
            `同一时间只支持一个待审批：已自动拒绝「${toolNameOf(request)}」的请求（会话 ${sessionId === '' ? '未知' : sessionId}）。`,
            `仍在等待的是「${toolNameOf(current.request)}」（会话 ${current.sessionId === '' ? '未知' : current.sessionId}）：回复 /approve 或 /reject。`,
          ].join('\n'),
        )?.catch?.(() => {})
        return 'rejected'
      }
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(userId)
          logger?.info?.('[weixin-clawbot] 审批等待超时，按取消处理')
          try {
            onSettled?.(userId, 'cancelled')
          } catch {
            // ignore
          }
          resolve('cancelled')
        }, timeoutMs)
        timer.unref?.()
        pending.set(userId, { resolve, timer, request, sessionId })
      })
      try {
        await notify?.(userId, approvalPrompt(request, { sessionId }))
      } catch (error) {
        logger?.warn?.(`[weixin-clawbot] 发送审批提示失败：${error instanceof Error ? error.message : String(error)}`)
        settle(userId, 'unavailable')
        return 'unavailable'
      }
      return promise
    },

    /**
     * 用户回复了一条消息：若它是对待审批请求的回答，返回 true 并结束等待。
     * @returns {boolean} 是否消费了这条消息
     */
    answer(userId, text) {
      if (!pending.has(userId)) return false
      const outcome = parseApprovalAnswer(text)
      if (outcome === undefined) return false
      settle(userId, outcome)
      return true
    },

    /** 这个用户当前待审批的是哪条会话（没有则 undefined）。 */
    pendingSessionOf(userId) {
      return pending.get(userId)?.sessionId
    },

    /** 待审批请求数（状态接口用）。 */
    size() {
      return pending.size
    },

    /** 模块卸载：所有挂起请求按取消处理。 */
    dispose() {
      for (const userId of [...pending.keys()]) settle(userId, 'cancelled')
    },
  }
}
