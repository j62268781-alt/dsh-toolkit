export function createSerialQueue() {
    let tail = Promise.resolve();
    return {
        run(task) {
            const result = tail.then(() => task());
            // Swallow the failure for the chain only; the caller still receives it.
            tail = result.catch(() => { });
            return result;
        },
    };
}
//# sourceMappingURL=serial.js.map