import { HttpFailure, httpFailure } from '../../../../host/routes.js'

export interface WorktreeConfig {
  directory: string
  namePrefix: string
  worktreePrefix?: string
}

export interface WorktreeConfigUpdate extends Pick<WorktreeConfig, 'directory' | 'namePrefix'> {
  expected: WorktreeConfig
  syncNamePrefix?: true
}

type RawConfig = Record<string, unknown>

interface Entry {
  options: { id: string; name?: string }
  fiber?: { state: number; effectiveConfig: unknown; resolveConfig(config: unknown): unknown }
}

export interface WorktreeConfigEditor {
  entries(): Entry[]
  edit(entry: Entry, change: (current: RawConfig, inherited: RawConfig) => RawConfig): Promise<void>
}

const MODULE = '@deepseek-ai/dsh-experimental-worktree'
const FORGE_MODULE = '@deepseek-ai/dsh-experimental-client-ui-forge'
const pendingWrites = new WeakMap<WorktreeConfigEditor, Promise<void>>()
// Installed Cordis FiberState.ACTIVE is a const enum, not a runtime export.
const ACTIVE = 2

function fields(value: unknown): WorktreeConfig | undefined {
  if (value === null || typeof value !== 'object') return
  const { directory, namePrefix, worktreePrefix } = value as Partial<WorktreeConfig>
  if (typeof directory === 'string' && typeof namePrefix === 'string'
    && (worktreePrefix === undefined || typeof worktreePrefix === 'string')) {
    return { directory, namePrefix, ...(worktreePrefix !== undefined ? { worktreePrefix } : {}) }
  }
}

