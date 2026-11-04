/**
 * 分发器：把引擎分类出来的一条事件，按当前偏好决定「响不响、弹不弹」。
 *
 * 与引擎一样是纯逻辑 + 注入端口：门控判断（类型开关、全局提醒时机、窗口焦点）可以完全
 * 在 node 测试里跑，真正的声音与系统通知由 index.jsx 接上的端口执行。
 *
 * 顺序（短路在前）：
 *   1. 总开关关 → 什么都不做；
 *   2. 该类型关 → 什么都不做；
 *   3. 按全局时机判断：never 静默；unfocused 仅窗口隐藏或失焦时提醒；always 总是提醒；
 *   4. 需要则播放提示音；
 *   5. 需要则弹系统通知，点击时回到对应会话。
 */

import { notificationBody, truncate } from './model.js'

/**
 * @typedef {object} DispatchDeps
 * @property {() => object} settings 读取当前偏好。
 * @property {(key: string, params?: object) => string} t 文案函数。
 * @property {(sound: string, volume: number) => boolean | void} playSound 播放提示音，false 表示未接受播放。
 * @property {(payload: {title: string, body: string, tag: string, sessionId: string}) => boolean} showNotification 弹系统通知。
 * @property {(sessionId: string) => boolean} [isCurrent] 旧版会话判断端口；全局时机不使用它。
 * @property {() => boolean} isHidden 文档是否在后台/最小化。
 * @property {() => boolean} [hasFocus] 文档是否获得焦点（缺省按「有焦点」处理）。
 */

/** 一次分发的决策结果（测试与「最近通知」列表都读它）。 */
/**
 * @typedef {object} DispatchResult
 * @property {boolean} notified 是否弹了系统通知。
 * @property {boolean} sounded 是否播放了提示音。
 * @property {string} [title] 实际使用的通知标题（会话标题）。
 * @property {string} [body] 实际使用的通知正文。
 * @property {string} [reason] 未通知的原因（诊断用）。
 */

export class NotificationDispatcher {
  /**
   * @param {DispatchDeps} deps 注入端口。
   */
  constructor(deps) {
    this.deps = deps
  }

  /**
   * 分发一条事件。
   * @param {{kind: string, sessionId: string, title: string, detail: string}} event 引擎事件。
   * @returns {DispatchResult} 决策结果。
   */
  dispatch(event) {
    const settings = this.deps.settings()
    // 总开关：关掉就既不响也不弹。
    if (settings.enabled !== true) return { notified: false, sounded: false, reason: 'disabled' }
    const type = settings.types?.[event.kind]
    if (type?.enabled !== true) return { notified: false, sounded: false, reason: 'kind-disabled' }

    // 提醒时机作用于所有会话，不随当前正在查看的会话变化。
    const mode = settings.currentMode
    if (mode === 'never') return { notified: false, sounded: false, reason: 'never' }
    const away = this.deps.isHidden() === true || this.deps.hasFocus?.() === false
    if (!away && mode !== 'always') {
      return { notified: false, sounded: false, reason: 'focused' }
    }

    let sounded = false
    const sound = settings.sound ?? type.sound
    if (settings.soundEnabled === true && sound !== 'none' && settings.volume !== 0) {
      try {
        sounded = this.deps.playSound(sound, settings.volume) !== false
      } catch {
        // 声音失败不影响系统通知。
      }
    }

    const title = typeof event.title === 'string' && event.title.trim() !== ''
      ? event.title.trim()
      : this.deps.t('untitled')
    const body = notificationBody(event, this.deps.t)
    let notified = false
    try {
      notified = this.deps.showNotification({
        title,
        body,
        // 一条通知一张卡片：按会话 + 类型折叠，同一会话的类型不会互相覆盖。
        tag: `dsh-toolkit:notification:${event.sessionId}:${event.kind}`,
        sessionId: event.sessionId,
      }) === true
    } catch {
      notified = false
    }
    return { notified, sounded, title, body }
  }
}

/** 通知正文的截断上限，导出给页面上的预览复用。 */
export const BODY_LIMIT = 160

/** 供页面预览用：事件 → 一行正文。 */
export function previewBody(event, t) {
  return truncate(notificationBody(event, t), BODY_LIMIT)
}
