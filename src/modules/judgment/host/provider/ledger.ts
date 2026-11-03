/**
 * 审计 ledger：**append-only JSONL**，一次尝试两行——
 * 发包前先落 `dispatch`（所以"钱花出去了但进程崩了"也留得下痕迹），回来后补 `settled`。
 *
 * 它同时是**逐小时配额的计数来源**：配额不能因为进程重启就归零，
 * 所以启动后第一次查配额时会从文件尾部回读窗口内的记录（最多读取尾部 256KB；读取范围有界，不保证覆盖整小时）。
 *
 * 两条纪律：
 * - **落盘失败不阻断判断**：文件写不进去不该不给你判断，但要让调用方知道（日志）。
 * - **绝不写入密钥值**：记录里只有引用名、模型名、指纹、计量（§13.2）。
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JudgmentBudget } from '../contract/index.js'

/** 配额窗口固定 1 小时（配置里只暴露"每小时多少次/多少 token"）。 */
export const WINDOW_MS = 60 * 60 * 1000

/** 回读文件尾部这么多字节来找窗口内的记录。 */
const TAIL_BYTES = 256 * 1024

/** 日志接口：`ctx.logger` 的最小形状，便于测试注入。 */
export interface LedgerLogger {
  warn(message: string): void
}

export interface LedgerStart {
  readonly id: string
  readonly at: string
  readonly kind: 'ask' | 'health'
  readonly connection: string
  readonly protocol: string
  readonly model: string
  readonly purpose?: string
  readonly fingerprint?: string
  readonly questionIds: readonly string[]
  readonly stateBytes: number
  readonly budget?: JudgmentBudget
}

export interface LedgerSettle {
  readonly id: string
  readonly at: string
  readonly outcome: 'ok' | 'error'
  readonly latencyMs: number
  readonly connection?: string
  readonly purpose?: string
  /** Original dispatch timestamp anchors input-token usage to the request's rolling window. */
  readonly dispatchAt?: string
  readonly model?: string
  readonly requestId?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly errorCode?: string
  readonly validationRule?: string
  /**
   * 校验失败时的实测数值。记进账是为了**校准可复算**：
   * "Σp 与候选数正相关"这类结论应该能从 ledger 直接算出来，而不是靠手记一遍。
   */
  readonly validationSum?: number
  readonly validationOptionCount?: number
  /** 声明的预算事后被超出（token / 成本只能事后比，见 README 的诚实说明）。 */
  readonly budgetExceeded?: boolean
}

/** 窗口内用量，按 `connection:<id>` 与 `purpose:<name>` 两个维度各记一份。 */
export interface QuotaUsage {
  calls: number
  inputTokens: number
}

/** $DSH_HOME 优先，退回 `~/.dsh`。 */
export function defaultLedgerPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'judgment-ledger.jsonl')
}

export interface QuotaReservation {
  /** Atomically convert the reserved call into a dispatch record. */
  start(record: LedgerStart): Promise<void>
  /** Release admission when work fails before dispatch. */
  release(): Promise<void>
}

type UsageEvent = { at: number; deltas: Map<string, QuotaUsage> }
type ReservationState = { callKeys: readonly string[]; serialKeys: readonly string[]; attemptId?: string }
type AttemptScope = { connection: string; purpose?: string; at: number }

export class Ledger {
  private readonly path: string | undefined
  private readonly warn: (message: string) => void
  private readonly events: UsageEvent[] = []
  private readonly reservations = new Map<string, ReservationState>()
  private readonly starts = new Map<string, AttemptScope>()
  private serial: Promise<void> = Promise.resolve()
  private waiters = new Set<() => void>()
  private seeded = false
  private masked = false

  constructor(options: { path?: string; enabled: boolean; logger?: LedgerLogger }) {
    this.path = options.enabled ? (options.path === undefined || options.path === '' ? defaultLedgerPath() : options.path) : undefined
    this.warn = (message) => options.logger?.warn(message)
  }

  /** 未启用落盘时（`ledger.enabled: false`）计量只在进程内，配额因此不跨重启。 */
  get persistent(): boolean {
    return this.path !== undefined
  }

