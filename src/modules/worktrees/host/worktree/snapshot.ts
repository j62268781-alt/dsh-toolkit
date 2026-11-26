import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { commitId, verifyManagedCheckout, type WorktreeCheckReason, type WorktreeCheckRecord } from './check.js'
import { makeWorktreeGit } from './git.js'

interface SnapshotOwner extends WorktreeCheckRecord {
  sessionId: string
}

type CaptureResult = { ok: true; commit: string }
  | { ok: false; reason: Exclude<WorktreeCheckReason, 'clean'> | 'snapshot-unavailable' }

type RestoreResult = { ok: true; branch: string; commit: string }
  | { ok: false; reason: 'invalid-branch' | 'branch-in-use' | 'snapshot-unavailable' | 'restore-not-writable' | 'restore-unconfirmed' }

const invalidBranch = new Error('branch already reserved')
const invalidPin = new Error('snapshot no longer available')
const noWrite = new Error('snapshot write permission changed')

type Git = Awaited<ReturnType<typeof makeWorktreeGit>>

function snapshotNamespace(owner: SnapshotOwner): string {
  const { sessionId, repositoryRoot, path, branch, baseCommit } = owner
  if (!sessionId || !commitId.test(baseCommit)) throw new Error('invalid snapshot identity')
  const key = createHash('sha256').update(JSON.stringify([sessionId, repositoryRoot, path, branch, baseCommit])).digest('hex')
  return `refs/dsh-toolkit/worktrees/snapshots/v1/${key}/`
}

function snapshotRef(owner: SnapshotOwner, commit: string): string {
  if (!commitId.test(commit)) throw new Error('invalid snapshot commit')
  return `${snapshotNamespace(owner)}${commit}`
}

