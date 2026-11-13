/** Poll only after the previous read settles. Callers own visibility and result projection. */

export interface PollingOptions {
  /** A function re-reads the interval, so a caller can slow down after a failure. */
  intervalMs: number | (() => number)
  onError?(error: unknown): void
}

export interface Polling {
  refresh(): Promise<void>
  stop(): void
}

export function startPolling(
  task: (signal: AbortSignal) => Promise<unknown> | unknown,
  { intervalMs, onError = () => {} }: PollingOptions,
): Polling {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let controller: AbortController | undefined
  const delay = (): number => typeof intervalMs === 'function' ? intervalMs() : intervalMs
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (pending) return pending
    clearTimeout(timer)
    controller = new AbortController()
    const active = controller
    pending = Promise.resolve().then(() => {
      if (!stopped) return task(active.signal)
    }).catch((error: unknown) => {
      if (!stopped && !active.signal.aborted) onError(error)
    }).finally(() => {
      pending = undefined
      if (!stopped) timer = setTimeout(refresh, delay())
    })
    return pending
  }
  void refresh()
  return {
    refresh,
    stop() {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
    },
  }
}
