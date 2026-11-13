export interface ExecutableResolver<T> {
    resolve(): T | Promise<T>;
    invalidate(): void;
}
/** Find a command in PATH without invoking a shell. */
export declare function findExecutableOnPath(command: string, { pathValue, platform, extensions, exists, }?: {
    pathValue?: string;
    platform?: string;
    extensions?: readonly string[];
    exists?: (path: string) => boolean;
}): string | null;
/** Cache a sync or async locator result and allow explicit invalidation. */
export declare function createExecutableResolver<T>(locate: () => T | PromiseLike<T>): ExecutableResolver<T>;
//# sourceMappingURL=executable.d.ts.map