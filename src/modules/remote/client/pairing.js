/**
 * 手机扫码配对：浏览器面板 → 本机 ds-harness-remote 的控制 RPC。
 *
 * 链路（桌面端）：
 *   1. `host.pairing.start` 让已加载的 ds-harness-remote host 插件向配对服务器
 *      申请一个 180 秒的会话，返回 `qrPayload`（DSH-Go 扫它）；
 *   2. 手机扫码、确认后会用手机身份 claim 会话并显示 8 位验证码；
 *   3. 用户在面板里输入验证码 → `host.pairing.confirm`；
 *   4. 服务器把双方设备登记到账号下，桌面端重连远程通道。
 *
 * 传输细节见 ds-harness-remote 的 control-route.ts：
 *   POST /ds-harness-remote/<endpoint>
 *   {type:'client-request', rpcId, method, payload}
 *   → {type:'server-response', rpcId, result:{ok:true,value}|{ok:false,error:{code,message}}}
 *
 * 这里不做轮询：轮询节奏由面板按当前会话状态决定（和微信面板一样，只在活动态走）。
 */

/** 与 ds-harness-remote 的本地控制路由前缀一致。 */
export const PAIRING_PREFIX = '/ds-harness-remote'

/** 配对会话轮询间隔：服务器侧状态变化（扫码/确认）通常在 1 秒内落库。 */
export const PAIRING_POLL_MS = 2500

/** 手机上进码固定 8 位（服务器只接受 /^[0-9]{8}$/）。 */
export const PAIRING_CODE_LENGTH = 8

/** 会话仍在推进的状态；只有这些状态值得轮询。 */
const ACTIVE_STATES = new Set(['created', 'claimed', 'approved'])

export function isPairingActive(view) {
  return view !== undefined && view !== null && ACTIVE_STATES.has(view.state)
}

/** 配对链路的错误：`code` 来自控制路由或远端服务器，`message` 是服务端原文。 */
export class PairingError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'PairingError'
    this.code = code
    this.details = details
  }
}

/**
 * 账号冲突：服务器上已经有这件设备绑定的旧账号，而本次配对发的是新账号。
 * ds-harness-remote 的 adoptPairing 会拒绝替换（PAIRING_ACCOUNT_CONFLICT），
 * 控制路由把它包成 `{code:'internal', details:{remoteCode}}`，所以两边都要认。
 */
export function isAccountConflict(error) {
  const remoteCode = error?.details?.remoteCode
  return remoteCode === 'PAIRING_ACCOUNT_CONFLICT'
    || /cannot replace the current account/i.test(String(error?.message ?? ''))
}

