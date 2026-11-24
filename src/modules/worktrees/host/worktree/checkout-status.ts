import { lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export type CheckoutStatus = 'present' | 'missing' | 'unknown'

async function directoryStatus(path: string): Promise<CheckoutStatus> {
  if (!isAbsolute(path)) return 'unknown'
  try {
    return (await lstat(path)).isDirectory() ? 'present' : 'unknown'
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'unknown'
  }
}

/** Report the recorded directory's current presence, not Git registration or cleanup eligibility. */
export async function readCheckoutStatuses(worktrees: readonly { path: string }[], signal: AbortSignal): Promise<Map<string, CheckoutStatus>> {
  signal.throwIfAborted()
  const statuses = new Map<string, CheckoutStatus>()
  let next = 0
  const probe = async () => {
    while (next < worktrees.length) {
      signal.throwIfAborted()
      const { path } = worktrees[next++]!
      statuses.set(path, await directoryStatus(path))
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, worktrees.length) }, probe))
  signal.throwIfAborted()
  return statuses
}
