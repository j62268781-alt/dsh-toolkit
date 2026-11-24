import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { GIT_PUBLISH_ACTION_PATH, GIT_PUBLISH_PREVIEW_PATH, GIT_PUBLISH_REASON } from '../../src/modules/git/host/constants.js'
import { apply } from '../../src/modules/git/host/index.js'
import { createPublishService } from '../../src/modules/git/host/publish.js'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
}

function fixture(t, { initial = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-git-publish-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cwd = join(root, 'working tree')
  mkdirSync(cwd)
  git(cwd, 'init', '-b', 'main')
  git(cwd, 'config', 'user.name', 'Publish test')
  git(cwd, 'config', 'user.email', 'publish@example.invalid')
  git(cwd, 'config', 'commit.gpgsign', 'false')
  git(cwd, 'config', 'core.hooksPath', join(root, 'no-hooks'))
  if (initial) {
    writeFileSync(join(cwd, 'original.txt'), 'original\n')
    git(cwd, 'add', '--', 'original.txt')
    git(cwd, 'commit', '-m', 'initial')
  }
  function remote(name) {
    const bare = join(root, name + '.git')
    mkdirSync(bare)
    git(bare, 'init', '--bare', '-b', 'main')
    return bare
  }
  return { cwd, remote }
}

async function reviewed(service, cwd, action) {
  const result = await service.preview({ cwd, action })
  assert.equal(result.ok, true, JSON.stringify(result))
  return result
}

function reason(result, expected) {
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal(result.reason, expected)
  assert.equal(result.code, GIT_PUBLISH_REASON[expected])
}

test('commit preview is the exact staged tree even for an unborn branch and partially staged file', async (t) => {
  const { cwd } = fixture(t, { initial: false })
  const service = createPublishService()
  const stagedName = '含 空格.txt'
  writeFileSync(join(cwd, stagedName), 'reviewed\n')
  git(cwd, 'add', '--', stagedName)
  writeFileSync(join(cwd, stagedName), 'unstaged edit\n')
  writeFileSync(join(cwd, 'untracked.txt'), 'not staged\n')
  const preview = await reviewed(service, cwd, 'commit')
  assert.equal(preview.branch, 'main')
  assert.equal(preview.head, null)
  assert.equal(preview.destination, null)
  assert.deepEqual(preview.stagedPaths, [stagedName])
  const confirmation = { cwd, action: 'commit', token: preview.token, message: 'reviewed change' }
  assert.deepEqual(await service.confirm(confirmation), { ok: true, action: 'commit' })
  assert.equal(git(cwd, 'ls-tree', '--name-only', '-z', '-r', 'HEAD'), `${stagedName}\0`)
  assert.equal(git(cwd, 'show', `HEAD:${stagedName}`), 'reviewed')
  reason(await service.confirm(confirmation), 'stale-preview')
})

test('commit confirmation refuses an edited index with unchanged paths, branch switches, and operations in progress', async (t) => {
  const { cwd } = fixture(t)
  const service = createPublishService()
  const head = git(cwd, 'rev-parse', 'HEAD')
  writeFileSync(join(cwd, 'original.txt'), 'first edit\n')
  git(cwd, 'add', '--', 'original.txt')
  const initial = await reviewed(service, cwd, 'commit')
  assert.deepEqual(initial.stagedPaths, ['original.txt'])
  const confirm = (token) => service.confirm({ cwd, action: 'commit', token, message: 'reviewed' })
  writeFileSync(join(cwd, 'original.txt'), 'different staged content\n')
  git(cwd, 'add', '--', 'original.txt')
  reason(await confirm(initial.token), 'stale-preview')

  const beforeSwitch = await reviewed(service, cwd, 'commit')
  git(cwd, 'switch', '-c', 'other')
  reason(await confirm(beforeSwitch.token), 'stale-preview')

  const beforeOperation = await reviewed(service, cwd, 'commit')
  writeFileSync(join(cwd, '.git', 'MERGE_HEAD'), `${head}\n`)
  reason(await service.preview({ cwd, action: 'commit' }), 'commit-in-progress')
  reason(await confirm(beforeOperation.token), 'stale-preview')
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), head)
})

