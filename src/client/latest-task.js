/** One owner for replaceable reads. Invalidating also cancels transports that honor signal. */
export function createLatestTask() {
  let current
  return {
    begin() {
      current?.abort()
      const controller = new AbortController()
      current = controller
      return { signal: controller.signal, isCurrent: () => current === controller && !controller.signal.aborted }
    },
    invalidate() {
      current?.abort()
      current = undefined
    },
  }
}
