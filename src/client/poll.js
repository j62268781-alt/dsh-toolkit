/** Poll only after the previous read settles. Callers own visibility and result projection. */
export function startPolling(task, { intervalMs, onError = () => {} }) {
  let stopped = false, timer, pending, controller
  const delay = () => typeof intervalMs === 'function' ? intervalMs() : intervalMs
  function refresh() {
    if (stopped) return Promise.resolve()
    if (pending) return pending
    clearTimeout(timer)
    controller = new AbortController()
    const active = controller
    pending = Promise.resolve().then(() => {
      if (!stopped) return task(active.signal)
    }).catch(error => {
      if (!stopped && !active.signal.aborted) onError(error)
    }).finally(() => {
      pending = undefined
      if (!stopped) timer = setTimeout(refresh, delay())
    })
    return pending
  }
  refresh()
  return {
    refresh,
    stop() {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
    },
  }
}
