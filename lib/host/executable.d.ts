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
export declare function isWindowsShim(command: string): boolean;
/**
 * 找命令时的候选后缀：`PATHEXT` 的顺序即优先级，但原生映像（`.exe`/`.com`）永远先试，
 * 否则同名 shim 会盖掉真正的二进制。PATHEXT 缺失时补默认值（含 npm 一定会写的 `.cmd`）。
 */
export declare function windowsExecutableExtensions(env?: NodeJS.ProcessEnv): string[];
/**
 * 与 `findExecutableOnPath` 同语义，但**把 Windows shim 也算候选**。
 * 用它来找「我们要真的执行」的命令；找到 shim 时必须配 `resolveSpawnTarget` 才跑得起来。
 */
export declare function findCommandOnPath(command: string, { pathValue, platform, extensions, exists, }?: {
    pathValue?: string;
    platform?: string;
    extensions?: readonly string[];
    exists?: (path: string) => boolean;
}): string | null;
export interface SpawnTarget {
    readonly command: string;
    readonly args: string[];
    readonly windowsVerbatimArguments?: boolean;
}
/**
 * 把一次 spawn 翻译成本机真能执行的形式：Windows 上的 `.cmd` / `.bat` 走
 * `cmd.exe /d /s /c "<整条命令行>"`（`/s` 让 cmd 原样保留首尾引号、不做额外剥离），
 * 其余命令原样返回。注意这里**不**用 `shell: true`：那会让所有参数再经一次 shell
 * 解析，`--allowed-domains=a&b` 这类正常值会被当成命令分隔符。
 */
export declare function resolveSpawnTarget(command: string, args?: readonly string[], platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): SpawnTarget;
/** Cache a sync or async locator result and allow explicit invalidation. */
export declare function createExecutableResolver<T>(locate: () => T | PromiseLike<T>): ExecutableResolver<T>;
//# sourceMappingURL=executable.d.ts.map