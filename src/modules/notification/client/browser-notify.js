/**
 * 浏览器/系统通知的薄封装。
 *
 * 本模块只做三件事：探测 `Notification` API 与权限、申请权限、发一条通知并接上点击回调。
 * 每一处调用都做特性探测与 try/catch —— 非浏览器环境、被拒绝的权限、构造失败都不能让
 * 会话观察链路跟着崩掉；被抑制的通知会打一条 warn，方便在控制台诊断「为什么没弹」。
 *
 * 关于「点击通知打开 DSH 并跳转会话」：
 *   - 跳转由 `ctx.uiWorkspace.openSession(sessionId)` 完成（见 index.jsx）；
 *   - 把窗口带到前台没有官方 API：rc.5 的 `globalThis.dshDesktop` 只暴露 browser/deviceInfo/
 *     keyboard/shortcuts/updates，没有任何 focus/activate 通道。点击系统通知时，Web 浏览器会
 *     聚焦来源标签页、Electron/Windows 会把应用窗口激活到前台，这是平台行为；这里再补一次
 *     `window.focus()` 作为尽力而为的兜底。
 */

/** 权限状态；`unsupported` 表示当前环境没有 Notification API。 */
export const PERMISSIONS = ['granted', 'denied', 'default', 'unsupported']

/** 通知 tag 前缀：本模块发的每条通知都带它，便于识别与折叠。 */
export const TAG_PREFIX = 'dsh-toolkit:notification'

/**
 * 活着的通知对象必须一直被引用：点击回调挂在 JS 包装对象上，
 * 被 GC 掉就可能吞掉这次激活（平台侧只持有通知 id）。
 */
const live = new Set()

/** 当前环境的 Notification 构造器（不存在时 undefined）。 */
function notificationCtor() {
  try {
    return typeof globalThis.Notification === 'function' ? globalThis.Notification : undefined
  } catch {
    return undefined
  }
}

/** 读取当前通知权限。 */
export function browserPermission() {
  const Ctor = notificationCtor()
  if (Ctor === undefined) return 'unsupported'
  try {
    return Ctor.permission
  } catch {
    return 'unsupported'
  }
}

/** 是否运行在 DSH 桌面外壳（Electron）里。仅用于通知选项的细节。 */
export function isDesktopShell() {
  try {
    return typeof globalThis === 'object' && globalThis !== null && 'dshDesktop' in globalThis
  } catch {
    return false
  }
}

/**
 * 申请通知权限。必须在用户手势（点击）里调用，否则浏览器会静默拒绝。
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>} 申请后的权限状态。
 */
export async function requestBrowserPermission() {
  const Ctor = notificationCtor()
  if (Ctor === undefined) return 'unsupported'
  try {
    if (Ctor.permission !== 'default') return Ctor.permission
    return await Ctor.requestPermission()
  } catch {
    return browserPermission()
  }
}

/** 原生通知层能抓取的图标协议；`dsh-app:`/`data:image/svg` 之类一律不用。 */
const FETCHABLE_ICON = /^(?:https?|blob):/i

/** 位图 data URL 可用；SVG 文档原生通知层不会光栅化。 */
const RASTER_DATA_ICON = /^data:image\/(?!svg)/i

/** 从一条 <link> 里取可用图标地址。 */
function iconUrlOf(link) {
  try {
    const href = link?.href
    if (typeof href !== 'string' || href === '') return undefined
    if (FETCHABLE_ICON.test(href)) return href
    return RASTER_DATA_ICON.test(href) ? href : undefined
  } catch {
    return undefined
  }
}

/**
 * 页面自身图标（favicon）的绝对 URL；桌面壳的 `dsh-app:` 图标不可抓取，
 * 跳过它可以让 Electron 回落到打包的应用图标，而不是丢掉整条通知。
 */
export function pageIconUrl() {
  try {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return undefined
    return iconUrlOf(document.querySelector('link[rel="apple-touch-icon"]'))
      ?? iconUrlOf(document.querySelector('link[rel~="icon"]'))
  } catch {
    return undefined
  }
}

/** 把窗口带到前台的尽力而为：没有官方 API，只有平台在点击时给的激活行为。 */
export function activateWindow() {
  try {
    if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus()
  } catch {
    // 浏览器可能拒绝在没有用户激活的情况下聚焦窗口；忽略。
  }
}

/**
 * 发一条系统通知。
 * @param {object} options 通知内容与点击动作。
 * @param {string} options.title 标题（会话标题）。
 * @param {string} options.body 正文（本轮最终回复 / 错误 / 问题）。
 * @param {string} [options.tag] 折叠键，同一会话同一类型共用一张卡片。
 * @param {() => void} [options.onClick] 点击动作（跳转到会话）。
 * @returns {boolean} 是否真的弹出了通知。
 */
export function showBrowserNotification(options = {}) {
  const Ctor = notificationCtor()
  if (Ctor === undefined) {
    warn('browser Notification API is unavailable (insecure context or unsupported browser)')
    return false
  }
  if (browserPermission() !== 'granted') {
    warn(`browser notification suppressed: permission is "${browserPermission()}"`)
    return false
  }
  const tag = typeof options.tag === 'string' && options.tag !== '' ? options.tag : TAG_PREFIX
  const title = typeof options.title === 'string' ? options.title : ''
  const body = typeof options.body === 'string' ? options.body : ''
  const base = {
    body,
    tag,
    // 同 tag 通知被替换时重新提醒一次，而不是在 Windows/Chromium 的通知中心里静默换卡片。
    renotify: true,
    // 桌面外壳会把 silent 透传给原生通知；不设它系统提示音会和本模块的提示音叠在一起。
    ...(isDesktopShell() ? { silent: true } : {}),
  }
  const icon = pageIconUrl()

  /** 接上点击回调并保持引用，直到通知关闭。 */
  const activate = (notification) => {
    live.add(notification)
    const forget = () => live.delete(notification)
    try {
      if (typeof notification.addEventListener === 'function') notification.addEventListener('close', forget, { once: true })
    } catch {
      // 某些环境没有 addEventListener；forget 仍会在点击时执行。
    }
    notification.onclick = () => {
      forget()
      activateWindow()
      try {
        options.onClick?.()
      } catch (error) {
        warn('notification click action failed', error)
      }
      try {
        notification.close()
      } catch {
        // 忽略：卡片已经被系统关掉。
      }
    }
  }

  try {
    activate(new Ctor(title, icon === undefined ? base : { ...base, icon }))
    return true
  } catch (error) {
    // 图标被拒绝不能让通知消失：去掉图标重试一次。
    if (icon !== undefined) {
      try {
        activate(new Ctor(title, base))
        warn('page icon was rejected; notification shown without it', error)
        return true
      } catch (second) {
        warn('Notification constructor failed; check the browser/OS notification settings', second)
        return false
      }
    }
    warn('Notification constructor failed; check the browser/OS notification settings', error)
    return false
  }
}

/** 发一条测试通知，用来验证通道（权限已授予时才有意义）。 */
export function showTestNotification(t) {
  return showBrowserNotification({
    title: t('title'),
    body: t('testDesc'),
    tag: `${TAG_PREFIX}:test`,
  })
}

/** 统一的诊断输出：不吞错误，也不让日志本身抛错。 */
function warn(message, error) {
  try {
    if (error === undefined) console.warn(`[dsh-toolkit:notification] ${message}`)
    else console.warn(`[dsh-toolkit:notification] ${message}`, error)
  } catch {
    // 忽略。
  }
}
