/**
 * 分发器：把引擎分类出来的一条事件，按当前偏好决定「响不响、弹不弹」。
 *
 * 与引擎一样是纯逻辑 + 注入端口：门控判断（类型开关、全局提醒时机、窗口焦点）
 * 可以完全在 node 测试里跑，真正的提示音与系统通知由 index.jsx 接上的端口执行。
 *
 * 提醒只走系统通知通道（`new Notification`，见 browser-notify.js）：宿主没有给插件
 * 任何「应用内弹窗」的官方能力，自己再画一套卡片只会和系统横幅重复一遍。
 *
 * 顺序（短路在前）：
 *   1. 总开关关 → 什么都不做；
 *   2. 该类型关 → 什么都不做；
 *   3. 播放提示音（只要事件真的发生就响，不看窗口焦点——窗口在前台时横幅可能被系统
 *      忽略，但「这一轮结束了」的声音反馈仍然有意义，用声音代替被吞掉的横幅）；
 *   4. 按全局时机判断要不要弹系统通知：never 静默；unfocused 仅窗口隐藏或失焦时弹；
 *      always 总是弹；
 *   5. 需要则发系统通知。
 */

import { notificationBody, truncate } from './model.js'
import { notificationTag } from './browser-notify.js'

/**
 * @typedef {object} DispatchDeps
 * @property {() => object} settings 读取当前偏好。
 * @property {(key: string, params?: object) => string} t 文案函数。
 * @property {(sound: string, volume: number) => boolean | void} playSound 播放提示音，false 表示未接受播放。
 * @property {(payload: {title: string, body: string, tag: string, kind: string, sessionId: string}) => boolean} showNotification 弹系统通知。
 * @property {(sessionId: string) => boolean} [isCurrent] 会话是否是用户正在看的那个（只用于诊断原因）。
 * @property {() => boolean} isHidden 文档是否在后台/最小化。
 * @property {() => boolean} [hasFocus] 文档是否获得焦点（缺省按「有焦点」处理）。
 * @property {() => number} [now] 时钟（毫秒），缺省用 Date.now；测试注入以验证提示音去抖。
 */

/**
 * 提示音去抖窗口（毫秒）。
 *
 * 并行子会话或批量重跑会让好几轮在同一个瞬间收尾，此时每轮都响一次只会叠成噪音，
 * 听者也分辨不出「响了几次」。窗口内的第二次及以后的触发不再出声——通知本身仍然
 * 各自入队（不同会话各一张卡），只是不再重复提醒「有事发生了」。
 */
export const SOUND_WINDOW = 900

/** 一次分发的决策结果（测试读取它）。 */
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
    /** 上一次真正出声的时刻，用于 SOUND_WINDOW 去抖。初值 -Infinity 保证第一声一定响。 */
    this.lastSoundAt = Number.NEGATIVE_INFINITY
  }

  /** 时钟（测试可注入 `deps.now`）。 */
  now() {
    const value = this.deps.now?.()
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
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

    // 提醒时机作用于所有会话，不随当前正在查看的会话变化。「从不」= 彻底静默。
    const mode = settings.currentMode
    if (mode === 'never') return { notified: false, sounded: false, reason: 'never' }

    // 提示音：事件一发生就响，不看窗口焦点。窗口在前台时系统常常不给我们横幅，
    // 声音是唯一能确认「这一轮结束了」的反馈，所以不能跟着 system 一起被抑制。
    let sounded = false
    const sound = settings.sound ?? type.sound
    if (settings.soundEnabled === true && sound !== 'none' && settings.volume !== 0) {
      // 多个会话同一瞬间结束（并行子会话、批量重跑）时只响一次：连续触发没有更多信息量，
      // 叠在一起反而听不出是几声。窗口内的后续触发静默丢弃，窗口外照常响。
      const now = this.now()
      if (now - this.lastSoundAt >= SOUND_WINDOW) {
        try {
          sounded = this.deps.playSound(sound, settings.volume) !== false
        } catch {
          // 声音失败不影响提醒。
          sounded = false
        }
        if (sounded) this.lastSoundAt = now
      }
    }

    // 前台 = 文档可见且有焦点；系统横幅此时基本不弹，弹了也点不回会话，所以只剩 always 要发。
    const away = this.deps.isHidden() === true || this.deps.hasFocus?.() === false
    const system = away || mode === 'always'

    const title = typeof event.title === 'string' && event.title.trim() !== ''
      ? event.title.trim()
      : this.deps.t('untitled')
    const body = notificationBody(event, this.deps.t)

    if (!system) {
      // 窗口在前台且时机是「仅在失焦时」：什么都不弹。区分「你正看着它」便于诊断。
      let viewing = false
      try {
        viewing = this.deps.isCurrent?.(event.sessionId) === true
      } catch {
        viewing = false
      }
      return { notified: false, sounded, title, body, reason: viewing ? 'current' : 'foreground' }
    }

    let notified = false
    try {
      notified = this.deps.showNotification({
        title,
        body,
        // 一条通知一张卡片：按会话 + 类型折叠，同一会话的类型不会互相覆盖。
        // 必须走 notificationTag：原生长度上限会让超长 tag 的通知整条消失（见该函数注释）。
        tag: notificationTag(event.sessionId, event.kind),
        kind: event.kind,
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