async function canWrite(policy: SandboxExecutionPolicy | undefined, common: string): Promise<boolean> {
  if (policy?.mode !== 'workspace-write' || !isAbsolute(policy.workspaceRoot)) return false
  const rel = relative(await realpath(policy.workspaceRoot), common)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function localGitDirectory(root: string): Promise<string> {
  if (!isAbsolute(root) || resolve(root) !== root || /[\0\r\n\ufffd]/.test(root)) throw new Error('invalid repository root')
  const common = join(root, '.git')
  // Don't expand the original write scope to support separate Git directories.
  for (const dir of [common, join(common, 'objects')]) {
    if (!(await lstat(dir)).isDirectory() || await realpath(dir) !== dir) throw new Error('non-local Git storage')
  }
  // A pin is not an independent copy. Don't verify a graph that relies on an
  // alternate object store or intentionally hides ancestry.
  for (const name of ['commondir', 'objects/info/alternates', 'shallow', 'info/grafts']) {
    const entry = await lstat(join(common, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (entry) throw new Error('unsupported object storage')
  }
  return common
}

function scopedGit(git: Git, root: string, common: string) {
  return (args: string[], options?: Parameters<Git>[2]) => git(root, [`--git-dir=${common}`, ...args], options)
}

type ScopedGit = ReturnType<typeof scopedGit>

async function directCommit(git: ScopedGit, ref: string): Promise<string | undefined> {
  // A dangling symbolic ref is invisible to for-each-ref; it isn't an empty slot.
  if ((await git(['symbolic-ref', '--quiet', '--no-recurse', ref], { allowedCodes: [0, 1] })).code !== 1) {
    throw new Error('symbolic ref is not a snapshot')
  }
  const { text } = await git(['for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)', ref])
  if (!text) return
  const fields = text.split('\0')
  if (fields.length !== 4 || fields[0] !== ref || !commitId.test(fields[1] ?? '') || fields[2] !== 'commit' || fields[3] !== '\n') {
    throw new Error('invalid direct commit ref')
  }
  return fields[1]
}

async function verifyObjects(git: ScopedGit, commit: string): Promise<void> {
  // A cached commit graph can describe a parent even when its object is gone.
  await git(['-c', 'core.commitGraph=false', 'rev-list', '--objects', '--missing=error', '--quiet', commit, '--'])
}

/** Host-only. The caller must freshly authorize the native archived owner; this never makes removal safe. */
export async function captureWorktreeSnapshot(ctx: any, owner: SnapshotOwner, policy: SandboxExecutionPolicy, signal: AbortSignal): Promise<CaptureResult> {
  try {
    const root = owner.repositoryRoot
    if (policy.mode !== 'workspace-write') return { ok: false, reason: 'snapshot-unavailable' }
    const common = await localGitDirectory(root)
    if (!await canWrite(policy, common)) return { ok: false, reason: 'snapshot-unavailable' }
    const checked = await verifyManagedCheckout(ctx, owner, signal)
    if (typeof checked === 'string') return { ok: false, reason: checked }
    const { head, commonDir, objectFormat } = checked
    if (common !== commonDir || head.length !== (objectFormat === 'sha1' ? 40 : 64)) {
      return { ok: false, reason: 'snapshot-unavailable' }
    }
    const ref = snapshotRef(owner, head)
    const branch = `refs/heads/${owner.branch}`
    const read = scopedGit(await makeWorktreeGit(ctx, { mode: 'read-only', workspaceRoot: root }, signal), root, common)
    await read(['check-ref-format', branch])
    if (await directCommit(read, branch) !== head) return { ok: false, reason: 'snapshot-unavailable' }
    const existing = await directCommit(read, ref)
    if (existing !== undefined && existing !== head) return { ok: false, reason: 'snapshot-unavailable' }
    await verifyObjects(read, head)
    if (existing === undefined) {
      const write = scopedGit(await makeWorktreeGit(ctx, { ...policy, mode: 'workspace-write' }, signal), root, common)
      // Verify the source tip in the same ref transaction that creates the pin.
      // No deletion, checkout, or re-pointing of a pre-existing direct ref.
      await write(['-c', 'core.fsync=reference', '-c', 'core.fsyncMethod=fsync', 'update-ref', '--stdin'], {
        stdin: { data: `start\noption no-deref\nverify ${branch} ${head}\noption no-deref\ncreate ${ref} ${head}\nprepare\ncommit\n` },
      })
    }
    if (await resolveWorktreeSnapshot(ctx, owner, head, signal) !== head) return { ok: false, reason: 'snapshot-unavailable' }
    return { ok: true, commit: head }
  } catch {
    // An interrupted ref write can have committed; never roll a pin back here.
    return { ok: false, reason: 'snapshot-unavailable' }
  }
}

/** Resolve only the recorded pin, even after the checkout or original branch is gone. */
export async function resolveWorktreeSnapshot(ctx: any, owner: SnapshotOwner, commit: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const ref = snapshotRef(owner, commit)
    const root = owner.repositoryRoot
    const common = await localGitDirectory(root)
    const git = scopedGit(await makeWorktreeGit(ctx, { mode: 'read-only', workspaceRoot: root }, signal), root, common)
    const { text: format } = await git(['rev-parse', '--show-object-format'])
    if (format !== (commit.length === 40 ? 'sha1\n' : 'sha256\n') || await directCommit(git, ref) !== commit) return
    await verifyObjects(git, commit)
    signal.throwIfAborted()
    return commit
  } catch {}
}

/** Enumerate pins only for a previously authorized archived owner, on demand. */
export async function listWorktreeSnapshots(ctx: any, owner: SnapshotOwner, signal: AbortSignal): Promise<string[]> {
  const prefix = snapshotNamespace(owner)
  const root = owner.repositoryRoot
  const common = await localGitDirectory(root)
  const git = scopedGit(await makeWorktreeGit(ctx, { mode: 'read-only', workspaceRoot: root }, signal), root, common)
  const { text } = await git(['for-each-ref', '--count=51', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)', prefix])
  const lines = text.split('\n').filter(Boolean)
  if (lines.length > 50) throw new Error('too many snapshot refs to enumerate')
  const commits: string[] = []
  for (const line of lines) {
    const [ref, commit, type, symbolic, ...extra] = line.split('\0')
    if (commitId.test(commit) && ref === `${prefix}${commit}` && type === 'commit' && symbolic === '' && !extra.length) commits.push(commit)
  }
  return commits
}

/** Restore a local branch at the exact pin. No checkout, branch move, or fallback. */
export async function restoreWorktreeSnapshot(
  ctx: any, owner: SnapshotOwner, commit: string, branch: string, policy: SandboxExecutionPolicy | undefined,
  authorize: () => Promise<SandboxExecutionPolicy | undefined>, signal: AbortSignal,
): Promise<RestoreResult> {
  if (!branch || branch.length > 200 || branch === 'HEAD' || branch.startsWith('-') || /[\x00-\x20\x7f\ufffd]/.test(branch)) {
    return { ok: false, reason: 'invalid-branch' }
  }
  const root = owner.repositoryRoot
  const destination = `refs/heads/${branch}`
  let mayHaveCommitted = false
  try {
    if (policy?.mode !== 'workspace-write' || !await canWrite(policy, root)) return { ok: false, reason: 'restore-not-writable' }
    const common = await localGitDirectory(root)
    const read = scopedGit(await makeWorktreeGit(ctx, { mode: 'read-only', workspaceRoot: root }, signal), root, common)
    if ((await read(['check-ref-format', destination], { allowedCodes: [0, 1] })).code !== 0) return { ok: false, reason: 'invalid-branch' }
    // Scope the Git writer to the already-authorized repository, not to the
    // original workspace's other directories or independently granted roots.
    const writePolicy = { mode: policy.mode, workspaceRoot: root, sessionId: policy.sessionId } as const
    if (await resolveWorktreeSnapshot(ctx, owner, commit, signal) !== commit) return { ok: false, reason: 'snapshot-unavailable' }
    const pin = snapshotRef(owner, commit)
    const checkDestination = async () => {
      const existence = await read(['show-ref', '--exists', destination], {
        allowedCodes: [0, 2], allowStderr: { code: 2, text: 'error: reference does not exist\n' },
      })
      if (existence.code !== 2 || existence.text !== '') throw invalidBranch
      // Case aliases can collide on some volumes. The worktree list also catches
      // existing unborn HEADs, which do not have a branch ref yet.
      const folded = destination.toLowerCase()
      const { text: refs } = await read(['for-each-ref', '--format=%(refname)', 'refs/heads/'])
      const { text: worktrees } = await read(['worktree', 'list', '--porcelain', '-z'])
      if (refs.split('\n').some(name => {
        const ref = name.toLowerCase()
        return ref === folded || ref.startsWith(`${folded}/`) || folded.startsWith(`${ref}/`)
      }) || worktrees.split('\0').some(field => field.toLowerCase() === `branch ${folded}`)) throw invalidBranch
    }
    await checkDestination()
    const write = scopedGit(await makeWorktreeGit(ctx, writePolicy, signal), root, common)
    await write(['-c', 'core.fsync=reference', '-c', 'core.fsyncMethod=fsync', 'update-ref', '--stdin'], {
      prepared: {
        commands: `option no-deref\nverify ${pin} ${commit}\noption no-deref\ncreate ${destination} ${commit}\n`,
        async verify() {
          // Git <= 2.45 can treat a dangling symref as absent during create.
          // Only commit after checking both refs with the transaction locks held.
          if (await directCommit(read, pin) !== commit) throw invalidPin
          await checkDestination()
          const fresh = await authorize()
          if (!fresh || !await canWrite(fresh, root) || fresh.workspaceRoot !== policy.workspaceRoot
            || fresh.sessionId !== policy.sessionId || await localGitDirectory(root) !== common) throw noWrite
          mayHaveCommitted = true
        },
      },
    })
    if (await directCommit(read, destination) !== commit) return { ok: false, reason: 'restore-unconfirmed' }
    return { ok: true, branch, commit }
  } catch (error) {
    if (error === invalidBranch) return { ok: false, reason: 'branch-in-use' }
    if (error === invalidPin) return { ok: false, reason: 'snapshot-unavailable' }
    if (error === noWrite) return { ok: false, reason: 'restore-not-writable' }
    // Never roll back a branch that might already be committed. Entry conflicts
    // raced at prepare and other unclassified failures are reported conservatively.
    return { ok: false, reason: mayHaveCommitted || signal.aborted ? 'restore-unconfirmed' : 'snapshot-unavailable' }
  }
}
