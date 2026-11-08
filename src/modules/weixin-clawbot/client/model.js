/**
 * Client 侧的状态模型：与宿主路由通信，并把登录状态摊平成 UI 可直接消费的形状。
 *
 * 约束：
 *   - 这里不持有 token，也不解析 token；服务端返回的账号信息已经是脱敏的。
 *   - 轮询只在面板打开时进行，关闭面板立即停止，避免常驻请求。
 *   - 所有失败都收敛成 { state: 'failed', error }，不向上抛，避免面板整块崩溃。
 */

export const API_PREFIX = '/api/plugins/dsh-toolkit/weixin-clawbot'

/** 前端状态机（与 host 的登录状态机一一对应，外加 closed）。 */
export const STATES = Object.freeze({
  closed: 'closed',
  idle: 'idle',
  requesting: 'requesting',
  waitingQr: 'waiting_qr',
  scanned: 'scanned',
  needCode: 'need_code',
  connected: 'connected',
  failed: 'failed',
})

const EMPTY = Object.freeze({
  state: 'idle',
  connected: false,
  account: undefined,
  qr: undefined,
  code: undefined,
  error: undefined,
  monitor: { enabled: false, running: false, connected: false, received: 0 },
  lastMessage: undefined,
  credentialRef: 'WEIXIN_CLAWBOT_CREDENTIAL',
})

/** 服务端载荷 → 前端状态。缺字段一律回落，不让单个缺失把面板变成错误页。 */
export function normalize(payload) {
  if (payload === null || typeof payload !== 'object') return { ...EMPTY }
  const account = payload.account
  const qr = payload.qr
  return {
    state: typeof payload.state === 'string' ? payload.state : 'idle',
    connected: payload.connected === true,
    account: account === null || typeof account !== 'object'
      ? undefined
      : (() => {
        const accountId = typeof account.accountId === 'string' ? account.accountId : ''
        const baseUrlHost = typeof account.baseUrlHost === 'string' ? account.baseUrlHost : ''
        if (accountId === '' && baseUrlHost === '') return undefined
        return { accountId: accountId || '—', baseUrlHost: baseUrlHost || '—' }
      })(),
    qr: qr === null || typeof qr !== 'object' || typeof qr.url !== 'string' || qr.url === ''
      ? undefined
      : {
        url: qr.url,
        expiresAt: Number.isFinite(qr.expiresAt) ? qr.expiresAt : undefined,
        loginId: typeof qr.loginId === 'string' ? qr.loginId : undefined,
      },
    code: payload.code !== null && typeof payload.code === 'object'
      ? { attempts: Number(payload.code?.attempts ?? 0) }
      : undefined,
    error: typeof payload.error === 'string' && payload.error !== '' ? payload.error : undefined,
    credentialError: typeof payload.credentialError === 'string' ? payload.credentialError : undefined,
    credentialRef: typeof payload.credentialRef === 'string' ? payload.credentialRef : EMPTY.credentialRef,
    monitor: {
      enabled: payload.monitor?.enabled === true,
      running: payload.monitor?.running === true,
      connected: payload.monitor?.connected === true,
      received: Number.isFinite(payload.monitor?.received) ? payload.monitor.received : 0,
      lastError: typeof payload.monitor?.lastError === 'string' ? payload.monitor.lastError : undefined,
    },
    lastMessage: payload.lastMessage !== null && typeof payload.lastMessage === 'object'
      ? {
        from: typeof payload.lastMessage.from === 'string' ? payload.lastMessage.from : '',
        text: typeof payload.lastMessage.text === 'string' ? payload.lastMessage.text : '',
        note: typeof payload.lastMessage.note === 'string' ? payload.lastMessage.note : undefined,
        receivedAt: Number.isFinite(payload.lastMessage.receivedAt) ? payload.lastMessage.receivedAt : undefined,
      }
      : undefined,
  }
}

/** 状态指示灯的分档：idle / busy / ok / bad。 */
export function toneOf(state) {
  switch (state) {
    case 'waiting_qr':
    case 'scanned':
    case 'need_code':
    case 'requesting':
      return 'busy'
    case 'connected':
    case 'confirmed':
      return 'ok'
    case 'failed':
      return 'bad'
    default:
      return 'idle'
  }
}

/**
 * 创建状态存储：可订阅、可触发拉取。
 * @param options.onError 传输层错误的回调（面板只在首次失败时提示）。
 */
export function createConnection({ onError = () => {} } = {}) {
  let value = { ...EMPTY, state: 'closed' }
  const listeners = new Set()
  let inflight
  let disposed = false

  const publish = (next) => {
    value = next
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 订阅者异常不影响其他订阅者。
      }
    }
  }

  async function request(path, { method = 'GET', json } = {}) {
    let response
    try {
      response = await fetch(`${API_PREFIX}/${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        ...(json === undefined ? {} : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(json),
        }),
      })
    } catch (error) {
      throw new Error(`连不上插件路由：${String(error?.message ?? error)}`)
    }
    let payload = {}
    try {
      payload = await response.json()
    } catch {
      payload = {}
    }
    if (!response.ok || payload?.ok === false) {
      throw new Error(String(payload?.error ?? `请求失败（HTTP ${response.status}）`))
    }
    return payload
  }

  /** 拉一次状态；并发调用共享同一个请求。 */
  function refresh() {
    if (inflight !== undefined) return inflight
    inflight = request('status')
      .then((payload) => {
        publish(normalize(payload))
        return value
      })
      .catch((error) => {
        onError(error)
        publish({ ...value, state: 'failed', error: String(error.message ?? error) })
        return value
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }

  /** 执行一个会改变状态的动作，并把结果直接写进存储。 */
  async function act(path, json) {
    try {
      const payload = await request(path, { method: 'POST', ...(json === undefined ? {} : { json }) })
      publish(normalize(payload))
      return value
    } catch (error) {
      publish({ ...value, state: value.connected ? value.state : 'failed', error: String(error.message ?? error) })
      throw error
    }
  }

  /**
   * 通道探测：响应体带 { ok, messages, idle }，不是状态快照，
   * 因此不能走 act（否则会把已连接状态冲成 idle）。快照单独合并。
   */
  async function probe() {
    try {
      const payload = await request('probe', { method: 'POST' })
      if (payload?.snapshot !== undefined) publish(normalize(payload.snapshot))
      return { ok: payload?.ok === true, messages: Number(payload?.messages ?? 0), idle: payload?.idle === true }
    } catch (error) {
      publish({ ...value, error: String(error.message ?? error) })
      throw error
    }
  }

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    /** 面板打开：读取当前状态。 */
    open() {
      if (disposed) return Promise.resolve(value)
      publish({ ...value, state: value.state === 'closed' ? 'idle' : value.state })
      return refresh()
    },
    /** 面板关闭：停掉本地状态，不再轮询。 */
    close() {
      publish({ ...value, state: 'closed' })
    },
    startLogin: () => act('login/start'),
    submitCode: (code) => act('login/code', { code }),
    cancelLogin: () => act('login/cancel'),
    logout: () => act('logout'),
    probe,
    setMonitor: (enabled) => act('monitor', { enabled }),
    dispose() {
      disposed = true
      value = { ...EMPTY, state: 'closed' }
      listeners.clear()
    },
  }
}

/** 轮询间隔：等待扫码时快一点，已连接时慢下来只同步监听状态。 */
export function pollInterval(state) {
  switch (state) {
    case 'waiting_qr':
    case 'scanned':
    case 'need_code':
    case 'requesting':
      return 1500
    case 'connected':
    case 'confirmed':
      return 6000
    default:
      return 0
  }
}
