import { sendJson } from '../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../host/routes.js'
import { createSoundService } from './sounds.js'

export const name = 'toolkit-notification'
export const inject = ['webServer', 'connection']
export const SOUNDS_PATH = '/api/plugins/dsh-toolkit/notification/sounds'
export const SOUND_PATH = '/api/plugins/dsh-toolkit/notification/sound'

export function registerNotificationSoundRoutes(ctx, service = createSoundService()) {
  for (const [pathname, audio] of [[SOUNDS_PATH, false], [SOUND_PATH, true]]) {
    registerAuthenticatedRoute(ctx, {
      kind: 'exact',
      path: pathname,
      async handler(req, res) {
        res.setHeader('cache-control', 'no-store')
        if (req.method !== 'GET') return sendJson(res, 404, { ok: false, reason: 'not-found' })
        try {
          if (!audio) return sendJson(res, 200, await service.getCatalog())
          const url = new URL(req.url, 'http://localhost')
          const { bytes, contentType } = await service.readSound(url.searchParams.get('id'))
          res.statusCode = 200
          res.setHeader('content-type', contentType)
          res.setHeader('content-length', bytes.length)
          res.setHeader('x-content-type-options', 'nosniff')
          res.end(bytes)
        } catch (error) {
          const status = error?.statusCode === 404 ? 404 : 503
          sendJson(res, status, { ok: false, reason: status === 404 ? 'sound-not-found' : 'sound-unavailable' })
        }
      },
    })
  }
}

export function apply(ctx) {
  if (typeof ctx.webServer?.register !== 'function' || typeof ctx.connection?.requestRejection !== 'function') return
  registerNotificationSoundRoutes(ctx)
}

export default { name, inject, apply }
