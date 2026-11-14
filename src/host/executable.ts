import { existsSync } from 'node:fs'
import path from 'node:path'

export interface ExecutableResolver<T> {
  resolve(): T | Promise<T>
  invalidate(): void
}

/** Find a command in PATH without invoking a shell. */
export function findExecutableOnPath(command: string, {
  pathValue = process.env.PATH ?? '',
  platform = process.platform,
  extensions = platform === 'win32' ? ['.exe', '.com'] : [''],
  exists = existsSync,
}: {
  pathValue?: string
  platform?: string
  extensions?: readonly string[]
  exists?: (path: string) => boolean
} = {}): string | null {
  if (typeof command !== 'string' || command === '') return null
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  for (const dir of String(pathValue).split(pathDelimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = pathApi.join(dir, `${command}${extension}`)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

/**
 * Windows 上 npm / pnpm 生成的命令行 shim（`.cmd` / `.bat`）不是原生可执行映像：
 * `CreateProcess` 不会执行它们，Node 18.20+ 的 `spawn('x.cmd')` 直接 EINVAL。
 * 所以「PATH 上找到就能跑」这条约定对 shim 不成立，必须由 ComSpec 包一层 ——
 * 这也是上面 `findExecutableOnPath` 默认只认 `.exe`/`.com` 的原因。
 */
const WINDOWS_SHIM = /\.(?:cmd|bat)$/i

export function isWindowsShim(command: string): boolean {
  return WINDOWS_SHIM.test(String(command ?? ''))
}

/**
 * 找命令时的候选后缀：`PATHEXT` 的顺序即优先级，但原生映像（`.exe`/`.com`）永远先试，
 * 否则同名 shim 会盖掉真正的二进制。PATHEXT 缺失时补默认值（含 npm 一定会写的 `.cmd`）。
 */
export function windowsExecutableExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = String(env['PATHEXT'] ?? '')
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '')
  const extensions = listed.length === 0 ? ['.com', '.exe', '.bat', '.cmd'] : listed
  const native = extensions.filter((item) => item === '.exe' || item === '.com')
  const rest = extensions.filter((item) => item !== '.exe' && item !== '.com')
  return [...new Set([...native, ...rest])]
}

/**
 * 与 `findExecutableOnPath` 同语义，但**把 Windows shim 也算候选**。
 * 用它来找「我们要真的执行」的命令；找到 shim 时必须配 `resolveSpawnTarget` 才跑得起来。
 */
export function findCommandOnPath(command: string, {
  pathValue = process.env.PATH ?? '',
  platform = process.platform,
  extensions = platform === 'win32' ? windowsExecutableExtensions() : [''],
  exists = existsSync,
}: {
  pathValue?: string
  platform?: string
  extensions?: readonly string[]
  exists?: (path: string) => boolean
} = {}): string | null {
  return findExecutableOnPath(command, { pathValue, platform, extensions, exists })
}

export interface SpawnTarget {
  readonly command: string
  readonly args: string[]
  readonly windowsVerbatimArguments?: boolean
}

/** cmd.exe 的命令行只认双引号；引号本身用两个引号转义。 */
function quoteForCmd(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * 把一次 spawn 翻译成本机真能执行的形式：Windows 上的 `.cmd` / `.bat` 走
 * `cmd.exe /d /s /c "<整条命令行>"`（`/s` 让 cmd 原样保留首尾引号、不做额外剥离），
 * 其余命令原样返回。注意这里**不**用 `shell: true`：那会让所有参数再经一次 shell
 * 解析，`--allowed-domains=a&b` 这类正常值会被当成命令分隔符。
 */
export function resolveSpawnTarget(
  command: string,
  args: readonly string[] = [],
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): SpawnTarget {
  if (platform !== 'win32' || !isWindowsShim(command)) return { command, args: [...args] }
  const shell = env['ComSpec'] ?? 'cmd.exe'
  const line = [quoteForCmd(command), ...args.map((arg) => quoteForCmd(String(arg)))].join(' ')
  return { command: shell, args: ['/d', '/s', '/c', line], windowsVerbatimArguments: true }
}

const EMPTY: unique symbol = Symbol('unresolved executable')

/** Cache a sync or async locator result and allow explicit invalidation. */
export function createExecutableResolver<T>(locate: () => T | PromiseLike<T>): ExecutableResolver<T> {
  let value: T | typeof EMPTY = EMPTY
  let flight: { promise: Promise<T> } | undefined
  let generation = 0

  return {
    resolve(): T | Promise<T> {
      if (value !== EMPTY) return value
      if (flight !== undefined) return flight.promise

      const currentGeneration = generation
      const result = locate()
      if (result === null || typeof result !== 'object' || typeof (result as PromiseLike<T>).then !== 'function') {
        // A late synchronous answer must not overwrite a newer invalidation.
        if (generation === currentGeneration) value = result as T
        return result as T
      }

      const current = {} as { promise: Promise<T> }
      current.promise = Promise.resolve(result).then((resolved) => {
        if (generation === currentGeneration && flight === current) value = resolved
        return resolved
      }).finally(() => {
        if (flight === current) flight = undefined
      })
      flight = current
      return current.promise
    },
    invalidate() {
      generation += 1
      value = EMPTY
      flight = undefined
    },
  }
}
