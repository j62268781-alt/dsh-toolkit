/** Poll only after the previous read settles. Callers own result projection. */

export interface PollingOptions {
  /** A function re-reads the interval, so a caller can slow down after a failure. */
  intervalMs: number | (() => number)
  /**
   * Stop arming the next tick while the tab is hidden, and refresh once as soon as
   * it becomes visible again. Opt-in: callers that already throttle hidden work
   * themselves keep arming the timer (their contract may rely on slow hidden reads).
   */
  pauseWhenHidden?: boolean
  onError?(error: unknown): void
}

export interface Polling {
  refresh(): Promise<void>
  stop(): void
}

function hasDocument(): boolean {
  return typeof document !== 'undefined' && typeof document.addEventListener === 'function'
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function startPolling(
  task: (signal: AbortSignal) => Promise<unknown> | unknown,
  { intervalMs, pauseWhenHidden = false, onError = () => {} }: PollingOptions,
): Polling {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let controller: AbortController | undefined
  const pauses = pauseWhenHidden && hasDocument()
  const delay = (): number => typeof intervalMs === 'function' ? intervalMs() : intervalMs
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (pending) return pending
    clearTimeout(timer)
    controller = new AbortController()
    const active = controller
    pending = Promise.resolve().then(() => (stopped ? undefined : task(active.signal))).then(() => undefined).catch((error: unknown) => {
      if (!stopped && !active.signal.aborted) onError(error)
    }).finally(() => {
      pending = undefined
      // A hidden tab has nobody looking: arm nothing, `visibilitychange` re-arms.
      if (!stopped && !(pauses && pageHidden())) timer = setTimeout(refresh, delay())
    })
    return pending
  }
  const onVisibilityChange = (): void => {
    if (stopped) return
    if (pageHidden()) {
      // Drop the tick that is already armed so hiding does not cost one more read.
      clearTimeout(timer)
      timer = undefined
      return
    }
    void refresh()
  }
  if (pauses) document.addEventListener('visibilitychange', onVisibilityChange)
  void refresh()
  return {
    refresh,
    stop() {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      if (pauses) document.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
