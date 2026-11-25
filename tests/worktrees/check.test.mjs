import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkManagedCheckout } from '../../src/modules/worktrees/host/worktree/check.js'

const gitPath = process.env.PATH && (() => {
  try {
    const name = process.platform === 'win32' ? 'where.exe' : 'which'
    const git = execFileSync(name, ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0]
    execFileSync(git, ['--no-lazy-fetch', '--version'])
    return git
  } catch { return undefined }
})()

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-check-git-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (cwd, ...args) => execFileSync(gitPath, ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trimEnd()
  git(root, 'init', '-q', '--object-format=sha1')
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

function nativeAdapter({ enforcement = 'full', lossy = false, beforeSpawn } = {}) {
  const commands = []
  const services = {
    sandbox: {
      async confine(argv, policy, signal) {
        assert.equal(policy.mode, 'read-only')
        assert.ok(policy.workspaceRoot)
        signal.throwIfAborted()
        return { enforcement, argv }
      },
    },
    subprocess: {
      async resolveExecutable() { return gitPath },
      spawn({ argv, cwd, env, signal, stdio }) {
        assert.equal(stdio.stdin, 'ignore')
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
          child.terminate = () => handle.kill()
        })
        return { done, ...child, waitForExit: async () => { await done; return true }, collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy }) },
          stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
        } }
      },
    },
  }
  return { ctx: { get: name => services[name] }, commands }
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
