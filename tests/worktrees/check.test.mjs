import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkManagedCheckout } from '../../src/modules/worktrees/host/worktree/check.js'
import { captureWorktreeSnapshot, listWorktreeSnapshots, resolveWorktreeSnapshot, restoreWorktreeSnapshot } from '../../src/modules/worktrees/host/worktree/snapshot.js'

const gitPath = process.env.PATH && (() => {
  try {
    const name = process.platform === 'win32' ? 'where.exe' : 'which'
    const git = execFileSync(name, ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0]
    execFileSync(git, ['--no-lazy-fetch', '--version'])
    return git
  } catch { return undefined }
})()

async function fixture(t, format = 'sha1') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-check-git-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (cwd, ...args) => execFileSync(gitPath, ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trimEnd()
  git(root, 'init', '-q', `--object-format=${format}`)
  await writeFile(join(root, 'tracked'), 'one\n')
  await writeFile(join(root, '.gitignore'), '*.local\n')
  await symlink('tracked', join(root, 'link'))
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial')
  const baseCommit = git(root, 'rev-parse', 'HEAD')
  const path = join(root, '.worktrees', 'topic')
  git(root, 'worktree', 'add', '-qb', 'topic', path)
  return { root, path, git, record: { repositoryRoot: root, path, branch: 'topic', baseCommit } }
}

function nativeAdapter({ enforcement = 'full', allowWrites = false, lossy = false, beforeSpawn } = {}) {
  const commands = []
  const writePolicies = []
  const services = {
    sandbox: {
      async confine(argv, policy, signal) {
        if (argv.includes('update-ref')) {
          assert.ok(allowWrites)
          assert.equal(policy.mode, 'workspace-write')
          writePolicies.push(policy)
        } else {
          assert.equal(policy.mode, 'read-only')
        }
        assert.ok(policy.workspaceRoot)
        signal.throwIfAborted()
        return { enforcement, argv }
      },
    },
    subprocess: {
      async resolveExecutable() { return gitPath },
      spawn({ argv, cwd, env, signal, stdio }) {
        const writing = argv.includes('update-ref')
        if (writing && stdio.stdin !== 'pipe') assert.equal(typeof stdio.stdin.data, 'string')
        if (!writing) assert.equal(stdio.stdin, 'ignore')
        assert.equal(env.GIT_ALLOW_PROTOCOL, '')
        assert.ok(argv.includes('--no-lazy-fetch'))
        assert.ok(argv.includes('core.fsmonitor=false'))
        commands.push(argv)
        beforeSpawn?.(argv, stdio.stdin)
        let stdout, stderr
        const child = {}
        const done = new Promise(resolve => {
          const handle = execFile(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, signal, maxBuffer: stdio.stdout.maxBytes }, (error, out, err) => {
            stdout = out; stderr = err
            resolve({ exitCode: error ? error.code : 0, signal: error?.signal ?? null })
          })
          if (stdio.stdin === 'pipe') {
            child.stdin = handle.stdin
            child.stdout = handle.stdout
          } else if (writing) handle.stdin.end(stdio.stdin.data)
          child.terminate = () => handle.kill()
        })
        return { done, ...child, waitForExit: async () => { await done; return true }, collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy }) },
          stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
        } }
      },
    },
  }
  return { ctx: { get: name => services[name] }, commands, writePolicies }
}

const gitTest = { skip: !gitPath || process.platform === 'win32' }

test('verifies a real linked checkout and detects dirty, ignored, locked and hidden states', gitTest, async t => {
  const { root, path, git, record } = await fixture(t)
  const adapter = nativeAdapter()
  const signal = AbortSignal.timeout(10_000)
  const check = (override = {}) => checkManagedCheckout(adapter.ctx, { ...record, ...override }, signal)
  assert.equal(await check(), 'clean')
  assert.equal(await check({ branch: 'wrong-branch' }), 'checkout-mismatch')
  assert.equal(await check({ path: join(root, 'missing') }), 'checkout-missing')
  git(root, 'worktree', 'lock', path)
  assert.equal(await check(), 'locked')
  git(root, 'worktree', 'unlock', path)
  const tracked = join(path, 'tracked')
  await chmod(tracked, 0o755)
  assert.equal(await check(), 'dirty')
  await chmod(tracked, 0o644)
  await writeFile(tracked, 'two\n')
  assert.equal(await check(), 'dirty')
  git(path, 'add', 'tracked')
  await writeFile(tracked, 'one\n')
  assert.equal(await check(), 'dirty')
  git(path, 'reset', '-q', 'HEAD', '--', 'tracked')
  const extra = join(path, 'extra')
  await mkdir(extra)
  await writeFile(join(extra, 'ignored.local'), 'keep')
  assert.equal(await check(), 'dirty')
  await rm(extra, { recursive: true })
  git(path, 'update-index', '--assume-unchanged', 'tracked')
  assert.equal(await check(), 'check-unavailable')
  git(path, 'update-index', '--no-assume-unchanged', 'tracked')
  git(path, 'update-index', '--skip-worktree', 'tracked')
  assert.equal(await check(), 'check-unavailable')
  git(path, 'update-index', '--no-skip-worktree', 'tracked')
  assert.equal(await check(), 'clean')
})

test('does not return clean after Git HEAD moves or when native confinement is partial', gitTest, async t => {
  const { path, git, record } = await fixture(t)
  const signal = AbortSignal.timeout(5_000)
  const unsafe = nativeAdapter({ enforcement: 'partial' })
  assert.equal(await checkManagedCheckout(unsafe.ctx, record, signal), 'check-unavailable')
  assert.equal(unsafe.commands.length, 0)
  assert.equal(await checkManagedCheckout(nativeAdapter({ lossy: true }).ctx, record, signal), 'check-unavailable')
  let lists = 0
  const changing = nativeAdapter({ beforeSpawn(argv) {
    if (argv.includes('worktree') && argv.includes('list') && ++lists === 2) {
      git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'advanced')
    }
  } })
  assert.equal(await checkManagedCheckout(changing.ctx, record, signal), 'check-unavailable')
  assert.equal(lists, 2)
})

const snapshotPrefix = 'refs/dsh-toolkit/worktrees/snapshots/v1/'
const snapshotRefs = (git, root) => git(root, 'for-each-ref', '--format=%(refname)', snapshotPrefix)
const advance = (git, path) => {
  git(path, 'add', 'tracked')
  git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'advance')
  return git(path, 'rev-parse', 'HEAD')
}

for (const format of ['sha1', 'sha256']) {
  test(`pins the exact ${format} commit and resolves it after the branch advances`, gitTest, async t => {
    const { root, path, git, record } = await fixture(t, format)
    const owner = { ...record, sessionId: 'native-owner' }
    const policy = { mode: 'workspace-write', workspaceRoot: root, sessionId: owner.sessionId }
    const signal = AbortSignal.timeout(10_000)
    await writeFile(join(path, 'tracked'), 'saved version\n')
    const head = advance(git, path)
    assert.notEqual(head, owner.baseCommit)
    const hookMarker = join(root, 'reference-hook-ran')
    const hooks = join(root, '.git', 'hooks')
    await mkdir(hooks, { recursive: true })
    const hook = join(hooks, 'reference-transaction')
    await writeFile(hook, '#!/bin/sh\nprintf ran > reference-hook-ran\nexit 1\n', { mode: 0o755 })
    git(root, 'config', 'core.hooksPath', hooks)

    const { ctx, writePolicies } = nativeAdapter({ allowWrites: true })
    assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: true, commit: head })
    assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: true, commit: head })
    assert.deepEqual(writePolicies, [policy])
    const ref = snapshotRefs(git, root)
    assert.ok(ref.startsWith(snapshotPrefix) && ref.endsWith(`/${head}`) && !ref.includes('\n'))
    assert.equal(git(path, 'rev-parse', 'HEAD'), head)
    assert.equal(await readFile(join(path, 'tracked'), 'utf8'), 'saved version\n')
    await assert.rejects(readFile(hookMarker), { code: 'ENOENT' })
    await assert.rejects(readFile(join(path, 'reference-hook-ran')), { code: 'ENOENT' })

    await writeFile(join(path, 'tracked'), 'new tip\n')
    const newer = advance(git, path)
    assert.equal(await resolveWorktreeSnapshot(ctx, owner, head, signal), head)
    assert.equal(git(root, 'show', `${head}:tracked`), 'saved version')
    assert.equal(await resolveWorktreeSnapshot(ctx, owner, newer, signal), undefined)
    assert.equal(await resolveWorktreeSnapshot(ctx, { ...owner, sessionId: 'other' }, head, signal), undefined)
    assert.equal(await resolveWorktreeSnapshot(ctx, owner, owner.baseCommit, signal), undefined)

    git(root, 'update-ref', `refs/heads/${owner.branch}`, owner.baseCommit, newer)
    assert.ok(!git(root, 'rev-list', '--branches').split('\n').includes(head))
    assert.ok(git(root, 'rev-list', '--all').split('\n').includes(head))
    assert.equal(await resolveWorktreeSnapshot(ctx, owner, head, signal), head)
  })
}

