export interface ManagedWorktree {
  path: string
  branch: string
  repositoryRoot: string
  sessionId: string
  sessionTitle?: string
}

export interface WorktreeSessionRecord { header: { id: string }; live?: boolean }
interface WorktreeCreation { owned?: unknown; worktree?: Partial<ManagedWorktree> }
interface SessionProjection { worktree?: unknown; title?: unknown }
export type WorktreeRevision =
  | { source: 'live'; identity: symbol; revision: number }
  | { source: 'persisted'; identity: symbol; revision: string }

interface WorktreeSources {
  listSessions(signal: AbortSignal): Promise<WorktreeSessionRecord[]>
  revision(record: WorktreeSessionRecord): WorktreeRevision | undefined
  readProjection(record: WorktreeSessionRecord, revision: WorktreeRevision | undefined, signal: AbortSignal): Promise<{
    values: SessionProjection
    cacheable: boolean
  } | null>
  canRead?(id: string): boolean
}

// A cold inspection can restore a full session log; overlap I/O without opening
// the entire corpus in parallel. DSH uses the same default for batch title reads.
const INSPECTION_CONCURRENCY = 4

function collectOwned(values: SessionProjection, sessionId: string): ManagedWorktree[] {
  if (!Array.isArray(values.worktree)) throw new Error('missing worktree projection')
  const creations: readonly (WorktreeCreation | null | undefined)[] = values.worktree
  const sessionTitle = typeof values.title === 'string' && values.title.trim() ? values.title : undefined
  const owned: ManagedWorktree[] = []
  for (let index = creations.length - 1; index >= 0; index--) {
    const creation = creations[index]
    const worktree = creation?.worktree
    if (creation?.owned !== true || !worktree || typeof worktree.path !== 'string' || !worktree.path
      || typeof worktree.branch !== 'string' || !worktree.branch
      || typeof worktree.repositoryRoot !== 'string' || !worktree.repositoryRoot) continue
    const { path, branch, repositoryRoot } = worktree
    owned.push({ path, branch, repositoryRoot, sessionId, ...(sessionTitle === undefined ? {} : { sessionTitle }) })
  }
  return owned
}

/** Keep compact, detached projections, not Session objects or full event logs. */
export function createManagedWorktreeIndex() {
  type CacheEntry = { revision: WorktreeRevision; worktrees: readonly ManagedWorktree[] }
  let cache = new Map<string, CacheEntry>()
  let scan = 0
  let committedScan = 0

  return async function listManagedWorktrees(sources: WorktreeSources, signal: AbortSignal): Promise<ManagedWorktree[]> {
    signal.throwIfAborted()
    const scanId = ++scan
    const records = await sources.listSessions(signal)
    signal.throwIfAborted()
    const previous = cache
    const refreshed = new Map<string, CacheEntry>()
    const failed = new AbortController()
    const inspectionSignal = AbortSignal.any([signal, failed.signal])
    const projections: Array<readonly ManagedWorktree[] | undefined> = []
    let next = 0
    const inspect = async (): Promise<void> => {
      while (next < records.length) {
        inspectionSignal.throwIfAborted()
        const index = next++
        const record = records[index]!
        const { id } = record.header
        if (sources.canRead && !sources.canRead(id)) continue
        const revision = sources.revision(record)
        const cached = previous.get(id)
        if (cached && revision?.source === cached.revision.source
          && revision.identity === cached.revision.identity && revision.revision === cached.revision.revision) {
          projections[index] = cached.worktrees
          refreshed.set(id, cached)
          continue
        }
        const projection = await sources.readProjection(record, revision, inspectionSignal)
        inspectionSignal.throwIfAborted()
        if (projection === null || (sources.canRead && !sources.canRead(id))) continue
        const worktrees = collectOwned(projection.values, id)
        projections[index] = worktrees
        if (revision && projection.cacheable) refreshed.set(id, { revision, worktrees })
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(INSPECTION_CONCURRENCY, records.length) }, inspect))
    } catch (error) {
      failed.abort(error)
      throw error
    }
    signal.throwIfAborted()
    // Merge in corpus order, not completion order. The newest owned record
    // wins when the same checkout path is reused, including within a Session.
    const byPath = new Map<string, ManagedWorktree>()
    for (let index = 0; index < records.length; index++) {
      const worktrees = projections[index]
      if (!worktrees) continue
      const { id } = records[index]!.header
      if (sources.canRead && !sources.canRead(id)) {
        refreshed.delete(id)
        continue
      }
      for (const worktree of worktrees) {
        if (!byPath.has(worktree.path)) byPath.set(worktree.path, { ...worktree })
      }
    }
    if (scanId > committedScan) {
      // The new corpus drops disappeared/denied entries. Don't let a slower,
      // older request replace the cache that a newer request already committed.
      cache = refreshed
      committedScan = scanId
    }
    return [...byPath.values()]
  }
}
