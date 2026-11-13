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
