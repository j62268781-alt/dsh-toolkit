/**
 * 分发器：把引擎分类出来的一条事件，按当前偏好决定「响不响、弹不弹」。
 *
 * 与引擎一样是纯逻辑 + 注入端口：门控判断（类型开关、当前会话时机、窗口可见性）可以完全
 * 在 node 测试里跑，真正的声音与系统通知由 index.jsx 接上的端口执行。
 *
 * 顺序（短路在前）：
 *   1. 总开关关 → 什么都不做；
 *   2. 该类型关 → 什么都不做；
 *   3. 事件属于「你正在读的会话」且窗口在前台 → 默认静默（currentMode 可放宽）；
 *   4. 需要则播放提示音；
 *   5. 需要则弹系统通知，点击时回到对应会话。
 */

import { notificationBody, truncate } from './model.js'

/**
 * @typedef {object} DispatchDeps
 * @property {() => object} settings 读取当前偏好。
 * @property {(key: string, params?: object) => string} t 文案函数。
 * @property {(sound: string, volume: number) => void} playSound 播放提示音。
 * @property {(payload: {title: string, body: string, tag: string, sessionId: string}) => boolean} showNotification 弹系统通知。
 * @property {(sessionId: string) => boolean} isCurrent 该会话是否是你正在读的那个。
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

    // 「你正在读的会话」默认不打扰：只有窗口在后台/最小化，或把时机放宽到 unfocused/always。
    const mode = settings.currentMode
    const isCurrent = this.deps.isCurrent(event.sessionId) === true
    const hidden = this.deps.isHidden() === true
    const away = hidden || (mode === 'unfocused' && this.deps.hasFocus?.() === false)
    if (isCurrent && !away && mode !== 'always') {
      return { notified: false, sounded: false, reason: 'current-session' }
    }

    let sounded = false
    if (settings.soundEnabled === true && type.sound !== 'none') {
      try {
        this.deps.playSound(type.sound, settings.volume)
        sounded = true
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
