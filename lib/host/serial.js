/** Serialize related async mutations while allowing later work after rejection. */
export function createSerialQueue() {
  let tail = Promise.resolve()
  return {
    run(task) {
      const result = tail.then(() => task())
      tail = result.catch(() => {})
      return result
    },
  }
}
