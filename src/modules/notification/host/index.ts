import { sendJson } from '../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../host/routes.js'
import type { RaiseWindowOptions } from './raise.js'
import { raiseWindow } from './raise.js'
import type { SoundService } from './sounds.js'
import { createSoundService } from './sounds.js'

export const name = 'dsh-toolkit-notification'
export const inject = ['webServer', 'connection']
export const SOUNDS_PATH = '/api/plugins/dsh-toolkit/notification/sounds'
export const SOUND_PATH = '/api/plugins/dsh-toolkit/notification/sound'
export const RAISE_PATH = '/api/plugins/dsh-toolkit/notification/raise'

/**
 * 提示音目录与音频文件两条只读路由。
 * @param ctx - 宿主上下文。
 * @param service - 声音服务（测试注入）。
 */
export function registerNotificationSoundRoutes(ctx: any, service: SoundService = createSoundService()) {
  const endpoints: ReadonlyArray<readonly [string, boolean]> = [
    [SOUNDS_PATH, false],
    [SOUND_PATH, true],
  ]
  for (const [pathname, audio] of endpoints) {
    registerAuthenticatedRoute(ctx, {
      kind: 'exact',
      path: pathname,
      async handler(req, res) {
        res.setHeader('cache-control', 'no-store')
        if (req.method !== 'GET') return sendJson(res, 404, { ok: false, reason: 'not-found' })
        try {
          if (!audio) return sendJson(res, 200, await service.getCatalog())
          const url = new URL(req.url ?? '/', 'http://localhost')
          const { bytes, contentType } = await service.readSound(url.searchParams.get('id') ?? '')
          res.statusCode = 200
          res.setHeader('content-type', contentType)
          res.setHeader('content-length', bytes.length)
          res.setHeader('x-content-type-options', 'nosniff')
          res.end(bytes)
        } catch (error) {
          const status = (error as { statusCode?: number } | undefined)?.statusCode === 404 ? 404 : 503
          sendJson(res, status, { ok: false, reason: status === 404 ? 'sound-not-found' : 'sound-unavailable' })
        }
      },
    })
  }
}

/**
 * 「把窗口提到前台」的 POST 路由。
 *
 * 渲染进程点击系统通知时只能改前端路由（切到对应会话），窗口本身留在后台——Windows 的
 * 前台锁不允许后台进程抢焦点。这里借「再启动一个本应用实例」让主实例收到 second-instance
 * 并把窗口恢复+聚焦（原理见 raise.js）。必须是 POST：GET 会被预取或被缓存命中，等于
 * 用户没点也提窗。
 * @param ctx - 宿主上下文。
 * @param options - 注入给 raiseWindow 的选项（测试用）。
 */
export function registerRaiseRoute(ctx: any, options: RaiseWindowOptions = {}) {
  registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: RAISE_PATH,
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store')
      if (req.method !== 'POST') return sendJson(res, 404, { ok: false, reason: 'not-found' })
      const raised = raiseWindow(options)
      return sendJson(res, 200, { ok: raised, reason: raised ? undefined : 'unsupported' })
    },
  })
}

export function apply(ctx: any): void {
  if (typeof ctx.webServer?.register !== 'function' || typeof ctx.connection?.requestRejection !== 'function') return
  registerNotificationSoundRoutes(ctx)
  registerRaiseRoute(ctx)
}

export default { name, inject, apply }
