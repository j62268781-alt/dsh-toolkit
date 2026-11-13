/**
 * Host 半边：微信扫码登录（ClawBot / iLink）+ 双向消息桥。
 *
 * 职责边界：
 *   · 登录、通道自检，以及可选的「微信 ↔ DSH Agent」桥接（bridge.js）。
 *   · token 只经 ctx.credentials 存取，绝不进日志、绝不回前端。
 *   · 二维码 URL 是短生命周期凭据，只在 start() 的响应里回给前端，不打印。
 *
 * 路由（全部同源 fetch，无需 CORS）：
 *   GET  /api/plugins/dsh-toolkit/remote/status       当前状态（含 bridge）
 *   POST /api/plugins/dsh-toolkit/remote/login/start  发起扫码
 *   GET  /api/plugins/dsh-toolkit/remote/login/poll   前端轮询
 *   POST /api/plugins/dsh-toolkit/remote/login/code   回传数字校验码
 *   POST /api/plugins/dsh-toolkit/remote/login/cancel 取消扫码
 *   POST /api/plugins/dsh-toolkit/remote/logout       断开并清空凭据
 *   POST /api/plugins/dsh-toolkit/remote/probe        单次通道探测
 *   POST /api/plugins/dsh-toolkit/remote/monitor      开启/关闭常驻监听
 *   POST /api/plugins/dsh-toolkit/remote/bridge/test  发一条测试消息
 *   POST /api/plugins/dsh-toolkit/remote/bridge/access 改访问策略/白名单
 *   GET  /api/plugins/dsh-toolkit/remote/peers?serverUrl= 已信任手机的身份（重启后兜底）
 *   POST /api/plugins/dsh-toolkit/remote/local-state/purge?serverUrl= 解绑后清本机配对残留
 */

import { sendJson, readBody } from '../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../host/routes.js'
import { createBridge } from './bridge.js'
import { Config, DEFAULT_CREDENTIAL_REF, readConfig } from './config.js'
import { createLoginManager } from './login.js'
import { createMonitor } from './monitor.js'
import { maskId, normalizeBaseUrl } from './ilink.js'
import { readTrustedPeers } from './peers.js'
import { purgePairingState } from './local-state.js'

export const name = 'toolkit-remote'
/**
 * 登录只需要这三样；双向桥额外依赖的宿主服务在服务创建时用 `ctx.inject` 按需装载，
 * 这样缺服务时登录/二维码仍然可用，不会把整个模块卡在 pending。
 */
export const inject = ['webServer', 'connection', 'credentials']

/** 桥接需要的宿主服务。 */
const BRIDGE_SERVICES = [
  'agents',
  'agentDefaultModel',
  'agentPresets',
  'permissionPresets',
  'sessionPersistence',
  'attachments',
  'sessionTitle',
  'llm',
]

export const API_PATH = '/api/plugins/dsh-toolkit/remote'

/** 单条路由的最大请求体（这些接口只有小 JSON）。 */
const MAX_BODY = 4 * 1024

/**
 * 解析已保存的凭据。返回 undefined 表示未连接；格式错误时抛出可读错误。
 * 该函数是唯一把 token 读进内存的地方，调用方负责不把它泄露出去。
 */
