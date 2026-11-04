/** Same-key work deduplication. Cache TTL and forced refresh policy belong to the caller. */
export declare class Singleflight<K = unknown, V = unknown> {
  has(key: K): boolean
  run(key: K, load: () => V | PromiseLike<V>, hooks?: {
    onValue?: (value: V) => void
    onError?: (error: unknown) => void
  }): Promise<V>
  /** Detach current work: its original callers still settle, but neither hook runs. */
  invalidate(key: K): void
  clear(): void
}