test('push preview binds a single destination and exact commit; push does not add tags, force, or set upstream', async (t) => {
  const { cwd, remote } = fixture(t)
  const first = remote('first')
  const second = remote('second')
  git(cwd, 'remote', 'add', 'origin', first)
  const service = createPublishService()
  const base = git(cwd, 'rev-parse', 'HEAD')
  const initial = await reviewed(service, cwd, 'push')
  assert.equal(initial.head, base)
  assert.equal(initial.ahead, null)
  assert.equal(initial.behind, null)
  assert.deepEqual(initial.destination, { remote: 'origin', ref: 'refs/heads/main', url: first })
  const confirm = (token) => service.confirm({ cwd, action: 'push', token })
  git(cwd, 'remote', 'set-url', '--push', 'origin', second)
  reason(await confirm(initial.token), 'stale-preview')
  assert.equal(git(first, 'for-each-ref'), '')
  assert.equal(git(second, 'for-each-ref'), '')

  git(cwd, 'config', '--add', 'remote.origin.pushurl', first)
  reason(await service.preview({ cwd, action: 'push' }), 'no-push-destination')
  git(cwd, 'config', '--unset-all', 'remote.origin.pushurl')
  const beforeCommit = await reviewed(service, cwd, 'push')
  git(cwd, 'commit', '--allow-empty', '-m', 'second')
  reason(await confirm(beforeCommit.token), 'stale-preview')
  const head = git(cwd, 'rev-parse', 'HEAD')
  git(cwd, 'tag', '-a', 'unreviewed-tag', '-m', 'must not be pushed')
  git(cwd, 'config', 'push.followTags', 'true')
  git(cwd, 'config', 'push.autoSetupRemote', 'true')
  const exact = await reviewed(service, cwd, 'push')
  const [accepted, replay] = await Promise.all([confirm(exact.token), confirm(exact.token)])
  assert.deepEqual(accepted, { ok: true, action: 'push' })
  reason(replay, 'stale-preview')
  assert.equal(git(first, 'rev-parse', 'refs/heads/main'), head)
  assert.equal(git(first, 'for-each-ref', 'refs/tags'), '')
  assert.equal(git(second, 'for-each-ref'), '')
  assert.throws(() => git(cwd, 'config', '--get', 'branch.main.remote'))

  git(cwd, 'fetch', 'origin')
  git(cwd, 'reset', '--hard', base)
  const behind = await reviewed(service, cwd, 'push')
  assert.equal(behind.behind, 1)
  assert.equal(behind.ahead, 0)
  reason(await confirm(behind.token), 'push-behind')
  // If local tracking info is missing, the remote still rejects a non-fast-forward update.
  git(cwd, 'update-ref', '-d', 'refs/remotes/origin/main')
  const unknown = await reviewed(service, cwd, 'push')
  assert.equal(unknown.behind, null)
  reason(await confirm(unknown.token), 'push-failed')
  assert.equal(git(first, 'rev-parse', 'refs/heads/main'), head)
})

test('preview redacts URL credentials without contacting the remote', async (t) => {
  const { cwd } = fixture(t)
  git(cwd, 'remote', 'add', 'origin', 'https://user:secret@example.invalid/project.git?token=secret#secret')
  const preview = await reviewed(createPublishService(), cwd, 'push')
  assert.deepEqual(preview.destination, { remote: 'origin', ref: 'refs/heads/main', url: 'https://example.invalid/project.git' })
})

test('host registers both routes and rejects missing identity before reading any body', async () => {
  const routes = new Map()
  const ctx = { on() {}, inject(names, run) { if (names.includes('webServer')) run(this) }, effect(run) { return run() },
    systemPrompt: { section: () => () => {} },
    webServer: { register(route) { routes.set(route.path, route.handler) } },
    connection: { requestRejection: () => 401 },
  }
  apply(ctx)
  for (const path of [GIT_PUBLISH_PREVIEW_PATH, GIT_PUBLISH_ACTION_PATH]) {
    const req = { method: 'POST', on() { assert.fail('body read before authentication') } }
    const res = { end() { this.ended = true } }
    routes.get(path)(req, res)
    assert.equal(res.statusCode, 401)
    assert.equal(res.ended, true)
  }
})