export async function resolveCredential(credentials, credentialRef) {
  const resolved = await credentials.resolve(credentialRef)
  if (resolved === undefined) return undefined
  let parsed
  try {
    parsed = JSON.parse(resolved.value)
  } catch {
    throw new Error('已保存的微信凭据不是合法 JSON')
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('已保存的微信凭据不是对象')
  const token = typeof parsed.token === 'string' ? parsed.token.trim() : ''
  const accountId = typeof parsed.accountId === 'string' ? parsed.accountId.trim() : ''
  if (token === '' || accountId === '') throw new Error('已保存的微信凭据缺少 token 或 accountId')
  return {
    token,
    accountId,
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    ...(typeof parsed.userId === 'string' && parsed.userId.trim() !== '' ? { userId: parsed.userId.trim() } : {}),
  }
}

/** 已连接时对外暴露的脱敏账号信息。 */
export function publicAccount(credential) {
  if (credential === undefined) return undefined
  let host = ''
  try {
    host = new URL(credential.baseUrl).host
  } catch {
    host = ''
  }
  return { accountId: maskId(credential.accountId), baseUrlHost: host }
}

/** 面板/圆点该按哪个状态显示：凭据还在不代表通道还通。 */
export function deriveConnectionState({ connected, loginState, monitorState }) {
  if (connected !== true) return loginState?.state
  // 被别处登录顶掉后 token 会被服务端拒（getUpdates 回 -14），凭据却还在盘上。
  // 只看凭据会让面板一直显示「已连接」，实际上一条消息也进不来，用户毫无察觉。
  const broken = monitorState?.running === true
    && monitorState.connected === false
    && (monitorState.phase === 'stale' || monitorState.phase === 'invalid' || monitorState.phase === 'error')
  if (broken) return 'reconnecting'
  return loginState?.state === 'confirmed' ? 'confirmed' : 'connected'
}

export async function createClawbotService(ctx, config) {
  const settings = readConfig(config)
  const credentialRef = settings.credentialRef || DEFAULT_CREDENTIAL_REF
  const logger = typeof ctx.logger === 'function' ? ctx.logger('remote') : undefined

  let disposed = false
  let lastMessage
  let monitorEnabled = settings.monitorOnConnect

  /** 唯一读凭据的入口（登录、探测、桥接共用）。 */
  const getCredential = () => resolveCredential(ctx.credentials, credentialRef)

  /**
   * 双向桥：等宿主把 agents/llm/attachments 等服务装上之后再创建。
   * 桥不在时其他功能照常工作，status 里会说明原因。
   */
  let bridge
  ctx.inject(BRIDGE_SERVICES, (bridgeCtx) => {
    bridge = createBridge({ ctx: bridgeCtx, settings, getCredential, logger })
    logger?.info?.('[remote] 双向桥已装载')
    // 预热落盘状态：面板里的开关/策略/白名单一启动就要对上，而不是等第一条消息。
    void bridge.warmup()
  })

  const monitor = createMonitor({
    logger,
    getCredential,
    // 游标尽量持久化；桥还没装载时退化成空游标。
    cursorStore: {
      get: () => bridge?.cursor.get() ?? '',
      set: (value) => bridge?.cursor.set(value),
    },
    onMessage: (summary, rawMessage) => {
      lastMessage = summary
      login.recordMessage(summary)
      // 桥接自己处理异常并计数，这里不 await，避免拖住长轮询。
      void bridge?.handleMessage(rawMessage)
    },
  })

  const login = createLoginManager({
    credentials: ctx.credentials,
    credentialRef,
    logger,
    onConnected: async (credential, session) => {
      lastMessage = undefined
      if (session !== undefined) session.localTokens = []
      // 账号可能变了：桥接的 api/store 必须按新账号重建，再按新账号预热状态。
      bridge?.reset()
      void bridge?.warmup()
      if (monitorEnabled) monitor.start()
    },
    onDisconnected: async () => {
      monitor.stop()
      lastMessage = undefined
      bridge?.reset()
    },
  })

  /** 读一次凭据并给出完整状态；凭据异常不影响返回结构。 */
  async function snapshot() {
    let credential
    let credentialError
    try {
      credential = await resolveCredential(ctx.credentials, credentialRef)
    } catch (error) {
      credentialError = String(error?.message ?? error)
    }
    const loginState = login.status()
    const monitorState = monitor.getState()
    const connected = credential !== undefined
    const state = deriveConnectionState({ connected, loginState, monitorState })
    return {
      ok: true,
      state,
      connected,
      credentialRef,
      account: publicAccount(credential),
      ...(credentialError === undefined ? {} : { credentialError }),
      qr: loginState.qrUrl === undefined
        ? undefined
        : { url: loginState.qrUrl, expiresAt: loginState.expiresAt, loginId: loginState.loginId },
      code: loginState.code,
      error: loginState.error,
      monitor: { enabled: monitorEnabled, ...monitorState },
      lastMessage: lastMessage ?? loginState.lastMessage,
      bridge: bridge?.status() ?? {
        enabled: settings.bridgeEnabled,
        ready: false,
        accessPolicy: settings.bridgeAccessPolicy,
        allowCount: settings.bridgeAllowFrom.length,
        received: 0,
        replied: 0,
        skipped: 0,
        failed: 0,
        pendingApprovals: 0,
        store: {},
        lastError: '宿主缺少桥接所需服务（agents / llm / attachments 等）',
      },
    }
  }

  // 启动时按配置恢复监听（已有凭据才有意义）。
  if (settings.enabled && monitorEnabled) {
    void resolveCredential(ctx.credentials, credentialRef)
      .then((credential) => {
        if (disposed || credential === undefined) return
        monitor.start()
      })
      .catch((error) => {
        logger?.warn?.('[remote] 恢复监听失败：%s', String(error?.message ?? error))
      })
  }

  return {
    snapshot,

    /**
     * 申请二维码。
     *
     * @param force 为 false（默认）时，只要登录管理器手里还有一张未过期的码就复用它；
     *   面板上的「刷新二维码」按钮才传 true，明确要求换一张新的。
     */
    async startLogin(force = false) {
      if (disposed) throw new Error('插件已停止')
      let localTokens = []
      try {
        const existing = await resolveCredential(ctx.credentials, credentialRef)
        if (existing !== undefined) localTokens = [existing.token]
      } catch {
        // 旧凭据坏了不该阻止重新登录。
      }
      await login.start({ localTokens, force: force === true })
      return snapshot()
    },

    async submitCode(code) {
      login.submitCode(code)
      return snapshot()
    },

    async cancelLogin() {
      login.cancel()
      return snapshot()
    },

    async logout() {
      await login.logout()
      lastMessage = undefined
      return snapshot()
    },

    async probe() {
      const result = await monitor.probe({ timeoutMs: 10_000 })
      return { ...result, snapshot: await snapshot() }
    },

    /** 发一条测试消息（默认发给最近一位给自己发过消息的人）。 */
    async sendTestMessage(text) {
      if (bridge === undefined) throw new Error('宿主缺少桥接所需服务，无法发送测试消息')
      await bridge.sendTest(undefined, typeof text === 'string' && text.trim() !== '' ? text.trim() : undefined)
      return snapshot()
    },

    /** 改访问策略 / 白名单（落盘到桥状态文件，重启后仍生效）。 */
    async setBridgeAccess(patch) {
      if (bridge === undefined) throw new Error('宿主缺少桥接所需服务，无法修改访问策略')
      await bridge.setAccess(patch ?? {})
      return snapshot()
    },

    async setMonitor(enabled) {
      monitorEnabled = enabled === true
      if (disposed) return snapshot()
      if (!monitorEnabled) {
        monitor.stop()
      } else {
        const credential = await resolveCredential(ctx.credentials, credentialRef)
        if (credential !== undefined) monitor.start()
      }
      return snapshot()
    },

    async dispose() {
      disposed = true
      monitor.dispose()
      login.dispose()
      await bridge?.dispose()
    },

    get monitorEnabled() {
      return monitorEnabled
    },
  }
}

/**
 * 读取可选 JSON 请求体。
 *
 * 与 `login/code` / `monitor` 那种「必须有 body」的路由不同，`login/start` 不带 body
 * 也是合法调用（等价于 `{ force: false }`），所以这里一律容错：没有 req.on（测试里的
 * 假请求对象）、空 body、坏 JSON，统统当成「没传参数」，交给调用方用默认值。
 */
async function readOptionalJson(req) {
  if (typeof req?.on !== 'function') return undefined
  try {
    const text = await readBody(req, MAX_BODY)
    if (text.trim() === '') return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 注册插件路由。
 *
 * 所有接口都在鉴权之后，且强制 `cache-control: no-store`：它们要么带副作用，
 * 要么返回一次性数据（二维码、凭据状态）。
 */
export function registerClawbotRoutes(ctx, service) {
  const routes = [
    ['status', 'GET', async () => service.snapshot()],
    [
      'login/start', 'POST',
      async (req) => {
        const payload = await readOptionalJson(req)
        return service.startLogin(payload?.force === true)
      },
    ],
    ['login/poll', 'GET', async () => service.snapshot()],
    ['login/cancel', 'POST', async () => service.cancelLogin()],
    ['logout', 'POST', async () => service.logout()],
    ['probe', 'POST', async () => service.probe()],
    [
      'login/code', 'POST',
      async (req) => {
        let payload
        try {
          payload = JSON.parse(await readBody(req, MAX_BODY))
        } catch {
          throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 })
        }
        return service.submitCode(String(payload?.code ?? ''))
      },
    ],
    [
      'monitor', 'POST',
      async (req) => {
        let payload
        try {
          payload = JSON.parse(await readBody(req, MAX_BODY))
        } catch {
          throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 })
        }
        return service.setMonitor(payload?.enabled === true)
      },
    ],
    [
      'bridge/test', 'POST',
      async (req) => {
        const payload = await readOptionalJson(req)
        return service.sendTestMessage(payload?.text)
      },
    ],
    [
      'bridge/access', 'POST',
      async (req) => {
        let payload
        try {
          payload = JSON.parse(await readBody(req, MAX_BODY))
        } catch {
          throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 })
        }
        return service.setBridgeAccess({
          enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : undefined,
          policy: payload?.policy,
          allowFrom: payload?.allowFrom,
          allowRecent: payload?.allowRecent === true,
        })
      },
    ],
  ]

  for (const [suffix, method, run] of routes) {
    registerAuthenticatedRoute(ctx, {
      kind: 'exact',
      path: `${API_PATH}/${suffix}`,
      async handler(req, res) {
        res.setHeader('cache-control', 'no-store')
        // 这些接口都带副作用或一次性数据，绝不缓存。
        if (req.method !== method) return sendJson(res, 404, { ok: false, reason: 'not-found' })
        try {
          return sendJson(res, 200, await run(req, res))
        } catch (error) {
          const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400
          return sendJson(res, status, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
  }
}

/**
 * 配对 tab 的兜底身份：会话记录被回收、localStorage 又随端口换 origin 之后，
 * 只有 ds-harness-remote 落盘的 trusted-peers.json 还记得这台手机是谁。
 *
 * 它属于「手机连接」而不是 ClawBot，所以不受 enabled 开关影响：只读文件，
 * 不带凭据、不带副作用，和微信登录状态无关。
 */
function registerPeersRoute(ctx) {
  registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: `${API_PATH}/peers`,
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store')
      if (req.method !== 'GET') return sendJson(res, 404, { ok: false, reason: 'not-found' })
      try {
        const url = new URL(String(req?.url ?? '/'), 'http://localhost')
        const serverUrl = url.searchParams.get('serverUrl') ?? ''
        if (serverUrl.trim() === '') {
          return sendJson(res, 400, { ok: false, error: '缺少 serverUrl' })
        }
        const { peers } = await readTrustedPeers({ serverUrl })
        return sendJson(res, 200, { ok: true, peers })
      } catch (error) {
        // serverScope 对非法地址抛 400；读盘失败（权限等）是 500，别谎称「没配对过」。
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500
        return sendJson(res, status, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })
}

/**
 * 解绑之后的善后：删掉上游解绑没管的残留（「本机只被控」策略 + 旧的 client 角色目录）。
 *
 * 上游 `settings.logout` 只清凭据与身份记录，`pairing-host-only.json` 会留下来；
 * 重启后它把本机继续当成「配对主机」，面板于是把一次普通的未授权讲成
 * 「配对授权已被移除」——用户明明已经解绑，看到的还是旧配对那套说法。
 *
 * 只由本插件的面板在解绑后调用，属于「手机连接」而不是 ClawBot，所以不受 enabled 开关影响。
 */
function registerLocalStateRoute(ctx) {
  registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: `${API_PATH}/local-state/purge`,
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store')
      if (req.method !== 'POST') return sendJson(res, 404, { ok: false, reason: 'not-found' })
      try {
        const url = new URL(String(req?.url ?? '/'), 'http://localhost')
        const serverUrl = url.searchParams.get('serverUrl') ?? ''
        if (serverUrl.trim() === '') {
          return sendJson(res, 400, { ok: false, error: '缺少 serverUrl' })
        }
        const { dir, hostOnly, removed } = await purgePairingState({ serverUrl })
        return sendJson(res, 200, { ok: true, dir, hostOnly, removed })
      } catch (error) {
        // serverScope 对非法地址抛 400；删盘失败（占用/权限）是 500，别谎称「已经清干净」。
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500
        return sendJson(res, status, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })
}

export function apply(ctx, config) {
  if (typeof ctx.webServer?.register !== 'function') return
  if (typeof ctx.connection?.requestRejection !== 'function') return
  registerPeersRoute(ctx)
  registerLocalStateRoute(ctx)
  const settings = readConfig(config)
  if (!settings.enabled) return

  ctx.effect(async () => {
    const service = await createClawbotService(ctx, config)
    try {
      registerClawbotRoutes(ctx, service)
    } catch (error) {
      await service.dispose()
      throw error
    }
    return async () => {
      await service.dispose()
    }
  }, 'remote service')
}

export { Config }
export default { name, inject, Config, apply }
