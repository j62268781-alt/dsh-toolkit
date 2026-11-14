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
 * tag 的长度上限（不是随便定的）。
 *
 * Chromium 给原生层的是通知 id `n#<origin>#<tag>`（`NotificationIdGenerator::
 * GenerateForNonPersistentNotification`），**Electron 的 Windows 通道把这个 id 原样写进
 * WinRT `ToastNotification.Tag`，不哈希也不截断**（`windows_toast_notification.cc` 的
 * `GetTag()`）。而 WinRT 的 Tag 硬上限是 64 个 UTF-16 字符，超了 `put_Tag()` 直接失败，
 * 整条 toast 被丢弃 —— 失败只记在 `debug_notifications` 开关打开的 INFO 日志里，渲染进程
 * 完全看不到。
 *
 * 桌面壳的 origin 是 `dsh-app://app`，前缀 `n#dsh-app://app#` 占 16 字符，所以 tag 只能
 * 用 64-16=48；这里再留 4 字符余量取 44。踩过的坑：早期 tag 形如
 * `dsh-toolkit:notification:<36 字符会话 id>:<类型>`（71~72 字符 ⇒ id 87~88），
 * 任务完成/失败的通知一条都弹不出来，而测试通知（tag 29 字符）正常——正是这个上限。
 */
export const TAG_LIMIT = 44

/**
 * 稳定短摘要：FNV-1a 32 位跑两轮，拼成 16 位十六进制。
 *
 * 只用来把长键压进 tag 预算里，不做安全用途。同一个输入永远同一个输出，
 * 所以「同一会话同一类型折叠成一张卡」的语义不变（`renotify` 依赖 tag 相等）。
 * @param {string} text 原始文本。
 * @returns {string} 16 位十六进制摘要。
 */
function digest(text) {
  let head = 0x811c9dc5
  let tail = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    head = Math.imul(head ^ code, 0x01000193) >>> 0
    tail = Math.imul(tail ^ (code + index), 0x85ebca6b) >>> 0
  }
  return head.toString(16).padStart(8, '0') + tail.toString(16).padStart(8, '0')
}

/**
 * 由会话与事件类型推出通知折叠键。
 *
 * 不用 `${sessionId}:${kind}` 直接拼：会话 id 是 36 字符 UUID，拼出来会超 `TAG_LIMIT`，
 * 桌面端的结果就是通知被 WinRT 静默丢弃（见 TAG_LIMIT 注释）。
 * @param {string} sessionId 会话 id。
 * @param {string} kind 事件类型（completed/failed/question/permission）。
 * @returns {string} 不超过 `TAG_LIMIT` 的 tag。
 */
export function notificationTag(sessionId, kind) {
  const session = typeof sessionId === 'string' ? sessionId : ''
  const category = typeof kind === 'string' ? kind : ''
  return `${TAG_PREFIX}:${digest(`${session}:${category}`)}`
}

/**
 * 把任意 tag 压进原生长度预算：够短就原样用，超了换成前缀 + 摘要。
 * @param {unknown} requested 调用方给的 tag。
 * @returns {string} 可安全交给原生层的 tag。
 */
function clampTag(requested) {
  const tag = typeof requested === 'string' && requested !== '' ? requested : TAG_PREFIX
  if (tag.length <= TAG_LIMIT) return tag
  return `${TAG_PREFIX}:${digest(tag)}`
}

/**
 * 活着的通知对象必须一直被引用：点击回调挂在 JS 包装对象上，
 * 被 GC 掉就可能吞掉这次激活（平台侧只持有通知 id）。
 *
 * 值是归属信息（`sessionId`），供 `dismissLiveNotifications()` 按会话回收：
 * 用户回到前台、正在看那个会话时，卡片再挂着就是噪音。
 */
const live = new Map()

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
 * 交互类通知（等回答 / 等授权）必须常驻，直到用户处理掉。
 *
 * Web 侧的等价开关是 `requireInteraction`：Chromium 在 Windows 通道上把它翻成
 * `options.timeout_type = u"never"`，Electron 再据此生成 `scenario="reminder"` 的 toast，
 * 并自动补一个 `activationType="system"` / `arguments="Dismiss"` 的关闭按钮
 * （`windows_toast_notification.cc` 的 `GetToastXml()`）。完成/失败类走默认超时，
 * 免得用户不在时堆一屏关不掉的卡片。
 */
const STICKY_KINDS = ['question', 'permission']

/** 一条系统通知的内容与点击动作（全部可选：调用方常常只给标题正文）。 */
export interface BrowserNotificationOptions {
  /** 标题（会话标题）。 */
  title?: string
  /** 正文（本轮最终回复 / 错误 / 问题）。 */
  body?: string
  /** 折叠键，同一会话同一类型共用一张卡片。 */
  tag?: string
  /** 事件类型，决定是否常驻（question/permission）。 */
  kind?: string
  /** 归属会话，供回前台时按会话回收。 */
  sessionId?: string
  /** 点击动作（跳转到会话）。 */
  onClick?: () => void
}

