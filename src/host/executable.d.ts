export interface ExecutableResolver<T> {
  resolve(): T | Promise<T>
  invalidate(): void
}

export declare function findExecutableOnPath(command: string, options?: {
  pathValue?: string
  platform?: string
  extensions?: readonly string[]
  exists?: (path: string) => boolean
}): string | null

export declare function createExecutableResolver<T>(locate: () => T | PromiseLike<T>): ExecutableResolver<T>