test('refuses dirty, read-only, narrowed and partially confined snapshots', gitTest, async t => {
  const { root, path, git, record } = await fixture(t)
  const owner = { ...record, sessionId: 'native-owner' }
  const policy = { mode: 'workspace-write', workspaceRoot: root }
  const signal = AbortSignal.timeout(10_000)
  const partial = nativeAdapter({ enforcement: 'partial', allowWrites: true })
  const capable = nativeAdapter({ allowWrites: true })
  const denied = { ok: false, reason: 'snapshot-unavailable' }
  assert.deepEqual(await captureWorktreeSnapshot(capable.ctx, owner, { ...policy, mode: 'read-only' }, signal), denied)
  assert.deepEqual(await captureWorktreeSnapshot(capable.ctx, owner, { ...policy, workspaceRoot: path, additionalWritableRoots: [root] }, signal), denied)
  assert.deepEqual(await captureWorktreeSnapshot(partial.ctx, owner, policy, signal), { ok: false, reason: 'check-unavailable' })
  await writeFile(join(path, 'local.local'), 'ignored changes\n')
  assert.deepEqual(await captureWorktreeSnapshot(capable.ctx, owner, policy, signal), { ok: false, reason: 'dirty' })
  assert.equal(snapshotRefs(git, root), '')
  assert.equal(capable.writePolicies.length, 0)
  assert.equal(partial.commands.length, 0)
})

test('does not pin a stale commit when the source branch advances at the write boundary', gitTest, async t => {
  const { root, path, git, record } = await fixture(t)
  const owner = { ...record, sessionId: 'native-owner' }
  const policy = { mode: 'workspace-write', workspaceRoot: root }
  const signal = AbortSignal.timeout(10_000)
  let moved = false
  const { ctx } = nativeAdapter({ allowWrites: true, beforeSpawn(argv) {
    if (argv.includes('update-ref')) {
      git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'concurrent advance')
      moved = true
    }
  } })
  assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: false, reason: 'snapshot-unavailable' })
  assert.equal(moved, true)
  assert.equal(snapshotRefs(git, root), '')
})

test('rejects a rewritten or symbolic pin and detects a missing object without fallback', gitTest, async t => {
  const { root, path, git, record } = await fixture(t)
  const owner = { ...record, sessionId: 'native-owner' }
  const policy = { mode: 'workspace-write', workspaceRoot: root }
  const signal = AbortSignal.timeout(10_000)
  const { ctx } = nativeAdapter({ allowWrites: true })
  await writeFile(join(path, 'tracked'), 'unique contents\n')
  const head = advance(git, path)
  assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: true, commit: head })
  const ref = snapshotRefs(git, root)
  git(root, 'update-ref', ref, record.baseCommit)
  assert.equal(await resolveWorktreeSnapshot(ctx, owner, head, signal), undefined)
  assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: false, reason: 'snapshot-unavailable' })
  assert.equal(git(root, 'rev-parse', ref), record.baseCommit)
  git(root, 'symbolic-ref', ref, 'refs/heads/topic')
  assert.equal(await resolveWorktreeSnapshot(ctx, owner, head, signal), undefined)
  git(root, 'symbolic-ref', ref, 'refs/heads/nonexistent')
  assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: false, reason: 'snapshot-unavailable' })
  assert.equal(git(root, 'symbolic-ref', ref), 'refs/heads/nonexistent')
  git(root, 'update-ref', '--no-deref', ref, head)
  const object = git(root, 'rev-parse', `${head}:tracked`)
  assert.match(object, /^[a-f0-9]{40}$/)
  const looseObject = join(root, '.git', 'objects', object.slice(0, 2), object.slice(2))
  assert.equal(await realpath(looseObject), looseObject)
  await unlink(looseObject)
  assert.equal(await resolveWorktreeSnapshot(ctx, owner, head, signal), undefined)
})

