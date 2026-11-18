import { startPolling } from '../../../../client/poll.js'

/** Subscribe at the original state position; polling is installed separately below. */
export function useFormSnapshot(React, form) {
  const { useState, useEffect } = React
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const store = form?.store ?? form
    const subscribe = typeof store?.subscribe === 'function' ? store.subscribe.bind(store) : null
    if (subscribe === null) return undefined
    const unsubscribe = subscribe(() => setTick((n) => n + 1))
    return typeof unsubscribe === 'function' ? unsubscribe : undefined
  }, [form])
  const refresh = () => setTick((n) => n + 1)
  return { tick, refresh }
}

/** Keep form snapshots current with serialized fallback polling. */
export function useFormRefresh(React, form, refresh) {
  const { useEffect } = React
  useEffect(() => {
    // 面板不可见时没人看表单快照，停止这一拍，回到可见会立刻补一次。
    const poll = startPolling(() => refresh(), { intervalMs: 700, pauseWhenHidden: true })
    return () => poll.stop()
  }, [form])
}
