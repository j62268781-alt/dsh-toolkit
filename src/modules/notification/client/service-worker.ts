/**
 * 通知用 Service Worker 的注册与调用封装。
 *
 * 为什么要有它：`new Notification(...)` 是页面级对象，页面一刷新/关闭就跟着没了；交给 SW
 * 之后通知由注册持有，页面死了它还在通知中心，点击也能被 `notificationclick` 接住（见
 * host/service-worker.ts 里的脚本体）。
 *
 * 这里的每个入口都必须能在「不支持 / 注册失败 / 还没激活」三种情况下安静退回构造器路径，
 * 否则推送通知的失败会连带把会话观察链路搞崩。
 */
import { SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE } from '../host/constants.js'

/** 点击通知后由 SW 发回页面的消息类型。 */
export const OPEN_MESSAGE = 'dsh-toolkit:notification:open'

/** 注册结果只算一次：SW 注册是异步且幂等的，反复调用只会浪费时间。 */
let pending: Promise<ServiceWorkerRegistration | undefined> | undefined

/**
 * 当前环境能不能用 SW 发通知。
 *
 * 三个条件缺一不可：安全上下文（https 或 localhost）、有 `serviceWorker.register`、
 * 有 `Notification` 构造器（SW 的 `showNotification` 在无通知能力的浏览器上也不可用）。
 * @returns 可用时 true。
 */
export function serviceWorkerSupported(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false
    if (typeof navigator.serviceWorker.register !== 'function') return false
    if (typeof window !== 'undefined' && window.isSecureContext === false) return false
    return typeof globalThis.Notification === 'function'
  } catch {
    return false
  }
}

/**
 * 确保 SW 已注册并开始控制页面。
 *
 * `register()` 只保证「已注册」，不等激活；`showNotification` 需要 active worker，所以这里
 * 再等一次 `navigator.serviceWorker.ready`，但**不能无限等**（scope 或策略不允许接管时会一直
 * 挂着），超时就当作没准备好，让调用方回退。
 * @param timeoutMs - 等待 active worker 的上限。
 * @returns 可用的注册对象；不可用时 undefined。
 */
export function ensureNotificationServiceWorker(timeoutMs = 4000): Promise<ServiceWorkerRegistration | undefined> {
  if (pending !== undefined) return pending
  if (!serviceWorkerSupported()) {
    pending = Promise.resolve(undefined)
    return pending
  }
  pending = (async () => {
    try {
      const registered = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: SERVICE_WORKER_SCOPE })
      const ready = navigator.serviceWorker.ready
      const activated = await Promise.race([
        ready,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
      ])
      return activated ?? registered
    } catch {
      // 注册失败（被策略拦、脚本 404、scope 不合法）：下一次调用不再重试，直接走构造器。
      return undefined
    }
  })()
  return pending
}

/** 清掉注册缓存（仅测试用：让每个用例从干净状态开始）。 */
export function resetNotificationServiceWorker() {
  pending = undefined
}
