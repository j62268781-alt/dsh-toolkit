export interface Operation {
  readonly signal: AbortSignal
  /** True only when this scope's own deadline fired. */
  readonly timedOut: boolean
  /** True only when the parent signal was aborted. */
  readonly aborted: boolean
  throwIfAborted(): void
  /** Clear the deadline and detach the parent abort listener. */
  dispose(): void
}

export declare function createOperation(options?: {
  timeoutMs?: number
  signal?: AbortSignal
}): Operation
