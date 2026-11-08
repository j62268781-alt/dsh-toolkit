/**
 * Host 半边：微信扫码登录（ClawBot / iLink）。
 *
 * 职责边界：
 *   · 只做登录与通道自检，不做消息桥接（不复用、不修改 deepseek-harness-weixin）。
 *   · token 只经 ctx.credentials 存取，绝不进日志、绝不回前端。
 *   · 二维码 URL 是短生命周期凭据，只在 start() 的响应里回给前端，不打印。
 *
 * 路由（全部同源 fetch，无需 CORS）：
 *   GET  /api/plugins/dsh-toolkit/weixin-clawbot/status      当前状态
 *   POST /api/plugins/dsh-toolkit/weixin-clawbot/login/start 发起扫码
 *   GET  /api/plugins/dsh-toolkit/weixin-clawbot/login/poll  前端轮询
 *   POST /api/plugins/dsh-toolkit/weixin-clawbot/login/code  回传数字校验码
 *   POST /api/plugins/dsh-toolkit/weixin-clawbot/login/cancel 取消扫码
 *   POST /api/plugins/dsh-toolkit/weixin-clawbot/logout      断开并清空凭据
 *   POST /api/plugins/dsh-toolkit/weixin-clawbot/probe       单次通道探测
 *   POST /api/plugins/dsh-toolkit/weixin-clawbot/monitor     开启/关闭常驻监听
 */

import { sendJson, readBody } from '../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../host/routes.js'
import { Config, DEFAULT_CREDENTIAL_REF, readConfig } from './config.js'
import { createLoginManager } from './login.js'
import { createMonitor } from './monitor.js'
import { maskId, normalizeBaseUrl } from './ilink.js'

export const name = 'toolkit-weixin-clawbot'
export const inject = ['webServer', 'connection', 'credentials']

export const API_PATH = '/api/plugins/dsh-toolkit/weixin-clawbot'

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

export async function createClawbotService(ctx, config) {
  const settings = readConfig(config)
  const credentialRef = settings.credentialRef || DEFAULT_CREDENTIAL_REF
  const logger = typeof ctx.logger === 'function' ? ctx.logger('weixin-clawbot') : undefined

  let disposed = false
  let lastMessage
  let monitorEnabled = settings.monitorOnConnect

  const monitor = createMonitor({
    logger,
    getCredential: () => resolveCredential(ctx.credentials, credentialRef),
    onMessage: (summary) => {
      lastMessage = summary
      login.recordMessage(summary)
    },
  })

  const login = createLoginManager({
    credentials: ctx.credentials,
    credentialRef,
    logger,
    onConnected: async (credential, session) => {
      lastMessage = undefined
      if (session !== undefined) session.localTokens = []
      if (monitorEnabled) monitor.start()
    },
    onDisconnected: async () => {
      monitor.stop()
      lastMessage = undefined
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
    const connected = credential !== undefined
    const state = connected ? (loginState.state === 'confirmed' ? 'confirmed' : 'connected') : loginState.state
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
      monitor: { enabled: monitorEnabled, ...monitor.getState() },
      lastMessage: lastMessage ?? loginState.lastMessage,
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
        logger?.warn?.('[weixin-clawbot] 恢复监听失败：%s', String(error?.message ?? error))
      })
  }

  return {
    snapshot,

    async startLogin() {
      if (disposed) throw new Error('插件已停止')
      let localTokens = []
      try {
        const existing = await resolveCredential(ctx.credentials, credentialRef)
        if (existing !== undefined) localTokens = [existing.token]
      } catch {
        // 旧凭据坏了不该阻止重新登录。
      }
      await login.start({ localTokens })
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
    },

    get monitorEnabled() {
      return monitorEnabled
    },
  }
}

/**
 * 注册全部路由。每个路由都通过 registerAuthenticatedRoute 走宿主的鉴权边界。
 * @param service 由 createClawbotService 创建的服务。
 */
export function registerClawbotRoutes(ctx, service) {
  const routes = [
    ['status', 'GET', async () => service.snapshot()],
    ['login/start', 'POST', async () => service.startLogin()],
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

export function apply(ctx, config) {
  if (typeof ctx.webServer?.register !== 'function') return
  if (typeof ctx.connection?.requestRejection !== 'function') return
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
  }, 'weixin-clawbot service')
}

export { Config }
export default { name, inject, Config, apply }
