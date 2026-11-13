export class Singleflight {
    #flights = new Map();
    has(key) {
        return this.#flights.has(key);
    }
    run(key, load, { onValue, onError } = {}) {
        const current = this.#flights.get(key);
        if (current)
            return current.promise;
        const entry = {};
        entry.promise = Promise.resolve().then(load).then((value) => {
            // Only the flight that is still current publishes its result; an invalidated one
            // settles its callers but leaves the replacement alone.
            if (this.#flights.get(key) === entry)
                onValue?.(value);
            return value;
        }, (error) => {
            if (this.#flights.get(key) === entry)
                onError?.(error);
            throw error;
        }).finally(() => {
            if (this.#flights.get(key) === entry)
                this.#flights.delete(key);
        });
        this.#flights.set(key, entry);
        return entry.promise;
    }
    /** Detach current work: its original callers still settle, but neither hook runs. */
    invalidate(key) {
        this.#flights.delete(key);
    }
    clear() {
        this.#flights.clear();
    }
}
//# sourceMappingURL=singleflight.js.map