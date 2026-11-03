export interface SerialQueue {
  run<T>(task: () => T | PromiseLike<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue
