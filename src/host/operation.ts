/** A cancellation/deadline scope shared by every step of one operation. */
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

export function createOperation({ timeoutMs, signal: parentSignal }: {
  timeoutMs?: number
  signal?: AbortSignal
} = {}): Operation {
  const controller = new AbortController()
  let timedOut = false
  let aborted = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const abortFromParent = (): void => {
    if (controller.signal.aborted) return
    aborted = true
    controller.abort(parentSignal?.reason)
  }

  if (parentSignal?.aborted) {
    abortFromParent()
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (controller.signal.aborted) return
        timedOut = true
        controller.abort(new DOMException('Operation timed out', 'TimeoutError'))
      }, Math.max(1, timeoutMs))
    }
  }

  let disposed = false
  return {
    signal: controller.signal,
    get timedOut() { return timedOut },
    get aborted() { return aborted },
    throwIfAborted() {
      if (!controller.signal.aborted) return
      if (aborted) throw new DOMException('The operation was aborted', 'AbortError')
      throw new DOMException('The operation timed out', 'TimeoutError')
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
  }
}
