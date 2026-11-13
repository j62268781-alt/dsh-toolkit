/** Same-key work deduplication. Cache TTL and forced refresh policy belong to the caller. */
export interface SingleflightHooks<V> {
  onValue?: (value: V) => void
  onError?: (error: unknown) => void
}

export class Singleflight<K = unknown, V = unknown> {
  #flights = new Map<K, { promise: Promise<V> }>()

  has(key: K): boolean {
    return this.#flights.has(key)
  }

  run(key: K, load: () => V | PromiseLike<V>, { onValue, onError }: SingleflightHooks<V> = {}): Promise<V> {
    const current = this.#flights.get(key)
    if (current) return current.promise

    const entry = {} as { promise: Promise<V> }
    entry.promise = Promise.resolve().then(load).then((value) => {
      // Only the flight that is still current publishes its result; an invalidated one
      // settles its callers but leaves the replacement alone.
      if (this.#flights.get(key) === entry) onValue?.(value)
      return value
    }, (error: unknown) => {
      if (this.#flights.get(key) === entry) onError?.(error)
      throw error
    }).finally(() => {
      if (this.#flights.get(key) === entry) this.#flights.delete(key)
    })
    this.#flights.set(key, entry)
    return entry.promise
  }

  /** Detach current work: its original callers still settle, but neither hook runs. */
  invalidate(key: K): void {
    this.#flights.delete(key)
  }

  clear(): void {
    this.#flights.clear()
  }
}
