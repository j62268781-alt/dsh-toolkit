/**
 * 「最近执行」的环形缓冲。
 *
 * 面板需要回答的问题不是「配了什么」，而是「刚才那次到底跑没跑、多久、结果如何」——
 * Qoder 是在回复下方给汇总，这里没地方放，就退化成设置页里的一张最近执行表。
 */
export interface HookRunRecord {
  id: number
  at: number
  event: string
  command: string
  source: string
  decision: string
  durationMs: number
  code: number | null
  timedOut: boolean
  reason: string
  error: string
}

export interface HookHistory {
  push(record: Omit<HookRunRecord, 'id' | 'at'> & { at?: number }): HookRunRecord
  list(): HookRunRecord[]
  clear(): void
}

export function createHookHistory(limit: number): HookHistory {
  const capacity = Math.max(0, Math.floor(limit))
  const records: HookRunRecord[] = []
  let nextId = 0

  return {
    push(record) {
      const entry: HookRunRecord = { ...record, id: ++nextId, at: record.at ?? Date.now() }
      if (capacity === 0) return entry
      records.push(entry)
      if (records.length > capacity) records.splice(0, records.length - capacity)
      return entry
    },
    list() {
      // 新的在前：面板从上往下读，最近一次应该在第一行。
      return [...records].reverse()
    },
    clear() {
      records.length = 0
    },
  }
}
