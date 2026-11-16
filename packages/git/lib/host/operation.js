export function createOperation({ timeoutMs, signal: parentSignal } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    let aborted = false;
    let timer;
    const abortFromParent = () => {
        if (controller.signal.aborted)
            return;
        aborted = true;
        controller.abort(parentSignal?.reason);
    };
    if (parentSignal?.aborted) {
        abortFromParent();
    }
    else {
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
        if (timeoutMs !== undefined) {
            timer = setTimeout(() => {
                if (controller.signal.aborted)
                    return;
                timedOut = true;
                controller.abort(new DOMException('Operation timed out', 'TimeoutError'));
            }, Math.max(1, timeoutMs));
        }
    }
    let disposed = false;
    return {
        signal: controller.signal,
        get timedOut() { return timedOut; },
        get aborted() { return aborted; },
        throwIfAborted() {
            if (!controller.signal.aborted)
                return;
            if (aborted)
                throw new DOMException('The operation was aborted', 'AbortError');
            throw new DOMException('The operation timed out', 'TimeoutError');
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            if (timer !== undefined)
                clearTimeout(timer);
            parentSignal?.removeEventListener('abort', abortFromParent);
        },
    };
}
//# sourceMappingURL=operation.js.map