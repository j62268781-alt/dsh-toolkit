import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { dshHome } from '../runtime/env.js'

export interface CachedTool {
  name: string
  rawName?: string
  description: string
  parameters: any
}

export interface CatalogSnapshot {
  tools: CachedTool[]
  capturedAt: number
  ttlMs: number | null
  cacheScope: 'public' | 'private' | null
}

interface DiskEntry extends CatalogSnapshot {
  fingerprint: string
  authorizationIdentity: 'anonymous'
}

export function cacheFile() {
  return join(dshHome(), 'dsh-toolkit-skills-mcp.tool-cache.json')
}

export function catalogFresh(entry: CatalogSnapshot, manual: boolean, now: number) {
  return now >= entry.capturedAt && (manual || (entry.ttlMs !== null && now - entry.capturedAt < entry.ttlMs))
}

function diskEntry(value: any): value is DiskEntry {
  return value?.authorizationIdentity === 'anonymous' && typeof value.fingerprint === 'string'
    && Number.isSafeInteger(value.capturedAt) && value.capturedAt > 0
    && (value.ttlMs === null || (Number.isSafeInteger(value.ttlMs) && value.ttlMs >= 0))
    && (value.cacheScope === 'public' || value.cacheScope === 'private' || value.cacheScope === null)
    && Array.isArray(value.tools) && value.tools.every((tool: any) => typeof tool?.name === 'string'
      && typeof tool.rawName === 'string' && typeof tool.description === 'string'
      && tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters))
}

export function createToolCache({ file = cacheFile(), warn = (_message: string) => {} } = {}) {
  const entries = new Map<string, DiskEntry>()
  let loaded: Promise<void> | undefined
  let writing = Promise.resolve()

  const persist = () => {
    writing = writing.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true })
        const temp = `${file}.${randomUUID()}.tmp`
        await writeFile(temp, `${JSON.stringify({ version: 2, entries: Object.fromEntries(entries) })}\n`, { mode: 0o600 })
        await rename(temp, file)
      } catch {
        warn('tool cache write failed')
      }
    })
    return writing
  }

  return {
    load() {
      return loaded ??= (async () => {
        try {
          const parsed = JSON.parse(await readFile(file, 'utf8'))
          // Legacy snapshots have no scope, freshness or credential provenance.
          if (parsed?.version !== 2 || !parsed.entries || typeof parsed.entries !== 'object') return
          for (const [key, value] of Object.entries(parsed.entries)) if (diskEntry(value)) entries.set(key, value)
        } catch (error: any) {
          if (error?.code !== 'ENOENT') warn('tool cache unreadable')
        }
      })()
    },
    get(key: string, fingerprint: string, identity: 'anonymous' | null, manual: boolean, now: number): CatalogSnapshot | null {
      const entry = entries.get(key)
      return identity === 'anonymous' && entry?.fingerprint === fingerprint
        && catalogFresh(entry, manual, now) ? entry : null
    },
    put(key: string, fingerprint: string, identity: 'anonymous' | null, entry: CatalogSnapshot, manual: boolean) {
      if (identity !== 'anonymous' || !catalogFresh(entry, manual, entry.capturedAt)) return this.drop(key)
      const value: DiskEntry = { ...entry, fingerprint, authorizationIdentity: identity }
      if (!diskEntry(value)) return this.drop(key)
      entries.set(key, value)
      return persist()
    },
    drop(key: string) {
      return entries.delete(key) ? persist() : writing
    },
    flush: () => writing,
  }
}