  newId(): string {
    return randomUUID()
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work, work)
    this.serial = result.then(() => undefined, () => undefined)
    return result
  }

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) return
    await this.seed()
    this.seeded = true
  }

  private waitForChange(signal?: AbortSignal): { promise: Promise<boolean>; cancel: () => void } {
    let resolve!: (changed: boolean) => void
    const promise = new Promise<boolean>((done) => { resolve = done })
    const wake = (): void => resolve(true)
    const abort = (): void => resolve(false)
    if (signal?.aborted === true) abort()
    else {
      this.waiters.add(wake)
      signal?.addEventListener('abort', abort, { once: true })
    }
    return {
      promise,
      cancel: () => {
        this.waiters.delete(wake)
        signal?.removeEventListener('abort', abort)
      },
    }
  }

  private notifyChange(): void {
    const waiters = [...this.waiters]
    this.waiters.clear()
    for (const wake of waiters) wake()
  }

  private async write(line: Record<string, unknown>): Promise<void> {
    if (this.path !== undefined) {
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await appendFile(this.path, `${JSON.stringify(line)}\n`, 'utf8')
      } catch (error) {
        // 只报一次，避免每次调用都刷屏；但确实要说出来。
        if (!this.masked) {
          this.masked = true
          this.warn(`审计 ledger 写不进去（${this.path}）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    this.accumulate(line)
  }

  async start(record: LedgerStart): Promise<void> {
    await this.exclusive(async () => {
      await this.ensureSeeded()
      await this.write({ ...record, event: 'dispatch' })
    })
  }

  async settle(record: LedgerSettle): Promise<void> {
    await this.exclusive(async () => {
      await this.ensureSeeded()
      const scope = this.starts.get(record.id)
      await this.write({
        ...record,
        ...(record.connection === undefined && scope !== undefined ? { connection: scope.connection } : {}),
        ...(record.purpose === undefined && scope?.purpose !== undefined ? { purpose: scope.purpose } : {}),
        ...(record.dispatchAt === undefined && scope !== undefined ? { dispatchAt: new Date(scope.at).toISOString() } : {}),
        event: 'settled',
      })
      this.starts.delete(record.id)
      for (const [reservationId, reservation] of this.reservations) {
        if (reservation.attemptId === record.id) this.reservations.delete(reservationId)
      }
      this.notifyChange()
    })
  }

  /** Check usage and reserve call slots as one serialized operation. */
  async reserve(
    callKeys: readonly string[],
    serialKeys: readonly string[],
    admit: (usage: ReadonlyMap<string, QuotaUsage>) => void,
    signal?: AbortSignal,
  ): Promise<QuotaReservation> {
    const id = randomUUID()
    const uniqueCalls = [...new Set(callKeys)]
    const uniqueSerial = [...new Set(serialKeys)]
    for (;;) {
      const wait = this.waitForChange(signal)
      let reservation: QuotaReservation | undefined
      try {
        reservation = await this.exclusive(async () => {
          await this.ensureSeeded()
          if (signal?.aborted === true) throw new DOMException('The operation was aborted', 'AbortError')
          const conflicts = [...this.reservations.values()].some((item) =>
            item.serialKeys.some((key) => uniqueSerial.includes(key)) ||
            item.serialKeys.some((key) => uniqueCalls.includes(key)) ||
            uniqueSerial.some((key) => item.callKeys.includes(key)))
          if (conflicts) return undefined

          const usage = this.usageAt(Date.now())
          admit(usage)
          this.reservations.set(id, { callKeys: uniqueCalls, serialKeys: uniqueSerial })
          let committed = false
          return {
            start: async (record: LedgerStart) => {
              if (committed) return
              committed = true
              await this.exclusive(async () => {
                await this.ensureSeeded()
                const attemptId = record.id
                const scope = {
                  connection: record.connection,
                  ...(record.purpose === undefined ? {} : { purpose: record.purpose }),
                  at: Date.parse(record.at),
                }
                this.starts.set(attemptId, scope)
                await this.write({ ...record, event: 'dispatch' })
                if (uniqueSerial.length > 0) {
                  this.reservations.set(id, { callKeys: [], serialKeys: uniqueSerial, attemptId })
                } else {
                  this.reservations.delete(id)
                }
                this.notifyChange()
              })
            },
            release: async () => {
              if (committed) return
              committed = true
              await this.exclusive(async () => {
                this.reservations.delete(id)
                this.notifyChange()
              })
            },
          }
        })
      } catch (error) {
        wait.cancel()
        throw error
      }
      if (reservation !== undefined) {
        wait.cancel()
        return reservation
      }
      const changed = await wait.promise
      wait.cancel()
      if (!changed) throw new DOMException('The operation was aborted', 'AbortError')
    }
  }

  /** Windowed usage plus currently admitted calls, recalculated against the current time. */
  async usage(): Promise<ReadonlyMap<string, QuotaUsage>> {
    return await this.exclusive(async () => {
      await this.ensureSeeded()
      return this.usageAt(Date.now())
    })
  }

  private usageAt(now: number): ReadonlyMap<string, QuotaUsage> {
    const cutoff = now - WINDOW_MS
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index]!.at < cutoff) this.events.splice(index, 1)
    }
    const usage = new Map<string, QuotaUsage>()
    const bump = (key: string, calls: number, inputTokens: number): void => {
      const current = usage.get(key) ?? { calls: 0, inputTokens: 0 }
      usage.set(key, { calls: current.calls + calls, inputTokens: current.inputTokens + inputTokens })
    }
    for (const event of this.events) {
      for (const [key, delta] of event.deltas) bump(key, delta.calls, delta.inputTokens)
    }
    for (const reservation of this.reservations.values()) {
      for (const key of reservation.callKeys) bump(key, 1, 0)
    }
    return usage
  }

  private accumulate(line: Record<string, unknown>): void {
    const recordedAt = typeof line.at === 'string' ? Date.parse(line.at) : Number.NaN
    const dispatchAt = line.event === 'settled' && typeof line.dispatchAt === 'string'
      ? Date.parse(line.dispatchAt)
      : Number.NaN
    const deltas = new Map<string, QuotaUsage>()
    const connection = typeof line.connection === 'string' ? line.connection : ''
    const purpose = typeof line.purpose === 'string' ? line.purpose : ''
    if (line.event === 'dispatch') {
      if (!Number.isFinite(recordedAt) || recordedAt < Date.now() - WINDOW_MS) return
      if (connection !== '') deltas.set(`connection:${connection}`, { calls: 1, inputTokens: 0 })
      if (purpose !== '') deltas.set(`purpose:${purpose}`, { calls: 1, inputTokens: 0 })
      if (typeof line.id === 'string' && connection !== '') {
        this.starts.set(line.id, { connection, ...(purpose === '' ? {} : { purpose }), at: recordedAt })
      }
      if (deltas.size > 0) this.events.push({ at: recordedAt, deltas })
    } else if (line.event === 'settled') {
      const scope = typeof line.id === 'string' ? this.starts.get(line.id) : undefined
      const at = Number.isFinite(dispatchAt) ? dispatchAt : scope?.at ?? recordedAt
      const resolvedConnection = connection || scope?.connection || ''
      const resolvedPurpose = purpose || scope?.purpose || ''
      if (!Number.isFinite(at) || at < Date.now() - WINDOW_MS) {
        if (typeof line.id === 'string') this.starts.delete(line.id)
        return
      }
      const tokens = typeof line.inputTokens === 'number' && Number.isFinite(line.inputTokens) ? line.inputTokens : 0
      if (resolvedConnection !== '') deltas.set(`connection:${resolvedConnection}`, { calls: 0, inputTokens: tokens })
      if (resolvedPurpose !== '') deltas.set(`purpose:${resolvedPurpose}`, { calls: 0, inputTokens: tokens })
      if (typeof line.id === 'string') this.starts.delete(line.id)
      if (deltas.size > 0) this.events.push({ at, deltas })
    }
  }

  /** 从文件尾部回读窗口内的记录，把计数播进内存。 */
  private async seed(): Promise<void> {
    if (this.path === undefined) return
    let text = ''
    let truncated = false
    try {
      const handle = await open(this.path, 'r')
      try {
        const { size } = await handle.stat()
        const start = Math.max(0, size - TAIL_BYTES)
        truncated = start > 0
        const buffer = Buffer.alloc(Number(size) - start)
        await handle.read(buffer, 0, buffer.length, start)
        text = buffer.toString('utf8')
      } finally {
        await handle.close()
      }
    } catch {
      // 文件还不存在：正常情况（第一次用）。
      return
    }
    const lines = text.split('\n')
    // **只有**从文件中间开始读时，首行才可能被截断；从头读还丢掉首行就是漏记一条。
    if (truncated && lines.length > 1) lines.shift()
    const cutoff = Date.now() - WINDOW_MS
    const tailScopes = new Map<string, AttemptScope>()
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '') continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const at = typeof parsed.at === 'string' ? Date.parse(parsed.at) : Number.NaN
        if (!Number.isFinite(at)) continue
        if (parsed.event === 'dispatch' && typeof parsed.id === 'string') {
          const connection = typeof parsed.connection === 'string' ? parsed.connection : ''
          if (connection !== '') {
            tailScopes.set(parsed.id, {
              connection,
              ...(typeof parsed.purpose === 'string' ? { purpose: parsed.purpose } : {}),
              at,
            })
          }
          if (at >= cutoff) this.accumulate(parsed)
          continue
        }
        if (parsed.event === 'settled') {
          const scope = typeof parsed.id === 'string' ? tailScopes.get(parsed.id) : undefined
          const replay = scope === undefined ? parsed : {
            ...parsed,
            connection: parsed.connection ?? scope.connection,
            purpose: parsed.purpose ?? scope.purpose,
            dispatchAt: parsed.dispatchAt ?? new Date(scope.at).toISOString(),
          }
          this.accumulate(replay)
        }
      } catch {
        // 坏行跳过：审计文件不该因为一行脏数据让插件不能用。
      }
    }
  }
}
