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

/** 没有活动会话时的慢轮询：只为了知道手机连没连上、本机授权还有没有效。 */
export const PAIRING_IDLE_POLL_MS = 2500

/**
 * 宿主授权已失效的错误：服务器上这台电脑被移除了、token 失效或设备身份被占用。
 * 这类错误不会自己恢复，面板必须说清楚「要重新配对」，而不是假装没事。
 * （TRANSPORT_CLOSED / CONNECTION_FAILED 之类属于网络抖动，不算。）
 */
const AUTH_ERRORS = new Set([
  'DEVICE_REVOKED',
  'DEVICE_OWNERSHIP_REQUIRED',
  'AUTH_INVALID',
  'TOKEN_EXPIRED',
  'DEVICE_NOT_FOUND',
])

/**
 * 授权被移除后宿主会清掉本地凭据，下一次启动只剩 ACCOUNT_AUTH_REQUIRED；
 * 从未配对过的全新安装也是这个错误，所以还要靠 pairingHostOnly（配对授权留下的标记）
 * 区分「曾经绑过、现在失效」和「还没配过」。
 */
function authErrorOf(host) {
  const error = typeof host?.error === 'string' ? host.error : undefined
  if (error === undefined) return undefined
  if (AUTH_ERRORS.has(error)) return error
  if (error === 'ACCOUNT_AUTH_REQUIRED' && host?.pairingHostOnly === true) return error
  return undefined
}

/**
 * 最近一次配对成功的手机快照。配对会话记录过期后（服务端只保留到过期后 5 分钟），
 * 面板就再拿不到手机名/指纹了；本地留一份，重启后先按它显示，再用宿主状态
 * （凭据 / 授权 / connectedClients）验证这台手机还能不能连。
 */
const LAST_PAIRED_KEY = 'dsh-toolkit-remote/last-paired.v1'

/**
 * 插件自己的 host 路由：把本机落盘的 trusted-peers.json 读出来。
 * 配对会话记录过期、localStorage 又随端口换 origin 之后，只有它还记得手机是谁。
 */
const PLUGIN_API_PATH = '/api/plugins/dsh-toolkit/remote'

async function loadTrustedPeers(serverUrl) {
  if (typeof serverUrl !== 'string' || serverUrl.trim() === '') return []
  try {
    const response = await fetch(`${PLUGIN_API_PATH}/peers?serverUrl=${encodeURIComponent(serverUrl)}`, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (response.ok !== true) return []
    const body = await response.json()
    return Array.isArray(body?.peers) ? body.peers : []
  } catch {
    // 老版本插件没有这条路由：身份兜底失败不该影响配对本身。
    return []
  }
}

function storage() {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage
  } catch {
    return undefined
  }
}

function readLastPaired() {
  try {
    const raw = storage()?.getItem(LAST_PAIRED_KEY)
    if (typeof raw !== 'string' || raw === '') return undefined
    const parsed = JSON.parse(raw)
    if (typeof parsed?.deviceId !== 'string' || parsed.deviceId === '') return undefined
    return parsed
  } catch {
    return undefined
  }
}

function rememberPaired(view) {
  if (view?.state !== 'completed' || typeof view.mobile?.deviceId !== 'string') return undefined
  const snapshot = {
    deviceId: view.mobile.deviceId,
    ...view.mobile.name === undefined ? {} : { name: view.mobile.name },
    ...view.mobile.fingerprint === undefined ? {} : { fingerprint: view.mobile.fingerprint },
    ...view.serverUrl === undefined ? {} : { serverUrl: view.serverUrl },
    savedAt: Date.now(),
  }
  return savePaired(snapshot)
}

function savePaired(snapshot) {
  try {
    storage()?.setItem(LAST_PAIRED_KEY, JSON.stringify(snapshot))
  } catch {
    // 存不进去不影响配对本身，只是重启后少展示一份快照。
  }
  return snapshot
}

