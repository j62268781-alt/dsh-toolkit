/** Serialize related async mutations while allowing later work after rejection. */
export interface SerialQueue {
    run<T>(task: () => T | PromiseLike<T>): Promise<T>;
}
export declare function createSerialQueue(): SerialQueue;
//# sourceMappingURL=serial.d.ts.map