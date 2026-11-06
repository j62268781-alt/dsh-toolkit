/**
 * 「提醒卡片」的小型内存 store。
 *
 * 为什么需要它：系统通知（浏览器 / 桌面横幅）依赖平台权限，窗口在前台时多数平台根本不弹，
 * 或者弹了也点不回来。因此窗口聚焦时的提醒改走应用内卡片 —— 这条通道不依赖任何系统权限，
 * 卡片上的点击由我们自己的 DOM 处理，一定拿得到。
 *
 * 与 recent.js 一样是纯内存：只记录本次页面生命周期里待展示的卡片，不持久化。
 * 这里不放 DOM、不放计时器：React 侧通过 `useSyncExternalStore` 订阅，
 * 自动消失的计时器由组件持有（组件卸载后计时器一并清理）。
 */

/** 最多同时显示几张卡片；更早的会被丢弃。 */
export const TOAST_LIMIT = 3

/** 错误文案的截断上限：卡片上只放得下一行提示。 */
export const TOAST_ERROR_LIMIT = 160

/** 标题/正文的截断上限（正文在分发器里已经截到 160）。 */
const TEXT_LIMIT = 200

/**
 * @typedef {object} AttentionCard
 * @property {number} id 自增 id（React key，也用于 dismiss）。
 * @property {string} sessionId 会话 id（点击卡片时打开它）。
 * @property {string} kind 提醒类型。
 * @property {string} title 会话标题。
 * @property {string} body 通知正文。
 * @property {number} at 时间戳（毫秒）。
 * @property {string} [error] 导航失败时给用户看的一行原因。
 */

/** 把任意输入压成单行、有上限的字符串；占位符不会变成 "undefined"。 */
function text(value, max = TEXT_LIMIT) {
  const collapsed = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(1, max - 1))}…`
}

/**
 * 创建一个提醒卡片 store。
 *
 * 快照是「新的在最前面」的数组（渲染时最新的卡片在最上面）；引用在两次变更之间保持不变，
 * 因此可以直接交给 `useSyncExternalStore`。超过上限时丢的是最旧的那张。
 *
 * @param {number} [limit] 同时保留几张卡片。
 */
export function createToastStore(limit = TOAST_LIMIT) {
  /** @type {AttentionCard[]} */
  let items = []
  let sequence = 0
  const listeners = new Set()

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 单个订阅者出错不影响其他订阅者。
      }
    }
  }

  return {
    /** 当前快照（引用稳定，供 useSyncExternalStore 使用）。 */
    getSnapshot() {
      return items
    },
    /** 订阅变更。 */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /**
     * 推一张卡片（新的在最前面）。
     * @param {{kind?: string, sessionId?: string, title?: string, body?: string, at?: number, error?: string}} entry 卡片内容。
     * @returns {AttentionCard} 已经落库的记录（带自增 id）。
     */
    push(entry) {
      /** @type {AttentionCard} */
      const record = {
        id: (sequence += 1),
        sessionId: text(entry?.sessionId),
        kind: text(entry?.kind),
        title: text(entry?.title),
        body: text(entry?.body),
        at: Number.isFinite(entry?.at) ? Number(entry.at) : Date.now(),
      }
      if (typeof entry?.error === 'string' && entry.error !== '') {
        record.error = text(entry.error, TOAST_ERROR_LIMIT)
      }
      items = [record, ...items].slice(0, Math.max(1, limit))
      notify()
      return record
    },
    /**
     * 关掉一张卡片。
     * @param {number} id 卡片 id。
     * @returns {boolean} 是否真的移除了一张。
     */
    dismiss(id) {
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return false
      items = [...items.slice(0, index), ...items.slice(index + 1)]
      notify()
      return true
    },
    /** 清空所有卡片。 */
    clear() {
      if (items.length === 0) return
      items = []
      notify()
    },
    /**
     * 把「导航失败」的原因记到某张卡片上；再次导航成功时可用空字符串清掉。
     * 文案有上限：卡片只展示一行，原始错误仍然留在控制台日志里。
     * @param {number} id 卡片 id。
     * @param {string} message 已本地化的一行文案。
     * @returns {AttentionCard|undefined} 更新后的记录；卡片已消失时返回 undefined。
     */
    setError(id, message) {
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return undefined
      const bounded = text(message, TOAST_ERROR_LIMIT)
      const current = items[index]
      if ((current.error ?? '') === bounded) return current
      /** @type {AttentionCard} */
      const next = { ...current }
      if (bounded === '') delete next.error
      else next.error = bounded
      items = [...items.slice(0, index), next, ...items.slice(index + 1)]
      notify()
      return next
    },
  }
}