/** 解绑时忘掉这台手机：快照留着会让待机态假装它还连着。 */
function forgetPaired() {
  try {
    storage()?.removeItem(LAST_PAIRED_KEY)
  } catch {
    // 存储不可用不该影响解绑本身。
  }
}

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
    /** 首次状态读取是否已完成：用来避免面板先亮出「生成二维码」再翻成已连接。 */
    loaded: false,
    loading: false,
    busy: false,
    view: undefined,
    error: undefined,
    serverUrl: undefined,
    /**
     * 本机是否已经和当前服务器绑过：来自 settings.get 的 associations.host（落盘的 host 凭据）。
     * 配对会话记录只活到过期后 5 分钟，之后 host.pairing.status 返回 undefined；
     * 但「已绑定」这件事不会因为会话记录被回收而消失，所以不能只靠 status 判断。
     * undefined = 还没读到（老版本宿主可能没有 associations 字段）。
     */
    binding: undefined,
    /** 当前连着本机的设备（status.host.connectedClients），用于展示手机是否在线。 */
    clients: [],
    /** 最近一次配对成功的手机快照（本地持久化）：会话记录被回收后仍能显示它是谁。 */
    lastPaired: readLastPaired(),
    /**
     * 本机落盘的已信任手机（trusted-peers.json，经插件 host 路由读取）。
     * 快照缺失时（配对早于快照版本、或 localStorage 随端口换了 origin）用它兜底。
     */
    peers: [],
    /** 宿主授权已失效的错误码（见 AUTH_ERRORS）：有值时面板要给出「重新配对」的出口。 */
    authError: undefined,
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
      const paired = rememberPaired(view)
      set({
        view: view ?? undefined,
        loading: false,
        ...paired === undefined ? {} : { lastPaired: paired },
      })
      return view
    } catch (error) {
      const detail = fail(error)
      // 已绑定的机器上，账号冲突只说明「屏幕上这张会话记录过期了」，绑定本身有效。
      // 画成红字会和上面的已绑定卡自相矛盾（用户报过「上面显示成功、下面显示失败」）。
      const ignored = detail.conflict === true && value.binding === true
      set({ error: ignored ? undefined : detail, loading: false, ...ignored ? { halted: true } : {} })
      return undefined
    }
  }

  async function settings() {
    try {
      const view = await control('settings.get')
      const associations = view?.associations
      const host = associations?.host
      const nextServerUrl = view?.config?.serverUrl ?? value.serverUrl
      set({
        serverUrl: nextServerUrl,
        // 换了服务器，上一台的手机身份就不作数了。
        ...nextServerUrl === value.serverUrl ? {} : { peers: [] },
        // 宿主没给 associations 时保持 undefined（未知），不要误判成「未绑定」。
        ...associations === undefined || associations === null
          ? {}
          : { binding: host !== undefined && host !== null },
      })
      return view
    } catch {
      // 设置服务不可用时（例如极简宿主）不阻塞配对，只是不显示服务器地址。
      return undefined
    }
  }

  /**
   * 读宿主连接状态：`status.host` 里有 online / connectedClients。
   * 失败不影响配对（老版本宿主或极简宿主可能没有这个端点）。
   */
  async function hostStatus() {
    try {
      const status = await control('status')
      const host = status?.host
      if (host === undefined || host === null) return undefined
      const clients = Array.isArray(host.connectedClients) ? host.connectedClients : []
      set({ clients, authError: authErrorOf(host) })
      // 已绑定时顺手读一次本机 trusted peers：会话记录被回收后，手机名/指纹只剩这里还有。
      if (value.binding === true) {
        set({ peers: await loadTrustedPeers(value.serverUrl) })
      } else if (value.binding === false) {
        set({ peers: [] })
      }
      return host
    } catch {
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
      // 账号冲突只对「还没绑定」的机器有意义（本地存着别的账号、adopt 落不下来）。
      // 已经绑好的机器上，这类冲突来自一张过期的会话记录，绑定本身是好的——
      // 把它画成红字会变成「上面说已绑定、下面说配对失败」的自相矛盾画面。
      const ignored = detail.conflict === true && value.binding === true
      set({ error: ignored ? undefined : detail, halted: detail.conflict === true })
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
      // 整段都算「读取中」：先读服务器地址、再读会话状态，读完才允许面板画生成按钮。
      set({ loading: true })
      try {
        // 每次都重读：绑定状态可能在另一个窗口里变过。
        await settings()
        const view = await refresh()
        await hostStatus()
        return view
      } finally {
        // 快照与会话/授权状态都读完了才算「可显示」：读之前只给转圈，避免先亮出旧视图再翻牌。
        set({ loading: false, loaded: true })
      }
    },

    refresh,
    settings,
    hostStatus,

    async start() {
      return run(async () => {
        const view = await control('host.pairing.start')
        // 上一轮留下的授权失效已经和这次配对无关了：不清掉的话，配对一完成
        // （view 变成 completed、不再是「进行中」）那面红字卡会先闪一下再被下一次
        // hostStatus 抹掉，用户看到的就是「扫码后先报错、再变已绑定」。
        set({ view, authError: undefined })
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
        if (next?.state === 'completed') {
          // 配对成功就证明当前授权是好的，别让上一轮的错误卡再跳出来；
          // 同时把手机名/指纹落一份，重启后会话记录被回收也能显示它是谁。
          const paired = rememberPaired(next)
          set({ view: next, authError: undefined, ...paired === undefined ? {} : { lastPaired: paired } })
        } else {
          set({ view: next })
        }
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
     * 解绑当前服务器上的账号。
     * `settings.logout` 会清掉 host/client 两侧的凭据存储（服务器据此撤销两侧设备）。
     * `restart: true` 表示「更换手机」：解绑后立刻开一张新二维码，省得用户再点一次。
     */
    async unbind({ restart = false } = {}) {
      return run(async () => {
        // 先解绑本地凭据；远端注销失败（旧 token 已失效时常见）不影响本地清理，
        // 否则会在解绑成功后误报一个 AUTH_INVALID。
        try {
          await control('settings.logout')
        } catch {
          // 凭据已被清空，继续重读配对状态。
        }
        set({ view: undefined, halted: false })
        // 解绑是「忘掉这台手机」：本地快照与 trusted-peers 兜底缓存都清掉，
        // 否则待机态还会把已经解除的手机名/指纹画回来。
        forgetPaired()
        set({ lastPaired: undefined, peers: [] })
        await settings()
        const next = await refresh()
        if (next !== undefined && next !== null) return next
        if (value.error !== undefined) return undefined
        if (!restart) return undefined
        // 「更换手机」：解绑会连会话一起清掉，直接开一张新二维码给下一台手机。
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
