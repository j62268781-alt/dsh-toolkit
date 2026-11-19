/**
 * 会话级监控存储：内存聚合 + 防抖落盘。
 *
 * 落盘是为了「重启桌面端后面板还在」：事件流只活在进程里，手动来源更是用户资产。
 * 每个会话一个 JSON（`$DSH_HOME/toolkit-task-monitor/sessions/<id>.json`），tmp+rename
 * 原子写；读失败（不存在 / 坏文件）当空会话，聚合路径绝不抛错。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MAX_ENTRIES,
  MAX_SOURCE_LENGTH,
  TASK_MONITOR_REASON,
  ENTRY_KINDS,
  isHttpUrl,
  type TaskMonitorEntry,
  type TaskMonitorFailure,
  type TaskMonitorReasonCode,
  type TaskMonitorResult,
} from '../constants.js'
import { baseName, hostOf, type ClassifiedSeed } from './classify.js'

export interface TaskMonitorStoreOptions {
  home: string
  enabled?: () => boolean
  now?: () => number
  persistDelayMs?: number
}

export type AddSourceResult = { readonly ok: true, readonly entry: TaskMonitorEntry } | TaskMonitorFailure
export type RemoveSourceResult = { readonly ok: true } | TaskMonitorFailure

interface SessionState {
  entries: Map<string, TaskMonitorEntry>
  updatedAt: number
  dirty: boolean
  loading?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

const KINDS = new Set<string>(ENTRY_KINDS)

function failure(code: TaskMonitorReasonCode, detail: string): TaskMonitorFailure {
  return { ok: false, code, detail }
}

function validEntry(value: unknown): value is TaskMonitorEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && entry.id !== ''
    && typeof entry.kind === 'string' && KINDS.has(entry.kind)
    && typeof entry.label === 'string'
    && typeof entry.detail === 'string'
    && typeof entry.count === 'number'
    && typeof entry.updatedAt === 'number'
    && (entry.status === 'ok' || entry.status === 'failed')
    && (entry.target === undefined || typeof entry.target === 'string')
    && (entry.manual === undefined || typeof entry.manual === 'boolean')
}

export function createTaskMonitorStore(options: TaskMonitorStoreOptions) {
  const now = options.now ?? Date.now
  const delay = options.persistDelayMs ?? 800
  const enabled = options.enabled ?? (() => true)
  const sessions = new Map<string, SessionState>()
  const dir = join(options.home, 'toolkit-task-monitor', 'sessions')
  const fileOf = (sessionId: string): string => join(dir, `${encodeURIComponent(sessionId)}.json`)

  function stateOf(sessionId: string): SessionState {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      state = { entries: new Map(), updatedAt: 0, dirty: false }
      sessions.set(sessionId, state)
    }
    return state
  }

  async function load(sessionId: string, state: SessionState): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(fileOf(sessionId), 'utf8'))
      const entries = Array.isArray(parsed?.entries) ? parsed.entries.filter(validEntry) : []
      // 读盘期间可能已有新事件进内存：磁盘只补不覆盖。
      for (const entry of entries) {
        if (!state.entries.has(entry.id)) state.entries.set(entry.id, entry)
      }
      if (typeof parsed?.updatedAt === 'number') state.updatedAt = Math.max(state.updatedAt, parsed.updatedAt)
    } catch {
      /* 不存在或坏文件：空会话起步。 */
    }
  }

  function ensureLoaded(sessionId: string, state: SessionState): Promise<void> {
    state.loading ??= load(sessionId, state)
    return state.loading
  }

  async function persist(sessionId: string, state: SessionState): Promise<void> {
    state.dirty = false
    const payload = JSON.stringify({
      version: 1,
      sessionId,
      updatedAt: state.updatedAt,
      entries: [...state.entries.values()],
    })
    const tmp = `${fileOf(sessionId)}.tmp`
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, fileOf(sessionId))
    } catch {
      // 写失败保留 dirty，下一次 flush（会话释放 / 模块卸载）再试。
      state.dirty = true
    }
  }

  function schedule(sessionId: string, state: SessionState): void {
    if (state.timer !== undefined) return
    state.timer = setTimeout(() => {
      state.timer = undefined
      void persist(sessionId, state)
    }, delay)
    // 防抖计时器不该拖着进程不让退出。
    state.timer.unref?.()
  }

  function touch(state: SessionState): void {
    state.updatedAt = now()
    state.dirty = true
  }

  /** 超上限先淘汰最旧的非手动条目；手动来源是用户资产，永远保留。 */
  function evict(state: SessionState): void {
    if (state.entries.size <= MAX_ENTRIES) return
    const evictable = [...state.entries.values()]
      .filter((entry) => entry.manual !== true)
      .sort((left, right) => left.updatedAt - right.updatedAt)
    for (const entry of evictable) {
      if (state.entries.size <= MAX_ENTRIES) break
      state.entries.delete(entry.id)
    }
  }

  async function flush(sessionId: string): Promise<void> {
    const state = sessions.get(sessionId)
    if (state === undefined) return
    if (state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
    if (state.dirty) await persist(sessionId, state)
  }

  return {
    /** 工具事件聚合入口：失败也只影响监控自己，不碰工具链。 */
    async record(sessionId: string, seeds: readonly ClassifiedSeed[], status: 'ok' | 'failed'): Promise<void> {
      if (!enabled() || sessionId === '' || seeds.length === 0) return
      const state = stateOf(sessionId)
      await ensureLoaded(sessionId, state)
      const at = now()
      for (const seed of seeds) {
        const existing = state.entries.get(seed.id)
        state.entries.set(seed.id, existing === undefined
          ? { ...seed, count: 1, status, updatedAt: at }
          : { ...existing, count: existing.count + 1, status, updatedAt: at })
      }
      evict(state)
      touch(state)
      schedule(sessionId, state)
    },

    async snapshot(sessionId: unknown): Promise<TaskMonitorResult> {
      if (!enabled()) return failure(TASK_MONITOR_REASON.disabled, '任务监控已关闭。')
      if (typeof sessionId !== 'string' || sessionId === '') {
        return failure(TASK_MONITOR_REASON.invalidSession, '缺少 sessionId。')
      }
      const state = stateOf(sessionId)
      await ensureLoaded(sessionId, state)
      return { ok: true, sessionId, updatedAt: state.updatedAt, entries: [...state.entries.values()] }
    },

    async addSource(sessionId: unknown, kind: unknown, value: unknown): Promise<AddSourceResult> {
      if (!enabled()) return failure(TASK_MONITOR_REASON.disabled, '任务监控已关闭。')
      if (typeof sessionId !== 'string' || sessionId === '') {
        return failure(TASK_MONITOR_REASON.invalidSession, '缺少 sessionId。')
      }
      if (kind !== 'file' && kind !== 'url') {
        return failure(TASK_MONITOR_REASON.invalidSource, '来源类型只能是 file 或 url。')
      }
      if (typeof value !== 'string' || value.trim() === '') {
        return failure(TASK_MONITOR_REASON.invalidSource, kind === 'url' ? '链接不能为空。' : '路径不能为空。')
      }
      const trimmed = value.trim()
      if (trimmed.length > MAX_SOURCE_LENGTH) {
        return failure(TASK_MONITOR_REASON.invalidSource, `来源不能超过 ${MAX_SOURCE_LENGTH} 个字符。`)
      }
      if (kind === 'url' && !isHttpUrl(trimmed)) {
        return failure(TASK_MONITOR_REASON.invalidSource, '链接必须以 http:// 或 https:// 开头。')
      }
      const state = stateOf(sessionId)
      await ensureLoaded(sessionId, state)
      const id = `manual:${kind}:${trimmed}`
      const existing = state.entries.get(id)
      if (existing !== undefined) return { ok: true, entry: existing }
      const entry: TaskMonitorEntry = {
        id,
        kind: 'source',
        label: kind === 'url' ? hostOf(trimmed) : baseName(trimmed),
        detail: trimmed,
        target: trimmed,
        manual: true,
        count: 1,
        status: 'ok',
        updatedAt: now(),
      }
      state.entries.set(id, entry)
      touch(state)
      schedule(sessionId, state)
      return { ok: true, entry }
    },

    async removeSource(sessionId: unknown, id: unknown): Promise<RemoveSourceResult> {
      if (!enabled()) return failure(TASK_MONITOR_REASON.disabled, '任务监控已关闭。')
      if (typeof sessionId !== 'string' || sessionId === '') {
        return failure(TASK_MONITOR_REASON.invalidSession, '缺少 sessionId。')
      }
      if (typeof id !== 'string' || id === '') {
        return failure(TASK_MONITOR_REASON.notFound, '缺少来源 id。')
      }
      const state = stateOf(sessionId)
      await ensureLoaded(sessionId, state)
      const entry = state.entries.get(id)
      if (entry === undefined) return failure(TASK_MONITOR_REASON.notFound, '这条来源已不存在。')
      if (entry.manual !== true) return failure(TASK_MONITOR_REASON.notManual, '只有手动添加的来源可以移除。')
      state.entries.delete(id)
      touch(state)
      schedule(sessionId, state)
      return { ok: true }
    },

    flush,

    async dispose(): Promise<void> {
      await Promise.all([...sessions.keys()].map((sessionId) => flush(sessionId)))
    },
  }
}

export type TaskMonitorStore = ReturnType<typeof createTaskMonitorStore>