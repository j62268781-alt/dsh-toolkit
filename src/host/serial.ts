/** Serialize related async mutations while allowing later work after rejection. */
export interface SerialQueue {
  run<T>(task: () => T | PromiseLike<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => T | PromiseLike<T>): Promise<T> {
      const result = tail.then(() => task())
      // Swallow the failure for the chain only; the caller still receives it.
      tail = result.catch(() => {})
      return result
    },
  }
}
