/** Same-key work deduplication. Cache TTL and forced refresh policy belong to the caller. */
export interface SingleflightHooks<V> {
    onValue?: (value: V) => void;
    onError?: (error: unknown) => void;
}
export declare class Singleflight<K = unknown, V = unknown> {
    #private;
    has(key: K): boolean;
    run(key: K, load: () => V | PromiseLike<V>, { onValue, onError }?: SingleflightHooks<V>): Promise<V>;
    /** Detach current work: its original callers still settle, but neither hook runs. */
    invalidate(key: K): void;
    clear(): void;
}
//# sourceMappingURL=singleflight.d.ts.map