function newRpcId() {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 发一条控制 RPC；成功返回 `result.value`，失败抛 PairingError。 */
async function control(endpoint, payload = {}) {
  let response
  try {
    response = await fetch(`${PAIRING_PREFIX}/${endpoint}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: newRpcId(),
        method: endpoint,
        payload,
      }),
    })
  } catch (error) {
    throw new PairingError('CONTROL_UNREACHABLE', String(error?.message ?? error))
  }

  // 401/403 是宿主连接层的门（同源 cookie 失效），404 是插件没加载/没注册路由。
  if (response.status === 401 || response.status === 403) {
    throw new PairingError('CONTROL_UNAUTHORIZED', `HTTP ${response.status}`)
  }
  if (response.status === 404) {
    throw new PairingError('CONTROL_MISSING', 'ds-harness-remote control route is not mounted.')
  }
  if (!response.ok) {
    throw new PairingError('CONTROL_HTTP_ERROR', `HTTP ${response.status}`)
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new PairingError('CONTROL_INVALID_RESPONSE', 'control response is not JSON.')
  }

  const result = body?.result
  if (result?.ok === true) return result.value
  const code = typeof result?.error?.code === 'string' ? result.error.code : 'PAIRING_FAILED'
  const message = typeof result?.error?.message === 'string' ? result.error.message : 'pairing request failed.'
  throw new PairingError(code, message, result?.error?.details)
}

/**
 * 配对状态存储：面板与子视图共享一份（useSyncExternalStore）。
 * `view` 直接是 ds-harness-remote 的 HostPairingView；没有会话时为 undefined。
 */
export function createPairing() {
  let value = {
    loading: false,
    busy: false,
    view: undefined,
    error: undefined,
    serverUrl: undefined,
    /** 致命错误时停掉自动轮询：否则每 2.5 秒重试一次，错误行会不停闪。 */
    halted: false,
  }
  const listeners = new Set()

  const emit = () => {
    for (const listener of listeners) listener()
  }
  const set = (patch) => {
    value = { ...value, ...patch }
    emit()
  }
  const fail = (error) => ({
    code: typeof error?.code === 'string' ? error.code : 'PAIRING_FAILED',
    message: String(error?.message ?? error),
    conflict: isAccountConflict(error),
  })

  async function refresh() {
    // 账号冲突这类致命错误不自动重试：证据已经摆在面板上，等用户点「解绑并重试」。
    if (value.halted) return undefined
    set({ loading: value.view === undefined, error: undefined })
    try {
      const view = await control('host.pairing.status')
      set({ view: view ?? undefined, loading: false })
      return view
    } catch (error) {
      set({ error: fail(error), loading: false })
      return undefined
    }
  }

  async function settings() {
    try {
      const view = await control('settings.get')
      set({ serverUrl: view?.config?.serverUrl ?? value.serverUrl })
      return view
    } catch {
      // 设置服务不可用时（例如极简宿主）不阻塞配对，只是不显示服务器地址。
      return undefined
    }
  }

  async function run(work) {
    set({ busy: true, error: undefined })
    try {
      const result = await work()
      set({ halted: false })
      return result
    } catch (error) {
      const detail = fail(error)
      set({ error: detail, halted: detail.conflict === true })
      return undefined
    } finally {
      set({ busy: false })
    }
  }

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** 打开配对 tab：先读一次服务器地址，再读会话状态。 */
    async open() {
      if (value.serverUrl === undefined) await settings()
      return refresh()
    },

    refresh,
    settings,

    async start() {
      return run(async () => {
        const view = await control('host.pairing.start')
        set({ view })
        return view
      })
    },

    async confirm(code) {
      const view = value.view
      if (view === undefined || view === null) return undefined
      return run(async () => {
        const next = await control('host.pairing.confirm', {
          sessionId: view.sessionId,
          verificationCode: code,
        })
        set({ view: next })
        return next
      })
    },

    async cancel() {
      const view = value.view
      if (view === undefined || view === null) return undefined
      return run(async () => {
        const next = await control('host.pairing.cancel', { sessionId: view.sessionId })
        set({ view: next })
        return next
      })
    },

    /**
     * 解绑当前服务器上的账号并重试：
     * `settings.logout` 会清掉 host/client 两侧的凭据存储，之后重新读取会话状态，
     * 若手机上已经确认过（服务器侧 completed），adopt 就能落盘并完成配对。
     */
    async unbind() {
      return run(async () => {
        // 先解绑本地凭据；远端注销失败（旧 token 已失效时常见）不影响本地清理，
        // 否则会在解绑成功后误报一个 AUTH_INVALID。
        try {
          await control('settings.logout')
        } catch {
          // 凭据已被清空，继续重读配对状态。
        }
        set({ view: undefined, halted: false })
        await settings()
        const next = await refresh()
        if (next !== undefined || value.error !== undefined) return next
        // 解绑会连会话一起清掉，这时直接开一张新二维码，省得用户再点一次。
        const view = await control('host.pairing.start')
        set({ view })
        return view
      })
    },

    /** 改配对服务器地址（写入 ds-harness-remote 的 settings）。 */
    async setServer(serverUrl) {
      return run(async () => {
        await control('settings.server.set', { serverUrl })
        await settings()
        // 换服务器后旧会话属于旧服务器，直接清空让用户重新生成。
        set({ view: undefined })
        return undefined
      })
    },

    dispose() {
      listeners.clear()
    },
  }
}