for (const format of ['sha1', 'sha256']) {
  test(`restores the verified ${format} pin to a new branch without a checkout`, gitTest, async t => {
    const { root, path, git, record } = await fixture(t, format)
    const owner = { ...record, sessionId: 'archive' }
    const policy = { mode: 'workspace-write', workspaceRoot: root, sessionId: owner.sessionId }
    const signal = AbortSignal.timeout(10_000)
    const { ctx, writePolicies } = nativeAdapter({ allowWrites: true })
    await writeFile(join(path, 'tracked'), 'captured\n')
    const commit = advance(git, path)
    assert.deepEqual(await captureWorktreeSnapshot(ctx, owner, policy, signal), { ok: true, commit })
    assert.deepEqual(await listWorktreeSnapshots(ctx, owner, signal), [commit])
    assert.deepEqual(await listWorktreeSnapshots(ctx, { ...owner, sessionId: 'other' }, signal), [])
    await writeFile(join(path, 'tracked'), 'later\n')
    const newer = advance(git, path)
    git(root, 'worktree', 'remove', '--', path)
    const checkedOut = git(root, 'symbolic-ref', 'HEAD')
    const branch = 'recovery/saved'
    const restore = () => restoreWorktreeSnapshot(ctx, owner, commit, branch, policy, async () => policy, signal)
    assert.deepEqual(await restore(), { ok: true, commit, branch })
    assert.deepEqual(await restore(), { ok: false, reason: 'branch-in-use' })
    assert.equal(git(root, 'rev-parse', `refs/heads/${branch}`), commit)
    assert.equal(git(root, 'rev-parse', 'refs/heads/topic'), newer)
    assert.equal(git(root, 'symbolic-ref', 'HEAD'), checkedOut)
    assert.equal(git(root, 'status', '--porcelain'), '')
    assert.equal(writePolicies.length, 2)
    assert.deepEqual(writePolicies[1], policy)
  })
}

test('restoration rejects unsafe scope and rechecks permission before committing the ref', gitTest, async t => {
  const { root, path, git, record } = await fixture(t)
  const owner = { ...record, sessionId: 'archive' }
  const policy = { mode: 'workspace-write', workspaceRoot: root, sessionId: owner.sessionId }
  const signal = AbortSignal.timeout(10_000)
  const { ctx, commands } = nativeAdapter({ allowWrites: true })
  const { commit } = await captureWorktreeSnapshot(ctx, owner, policy, signal)
  const restore = (branch, original, authorize) => restoreWorktreeSnapshot(ctx, owner, commit, branch, original, authorize, signal)
  const before = commands.length
  const never = async () => assert.fail('invalid requests must not reach the write boundary')
  assert.deepEqual(await restore('bad\ncommit', policy, never), { ok: false, reason: 'invalid-branch' })
  assert.deepEqual(await restore('no-scope', { ...policy, workspaceRoot: path, additionalWritableRoots: [root] }, never), { ok: false, reason: 'restore-not-writable' })
  assert.equal(commands.length, before)
  assert.deepEqual(await restore('no-longer-writable', policy, async () => ({ ...policy, mode: 'read-only' })), { ok: false, reason: 'restore-not-writable' })
  assert.equal(git(root, 'for-each-ref', 'refs/heads/no-longer-writable'), '')
  assert.deepEqual(await restore('topic', policy, never), { ok: false, reason: 'branch-in-use' })
  assert.deepEqual(await restore('TOPIC', policy, never), { ok: false, reason: 'branch-in-use' })
})

test('restoration never dereferences an occupied destination or symbolic replacement pin', gitTest, async t => {
  const { root, git, record } = await fixture(t)
  const owner = { ...record, sessionId: 'archive' }
  const policy = { mode: 'workspace-write', workspaceRoot: root, sessionId: owner.sessionId }
  const signal = AbortSignal.timeout(10_000)
  const { commit } = await captureWorktreeSnapshot(nativeAdapter({ allowWrites: true }).ctx, owner, policy, signal)
  const pin = snapshotRefs(git, root)
  const dangling = 'refs/heads/does-not-exist'
  let changed
  const { ctx } = nativeAdapter({ allowWrites: true, beforeSpawn(argv, stdio) {
    if (stdio === 'pipe' && argv.includes('update-ref')) {
      if (changed === 'destination') git(root, 'symbolic-ref', 'refs/heads/occupied', dangling)
      if (changed === 'pin') git(root, 'symbolic-ref', pin, 'refs/heads/topic')
    }
  } })
  const restore = branch => restoreWorktreeSnapshot(ctx, owner, commit, branch, policy, async () => policy, signal)
  changed = 'destination'
  assert.deepEqual(await restore('occupied'), { ok: false, reason: 'branch-in-use' })
  assert.equal(git(root, 'symbolic-ref', 'refs/heads/occupied'), dangling)
  assert.equal(git(root, 'for-each-ref', dangling), '')
  changed = 'pin'
  assert.deepEqual(await restore('bad-pin'), { ok: false, reason: 'snapshot-unavailable' })
  assert.equal(git(root, 'symbolic-ref', pin), 'refs/heads/topic')
  assert.equal(git(root, 'for-each-ref', 'refs/heads/bad-pin'), '')
})
