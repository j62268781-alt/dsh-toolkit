import { existsSync } from 'node:fs'
import path from 'node:path'

/** Find a command in PATH without invoking a shell. */
export function findExecutableOnPath(command, {
  pathValue = process.env.PATH ?? '',
  platform = process.platform,
  extensions = platform === 'win32' ? ['.exe', '.com'] : [''],
  exists = existsSync,
} = {}) {
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

const EMPTY = Symbol('unresolved executable')

/** Cache a sync or async locator result and allow explicit invalidation. */
export function createExecutableResolver(locate) {
  let value = EMPTY
  let flight
  let generation = 0

  return {
    resolve() {
      if (value !== EMPTY) return value
      if (flight !== undefined) return flight.promise

      const currentGeneration = generation
      let result
      try {
        result = locate()
      } catch (error) {
        throw error
      }
      if (result === null || typeof result !== 'object' || typeof result.then !== 'function') {
        if (generation === currentGeneration) value = result
        return result
      }

      const current = {}
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