/**
 * 发一条系统通知。
 * @param {object} options 通知内容与点击动作。
 * @param {string} options.title 标题（会话标题）。
 * @param {string} options.body 正文（本轮最终回复 / 错误 / 问题）。
 * @param {string} [options.tag] 折叠键，同一会话同一类型共用一张卡片。
 * @param {string} [options.kind] 事件类型，决定是否常驻（question/permission）。
 * @param {string} [options.sessionId] 归属会话，供回前台时按会话回收。
 * @param {() => void} [options.onClick] 点击动作（跳转到会话）。
 * @returns {boolean} 是否真的弹出了通知。
 */
export function showBrowserNotification(options: BrowserNotificationOptions = {}) {
  const Ctor = notificationCtor()
  if (Ctor === undefined) {
    warn('browser Notification API is unavailable (insecure context or unsupported browser)')
    return false
  }
  // 只拦「明确拒绝」：default 表示宿主还没记过决定，桌面外壳里这类站点其实可以弹
  // （权限由 Electron/系统决定，Chromium 的 permission 状态并不总反映系统侧设置）。
  // 真的被拒时构造器会抛错或者平台回 error 事件，两条线都有 error 级诊断。
  const permission = browserPermission()
  if (permission === 'denied') {
    warn('browser notification suppressed: permission is "denied"')
    return false
  }
  // 原生层的 tag 上限是硬性的（见 TAG_LIMIT）：超了不是被截断，是整条通知消失。
  const tag = clampTag(options.tag)
  const title = typeof options.title === 'string' ? options.title : ''
  const body = typeof options.body === 'string' ? options.body : ''
  const sessionId = typeof options.sessionId === 'string' ? options.sessionId : ''
  const kind = typeof options.kind === 'string' ? options.kind : ''
  const base = {
    body,
    tag,
    // 同 tag 通知被替换时重新提醒一次，而不是在 Windows/Chromium 的通知中心里静默换卡片。
    renotify: true,
    // Sound is controlled by the selected file and volume, including on the web.
    silent: true,
    requireInteraction: STICKY_KINDS.includes(kind),
  }
  const icon = pageIconUrl()

  /** 接上点击回调并保持引用，直到通知关闭。 */
  const activate = (notification) => {
    live.set(notification, { sessionId, kind })
    const forget = () => live.delete(notification)
    try {
      if (typeof notification.addEventListener === 'function') notification.addEventListener('close', forget, { once: true })
    } catch {
      // 某些环境没有 addEventListener；forget 仍会在点击时执行。
    }
    // 原生层「构造成功但没上屏」只能从这里看：Chromium 把平台层的失败（例如 WinRT 的
    // Toast 被拒）经 `error` 事件交回渲染进程，`new Notification(...)` 本身不抛错。
    // 之前这条通道没接，所以 tag 超长导致的通知丢失在外面看起来完全无迹可寻。
    try {
      if (typeof notification.addEventListener === 'function') {
        notification.addEventListener('error', () => {
          forget()
          fail(`platform refused to show the notification (tag: ${tag})`)
        }, { once: true })
      }
    } catch {
      // 同上：没有事件接口就只剩构造期异常这一条诊断线。
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
        fail('Notification constructor failed; check the browser/OS notification settings', second)
        return false
      }
    }
    fail('Notification constructor failed; check the browser/OS notification settings', error)
    return false
  }
}

/**
 * 关掉仍然挂着的通知。
 *
 * 用在「用户回到前台」这种时机：提醒的目的已经达到，卡片继续留着只会挡住别的内容。
 * 注意语义有上限——toast 还在屏上时 `close()` 只让 Windows 收起横幅（`ToastNotifier.Hide`），
 * 已进到「操作中心」的记录要系统自己 dismissed 之后才会被真正移除。
 * @param {(entry: {sessionId: string, kind: string}) => boolean} [predicate] 选中要关掉的通知；缺省关全部。
 * @returns {number} 关掉了几条。
 */
export function dismissLiveNotifications(predicate) {
  let closed = 0
  for (const [notification, entry] of [...live]) {
    if (typeof predicate === 'function') {
      let selected = false
      try {
        selected = predicate(entry) === true
      } catch {
        selected = false
      }
      if (!selected) continue
    }
    live.delete(notification)
    try {
      notification.close()
      closed += 1
    } catch {
      // 已经关掉 / 环境不支持：忽略。
    }
  }
  return closed
}

/** 当前还挂着的通知数量（诊断与测试用）。 */
export function liveNotificationCount() {
  return live.size
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
function warn(message, error?) {
  try {
    if (error === undefined) console.warn(`[dsh-toolkit:notification] ${message}`)
    else console.warn(`[dsh-toolkit:notification] ${message}`, error)
  } catch {
    // 忽略。
  }
}

/**
 * 真失败用 error 级：宿主只把 error 级 console 转发到可见日志，
 * 而「通知没弹出来」恰恰是必须能查的那种问题（warn 级在这里等于静默）。
 */
function fail(message, error?) {
  try {
    if (error === undefined) console.error(`[dsh-toolkit:notification] ${message}`)
    else console.error(`[dsh-toolkit:notification] ${message}`, error)
  } catch {
    // 忽略。
  }
}
