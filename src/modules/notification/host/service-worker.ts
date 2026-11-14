import { sendJson } from '../../../host/http.js'
import { registerRoute } from '../../../host/routes.js'
import { SERVICE_WORKER_PATH } from './constants.js'

/**
 * 通知点击处理器（Service Worker）的脚本体。
 *
 * 为什么需要它：`new Notification(...)` 的生命周期绑在页面上，页面一刷新/关闭通知就跟着
 * 消失，点击也无从处理。交给 SW 之后通知由注册持有，页面死了它还在通知中心里，点击会在
 * `notificationclick` 里被接住——这时可以聚焦已有窗口，或按通知里记的 URL 新开一个。
 *
 * 刻意**不注册 `fetch` 处理器**：这个 SW 的 scope 被放宽到了站点根（见 constants.ts），
 * 一旦拦截请求就可能把整个应用拖下水。没有 fetch 监听时浏览器直接走网络，等价于不存在。
 *
 * 注意：这是纯 JS 源码，会被原样当文本发给浏览器，不能出现任何 TS 语法。
 */
export const SERVICE_WORKER_SOURCE = `/* dsh-toolkit notification click handler */
const OPEN_MESSAGE = 'dsh-toolkit:notification:open'

self.addEventListener('install', () => { self.skipWaiting() })

// 立刻接管已打开的页面：否则装完要等下一次导航才生效，第一次点击通知时还找不到窗口。
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  const data = (notification && notification.data) || {}
  if (notification) notification.close()
  if (event.action === 'dismiss') return
  event.waitUntil(reveal(data))
})

/**
 * 优先聚焦已有窗口并让它跳到对应会话；没有窗口才按通知里记的 URL 新开一个。
 * @param {object} data 发通知时塞进 notification.data 的载荷。
 */
async function reveal(data) {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
  let windows = []
  try {
    windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  } catch (error) {
    windows = []
  }
  for (const client of windows) {
    try {
      await client.focus()
      client.postMessage({ type: OPEN_MESSAGE, sessionId })
      return
    } catch (error) {
      // 这个窗口聚焦不了（例如已被关掉）：试下一个。
    }
  }
  if (typeof data.url === 'string' && data.url !== '') {
    try {
      await self.clients.openWindow(data.url)
    } catch (error) {
      // 打开失败就没别的办法了：通知已经关掉，用户自己切回标签页即可。
    }
  }
}
`

/**
 * 挂上 SW 脚本路由。
 *
 * 这条路由**不鉴权**（`registerRoute` 而非 `registerAuthenticatedRoute`）：浏览器注册 SW
 * 时独立发脚本请求，带不上页面 URL 里的 token。脚本里只有常量与事件处理，没有数据。
 * @param ctx - 宿主上下文。
 */
export function registerNotificationServiceWorkerRoute(ctx: any) {
  registerRoute(ctx, {
    kind: 'exact',
    path: SERVICE_WORKER_PATH,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 404, { ok: false, reason: 'not-found' })
      }
      const body = Buffer.from(SERVICE_WORKER_SOURCE, 'utf8')
      res.statusCode = 200
      res.setHeader('content-type', 'application/javascript; charset=utf-8')
      // 不做长缓存：改完脚本要立刻可被浏览器发现，否则要等它自己来查更新。
      res.setHeader('cache-control', 'no-cache')
      // 放宽注册 scope 到站点根，理由见 constants.ts 的 SERVICE_WORKER_SCOPE。
      res.setHeader('service-worker-allowed', '/')
      res.setHeader('x-content-type-options', 'nosniff')
      res.setHeader('content-length', body.length)
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  })
}
