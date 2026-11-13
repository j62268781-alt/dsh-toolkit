/**
 * 「最近通知」的小型内存 store。
 *
 * 它不是持久化数据：只记录本次页面生命周期里已经分发过的通知，用来在设置页上回看
 * 「标题 = 会话标题、副标题 = 最后一条回复」的实际效果，并且点击任意一条可以重新打开
 * 对应会话。React 侧通过 `useSyncExternalStore` 订阅，快照引用在两次变更之间保持不变。
 */

/** 最多保留多少条。 */
export const RECENT_LIMIT = 6

/**
 * @typedef {object} RecentNotification
 * @property {number} id 自增 id（React key）。
 * @property {string} kind 提醒类型。
 * @property {string} sessionId 会话 id。
 * @property {string} title 会话标题。
 * @property {string} body 通知正文。
 * @property {number} at 时间戳（毫秒）。
 */

/**
 * 创建一个最近通知 store。
 * @param {number} [limit] 保留条数。
 */
export function createRecentStore(limit = RECENT_LIMIT) {
  /** @type {RecentNotification[]} */
  let entries = []
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
      return entries
    },
    /** 订阅变更。 */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * 记一条已发出的通知（新的在最前面）。
     * @param {{kind: string, sessionId: string, title: string, body: string}} entry 通知内容。
     */
    add(entry) {
      const record = {
        id: (sequence += 1),
        kind: String(entry?.kind ?? ''),
        sessionId: String(entry?.sessionId ?? ''),
        title: String(entry?.title ?? ''),
        body: String(entry?.body ?? ''),
        at: Date.now(),
      }
      entries = [record, ...entries].slice(0, Math.max(1, limit))
      notify()
      return record
    },
    /** 清空列表。 */
    clear() {
      if (entries.length === 0) return
      entries = []
      notify()
    },
  }
}
