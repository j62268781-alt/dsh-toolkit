import { HttpFailure, httpFailure } from '../../../../host/routes.js'

export interface WorktreeConfig {
  directory: string
  namePrefix: string
}

export interface WorktreeConfigUpdate extends WorktreeConfig {
  expected: WorktreeConfig
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
// Installed Cordis FiberState.ACTIVE is a const enum, not a runtime export.
const ACTIVE = 2

function fields(value: unknown): WorktreeConfig | undefined {
  if (value === null || typeof value !== 'object') return
  const { directory, namePrefix } = value as Partial<WorktreeConfig>
  if (typeof directory === 'string' && typeof namePrefix === 'string') return { directory, namePrefix }
}

function relativePath(path: string): boolean {
  return path.length > 0 && !/[\\:\0]/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

export function isWorktreeConfigUpdate(value: unknown): value is WorktreeConfigUpdate {
  const next = fields(value)
  if (next === undefined || !fields((value as WorktreeConfigUpdate).expected)) return false
  // Mirror native WorktreeService's constructor checks, additionally rejecting an unusable NUL path.
  return (next.directory === '' || relativePath(next.directory))
    && !next.namePrefix.startsWith('-') && relativePath(`${next.namePrefix}name`)
}

function unavailable(): HttpFailure {
  return httpFailure(404, 'worktree-config-unavailable')
}

function target(editor: WorktreeConfigEditor | undefined): { editor: WorktreeConfigEditor; entry: Entry } {
  if (typeof editor?.entries !== 'function' || typeof editor.edit !== 'function') throw unavailable()
  const matches = editor.entries().filter(entry => entry.options.id === 'worktree' && entry.options.name === MODULE)
  if (matches.length !== 1) throw unavailable()
  if (matches[0].fiber?.state !== ACTIVE) throw unavailable()
  return { editor, entry: matches[0] }
}

function safeFailure(error: unknown): never {
  if (error instanceof HttpFailure) throw error
  // Loader errors can embed local paths, raw config and interpolation details.
  throw httpFailure(500, 'worktree-config-failed')
}

export function readWorktreeConfig(editor: WorktreeConfigEditor | undefined): WorktreeConfig {
  try {
    const value = fields(target(editor).entry.fiber?.effectiveConfig)
    if (value === undefined) throw unavailable()
    return value
  } catch (error) {
    return safeFailure(error)
  }
}

export async function updateWorktreeConfig(service: WorktreeConfigEditor | undefined, update: WorktreeConfigUpdate): Promise<WorktreeConfig> {
  const { directory, namePrefix, expected } = update
  const noChange = new Error('native worktree config already current')
  try {
    const { editor, entry } = target(service)
    try {
      await editor.edit(entry, (current) => {
        // ConfigEditor reloads profile patches under its lock before providing the raw fields.
        const fiber = entry.fiber
        if (fiber?.state !== ACTIVE) throw unavailable()
        const actual = fields(fiber.resolveConfig(current))
        if (actual === undefined) throw unavailable()
        if (actual.directory !== expected.directory || actual.namePrefix !== expected.namePrefix) {
          throw httpFailure(409, 'worktree-config-conflict')
        }
        const resetDirectory = directory === ''
        const directoryChanged = resetDirectory ? Object.hasOwn(current, 'directory') : actual.directory !== directory
        if (!directoryChanged && actual.namePrefix === namePrefix) throw noChange
        const next = { ...current }
        if (resetDirectory) delete next.directory
        else if (directoryChanged) next.directory = directory
        if (actual.namePrefix !== namePrefix) next.namePrefix = namePrefix
        const resolved = fields(fiber.resolveConfig(next))
        if (!resolved || !relativePath(resolved.directory)) throw unavailable()
        return next
      })
    } catch (error) {
      if (error !== noChange) throw error
    }
    return readWorktreeConfig(editor)
  } catch (error) {
    return safeFailure(error)
  }
}
