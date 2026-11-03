/** Share current work by key. Invalidating a flight detaches it without cancelling its callers. */
export class Singleflight {
  #flights = new Map()

  has(key) {
    return this.#flights.has(key)
  }

  run(key, load, { onValue, onError } = {}) {
    const current = this.#flights.get(key)
    if (current) return current.promise

    const entry = {}
    entry.promise = Promise.resolve().then(load).then(value => {
      if (this.#flights.get(key) === entry) onValue?.(value)
      return value
    }, error => {
      if (this.#flights.get(key) === entry) onError?.(error)
      throw error
    }).finally(() => {
      if (this.#flights.get(key) === entry) this.#flights.delete(key)
    })
    this.#flights.set(key, entry)
    return entry.promise
  }

  invalidate(key) {
    this.#flights.delete(key)
  }

  clear() {
    this.#flights.clear()
  }
}