function relativePath(path: string): boolean {
  return path.length > 0 && !/[\\:\0]/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

export function isWorktreeConfigUpdate(value: unknown): value is WorktreeConfigUpdate {
  const next = fields(value)
  const { expected, syncNamePrefix } = (value ?? {}) as Partial<WorktreeConfigUpdate>
  if (next === undefined || !fields(expected) || (syncNamePrefix !== undefined && syncNamePrefix !== true)) return false
  // Validate new values only; an unrelated directory edit must not re-validate an existing prefix.
  return (next.directory === '' || relativePath(next.directory))
    && ((syncNamePrefix !== true && next.namePrefix === expected?.namePrefix) || validPrefix(next.namePrefix))
}

function validPrefix(prefix: string): boolean {
  // Match the Forge constructor too: WorktreeService alone checks only the relative path.
  const name = `${prefix}0`
  return !name.startsWith('-') && !name.includes('..') && !name.includes('@{')
    && !Array.from(name).some(char => char <= ' ' || char === '\x7f' || '~^:?*[\\'.includes(char))
    && name.split('/').every(part => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'))
}

function unavailable(): HttpFailure {
  return httpFailure(404, 'worktree-config-unavailable')
}

function target(editor: WorktreeConfigEditor | undefined): { editor: WorktreeConfigEditor; entry: Entry; forge?: Entry } {
  if (typeof editor?.entries !== 'function' || typeof editor.edit !== 'function') throw unavailable()
  const entries = editor.entries()
  const matches = entries.filter(entry => entry.options.id === 'worktree' && entry.options.name === MODULE)
  if (matches.length !== 1 || matches[0].fiber?.state !== ACTIVE) throw unavailable()
  // ConfigEditor already ensures that an entry has a unique profile address.
  const forge = entries.filter(entry => entry.options.name === FORGE_MODULE && entry.fiber?.state === ACTIVE)
  return { editor, entry: matches[0], forge: forge.length === 1 ? forge[0] : undefined }
}

function forgePrefix(config: unknown): string | undefined {
  const value = (config as { worktreePrefix?: unknown } | undefined)?.worktreePrefix
  return typeof value === 'string' ? value : undefined
}

function conflict(): HttpFailure {
  return httpFailure(409, 'worktree-config-conflict')
}

function safeFailure(error: unknown): never {
  if (error instanceof HttpFailure) throw error
  // Loader errors can embed local paths, raw config and interpolation details.
  throw httpFailure(500, 'worktree-config-failed')
}

export function readWorktreeConfig(editor: WorktreeConfigEditor | undefined): WorktreeConfig {
  try {
    const { entry, forge } = target(editor)
    const value = fields(entry.fiber?.effectiveConfig)
    if (value === undefined) throw unavailable()
    const worktreePrefix = forgePrefix(forge?.fiber?.effectiveConfig)
    return { ...value, ...(worktreePrefix !== undefined ? { worktreePrefix } : {}) }
  } catch (error) {
    return safeFailure(error)
  }
}

function resolve(entry: Entry, current: RawConfig): unknown {
  const fiber = entry.fiber
  if (fiber?.state !== ACTIVE) throw unavailable()
  return fiber.resolveConfig(current)
}

async function editIfChanged(editor: WorktreeConfigEditor, entry: Entry,
  change: (current: RawConfig) => RawConfig | undefined): Promise<void> {
  const unchanged = new Error('native worktree config already current')
  try {
    await editor.edit(entry, current => {
      const next = change(current)
      if (next === undefined) throw unchanged
      return next
    })
  } catch (error) {
    if (error !== unchanged) throw error
  }
}

async function applyUpdate(editor: WorktreeConfigEditor, update: WorktreeConfigUpdate): Promise<WorktreeConfig> {
  const { directory, namePrefix, expected } = update
  const { entry, forge } = target(editor)
  const changePrefix = namePrefix !== expected.namePrefix || update.syncNamePrefix === true
  const sync = changePrefix && expected.worktreePrefix !== undefined
  if (update.syncNamePrefix === true && !sync) throw conflict()
  if (changePrefix && forgePrefix(forge?.fiber?.effectiveConfig) !== expected.worktreePrefix) throw conflict()
  // A directory edit stays a one-entry operation, including reset-to-default.
  if (sync && directory !== expected.directory) throw httpFailure(400, 'invalid-worktree-config')
  let restore: { hadKey: boolean; value: unknown } | undefined
  await editIfChanged(editor, entry, current => {
    // ConfigEditor reloads profile patches under its lock before providing the raw fields.
    const actual = fields(resolve(entry, current))
    if (!actual) throw unavailable()
    if (actual.directory !== expected.directory || actual.namePrefix !== expected.namePrefix) throw conflict()
    if (changePrefix && forgePrefix(target(editor).forge?.fiber?.effectiveConfig) !== expected.worktreePrefix) throw conflict()
    const resetDirectory = directory === ''
    const directoryChanged = resetDirectory ? Object.hasOwn(current, 'directory') : actual.directory !== directory
    if (!directoryChanged && actual.namePrefix === namePrefix) return
    const next = { ...current }
    if (resetDirectory) delete next.directory
    else if (directoryChanged) next.directory = directory
    if (actual.namePrefix !== namePrefix) {
      restore = { hadKey: Object.hasOwn(current, 'namePrefix'), value: current.namePrefix }
      next.namePrefix = namePrefix
    }
    const resolved = fields(resolve(entry, next))
    if (!resolved || !relativePath(resolved.directory)) throw unavailable()
    return next
  })
  if (!sync) return readWorktreeConfig(editor)
  const unconfirmed = () => httpFailure(409, 'worktree-prefix-unconfirmed')
  try {
    if (!forge) throw conflict()
    await editIfChanged(editor, forge, current => {
      const live = readWorktreeConfig(editor)
      if (live.namePrefix !== namePrefix || live.worktreePrefix !== expected.worktreePrefix) throw conflict()
      const actual = forgePrefix(resolve(forge, current))
      if (actual !== expected.worktreePrefix) throw conflict()
      if (actual !== namePrefix) return { ...current, worktreePrefix: namePrefix }
    })
  } catch (error) {
    if (restore) {
      const before = restore
      try {
        await editIfChanged(editor, entry, current => {
          // Undo only our prefix, not a later edit or any other raw config field.
          if (current.namePrefix !== namePrefix || readWorktreeConfig(editor).worktreePrefix === namePrefix) throw unconfirmed()
          const next = { ...current }
          if (before.hadKey) next.namePrefix = before.value
          else delete next.namePrefix
          return next
        })
      } catch {
        throw unconfirmed()
      }
    }
    // A concurrent edit may have changed either native value; the client must re-read.
    const live = readWorktreeConfig(editor)
    if (live.namePrefix !== expected.namePrefix || live.worktreePrefix !== expected.worktreePrefix) throw unconfirmed()
    throw error
  }
  const live = readWorktreeConfig(editor)
  if (live.namePrefix !== namePrefix || live.worktreePrefix !== namePrefix) throw unconfirmed()
  return live
}

export async function updateWorktreeConfig(service: WorktreeConfigEditor | undefined, update: WorktreeConfigUpdate): Promise<WorktreeConfig> {
  try {
    const { editor } = target(service)
    // Native ConfigEditor serializes each row, not the two rows of a prefix save.
    const run = (pendingWrites.get(editor) ?? Promise.resolve()).then(() => applyUpdate(editor, update))
    const settled = run.then(() => {}, () => {})
    pendingWrites.set(editor, settled)
    try {
      return await run
    } finally {
      if (pendingWrites.get(editor) === settled) pendingWrites.delete(editor)
    }
  } catch (error) {
    return safeFailure(error)
  }
}
