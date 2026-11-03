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
    const poll = startPolling(() => refresh(), { intervalMs: 700 })
    return () => poll.stop()
  }, [form])
}
