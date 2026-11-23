/**
 * Git 仓库领域层：用可替换的 runner 覆盖每一条判断分支。
 *
 * 这里不打桩 `node:child_process` —— `createRepository(run)` 的 runner 就是为测试留的
 * 接缝：真假 git 的差别只在一张「命令 → 结果」表里，断言的是解析与状态映射，不是 git 本身。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRepository } from '../../src/modules/git/host/repository.ts'
import { MAX_BRANCH_LIST } from '../../src/modules/git/host/constants.ts'

// cwd 必须是「本平台的」绝对路径：`D:/repo` 只在 Windows 上绝对，POSIX 上 `path.isAbsolute()`
// 为 false，整组用例会被 invalid-cwd 提前拦下（实现是对的，是测试不跨平台）。
const REPO = process.platform === 'win32' ? 'D:/repo' : '/repo'
const PLAIN = process.platform === 'win32' ? 'D:/plain' : '/plain'

const REFS = `for-each-ref --count=${MAX_BRANCH_LIST} --sort=-committerdate --format=%(refname:short) refs/heads`
const REMOTE_REFS = `for-each-ref --count=${MAX_BRANCH_LIST} --sort=-committerdate --format=%(refname:short) refs/remotes`

/** 一张「命令 → 结果」表；表里没有的命令默认成功且无输出。 */
function runnerOf(table = {}) {
  const calls = []
  const run = async (cwd, args) => {
    const key = args.join(' ')
    calls.push(key)
    const entry = table[key]
    const value = typeof entry === 'function' ? entry(args) : entry
    return { code: 0, stdout: '', stderr: '', ...(value ?? {}) }
  }
  run.calls = calls
  return run
}

function repoTable(overrides = {}) {
  return {
    'rev-parse --show-toplevel': { stdout: `${REPO}\n` },
    'rev-parse --abbrev-ref HEAD': { stdout: 'main\n' },
    'status --porcelain --untracked-files=no': { stdout: '' },
    [REFS]: { stdout: 'feat/a\nmain\nfix/b\n' },
    ...overrides,
  }
}

test('snapshot：把仓库根、当前分支、脏标记与分支列表一次读全', async () => {
  const repository = createRepository(runnerOf(repoTable({
    'status --porcelain --untracked-files=no': { stdout: ' M src/a.ts\n' },
  })))
  const result = await repository.snapshot(REPO)
  assert.deepEqual(result, {
    ok: true,
    root: REPO,
    branch: 'main',
    detached: false,
    linkedWorktree: false,
    dirty: true,
    branches: ['main', 'feat/a', 'fix/b'],
    remotes: [],
  })
})

test('snapshot：使用 Git 管理目录识别 linked worktree', async () => {
  const key = 'rev-parse --path-format=absolute --git-dir --git-common-dir'
  const check = async (stdout) => createRepository(runnerOf(repoTable({ [key]: { stdout } }))).snapshot(REPO)
  assert.equal((await check(`${REPO}/.git/worktrees/topic\n${REPO}/.git\n`)).linkedWorktree, true)
  assert.equal((await check(`${REPO}/metadata\n${REPO}/metadata\n`)).linkedWorktree, false)
})

test('snapshot：detached HEAD 不假装自己是分支，且不打乱列表', async () => {
  const repository = createRepository(runnerOf(repoTable({
    'rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' },
  })))
  const result = await repository.snapshot(REPO)
  assert.equal(result.ok, true)
  assert.equal(result.detached, true)
  assert.equal(result.branch, '')
  assert.deepEqual(result.branches, ['feat/a', 'main', 'fix/b'])
})

test('snapshot：不是仓库与缺 git 分别映射到 not-a-repository / git-missing', async () => {
  const notRepo = await createRepository(runnerOf({
    'rev-parse --show-toplevel': { code: 128, stderr: 'fatal: not a git repository (or any parent)\nmore' },
  })).snapshot(PLAIN)
  assert.deepEqual(notRepo, { ok: false, reason: 'not-a-repository', detail: 'fatal: not a git repository (or any parent)' })

  const missing = await createRepository(runnerOf({
    'rev-parse --show-toplevel': { code: null, spawnError: new Error('ENOENT') },
  })).snapshot(REPO)
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'git-missing')
})

test('snapshot：相对路径直接拒绝，绝不真跑 git', async () => {
  const run = runnerOf(repoTable())
  const result = await createRepository(run).snapshot('./repo')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-cwd')
  assert.deepEqual(run.calls, [])
})

test('snapshot：非法 cwd（非字符串、空串）同样拦在 git 之前', async () => {
  const run = runnerOf(repoTable())
  const repository = createRepository(run)
  for (const cwd of [undefined, null, '', 42]) {
    const result = await repository.snapshot(cwd)
    assert.equal(result.reason, 'invalid-cwd')
  }
  assert.deepEqual(run.calls, [])
})

test('checkout：先 git switch，成功后重新读快照', async () => {
  const run = runnerOf(repoTable({
    'switch --quiet feat/a': { code: 0 },
    'rev-parse --abbrev-ref HEAD': { stdout: 'feat/a\n' },
  }))
  const result = await createRepository(run).checkout(REPO, 'feat/a')
  assert.equal(result.ok, true)
  assert.equal(result.branch, 'feat/a')
  assert.ok(run.calls.includes('switch --quiet feat/a'))
})

test('checkout：老版本 git 没有 switch 时才退回 checkout，别的失败原样上报', async () => {
  const fallback = runnerOf(repoTable({
    'switch --quiet feat/a': { code: 1, stderr: 'git: unknown subcommand: switch' },
    'checkout --quiet feat/a': { code: 0 },
  }))
  assert.equal((await createRepository(fallback).checkout(REPO, 'feat/a')).ok, true)
  assert.ok(fallback.calls.includes('checkout --quiet feat/a'))

  const genuine = runnerOf(repoTable({
    'switch --quiet feat/a': { code: 1, stderr: 'error: Your local changes would be overwritten' },
  }))
  const failed = await createRepository(genuine).checkout(REPO, 'feat/a')
  assert.deepEqual(failed, {
    ok: false,
    reason: 'checkout-failed',
    detail: 'error: Your local changes would be overwritten',
  })
  assert.equal(genuine.calls.includes('checkout --quiet feat/a'), false, '真失败不重试别的命令')
})

test('checkout：非法分支名在跑 git 之前就被挡下', async () => {
  const run = runnerOf(repoTable())
  const result = await createRepository(run).checkout(REPO, '-D')
  assert.equal(result.reason, 'invalid-branch')
  assert.deepEqual(run.calls, [])
})

test('createBranch：同名分支已存在时不调用 switch', async () => {
  const run = runnerOf(repoTable())
  const result = await createRepository(run).createBranch(REPO, 'feat/a')
  assert.deepEqual(result, { ok: false, reason: 'create-failed', detail: '同名分支已存在。' })
  assert.equal(run.calls.some((call) => call.startsWith('switch --create')), false)
})

test('createBranch：check-ref-format 判非法时用 git 自己的原话', async () => {
  const run = runnerOf(repoTable({
    'check-ref-format --branch feat/x': { code: 1, stderr: 'fatal: feat/x is not a valid branch name\n' },
  }))
  const result = await createRepository(run).createBranch(REPO, 'feat/x')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid-branch')
  assert.equal(result.detail, 'fatal: feat/x is not a valid branch name')
})

test('createBranch：校验通过后 switch --create，并回读快照', async () => {
  const run = runnerOf(repoTable({
    'switch --create feat/x': { code: 0 },
    'rev-parse --abbrev-ref HEAD': (() => {
      let first = true
      return () => {
        if (first) { first = false; return { stdout: 'main\n' } }
        return { stdout: 'feat/x\n' }
      }
    })(),
  }))
  const result = await createRepository(run).createBranch(REPO, 'feat/x')
  assert.equal(result.ok, true)
  assert.equal(result.branch, 'feat/x')
  assert.ok(run.calls.includes('check-ref-format --branch feat/x'))
  assert.ok(run.calls.includes('switch --create feat/x'))
})


test('snapshot：远端跟踪引用单独列出，origin/HEAD 不算一个分支', async () => {
  const repository = createRepository(runnerOf(repoTable({
    [REMOTE_REFS]: { stdout: 'origin/HEAD\norigin/main\norigin/feat/x\n' },
  })))
  const result = await repository.snapshot(REPO)
  assert.equal(result.ok, true)
  assert.deepEqual(result.remotes, ['origin/main', 'origin/feat/x'])
  assert.deepEqual(result.branches, ['main', 'feat/a', 'fix/b'])
})

test('checkout：点远端分支时用 --track 建出同名本地分支', async () => {
  const run = runnerOf(repoTable({
    [REMOTE_REFS]: { stdout: 'origin/main\norigin/feat/x\n' },
  }))
  const result = await createRepository(run).checkout(REPO, 'origin/feat/x')
  assert.equal(result.ok, true)
  assert.ok(run.calls.includes('switch --track --create feat/x origin/feat/x'))
})

test('checkout：本地已经有同名分支时直接切过去，不再建跟踪', async () => {
  const run = runnerOf(repoTable({
    [REMOTE_REFS]: { stdout: 'origin/feat/a\n' },
  }))
  const result = await createRepository(run).checkout(REPO, 'origin/feat/a')
  assert.equal(result.ok, true)
  assert.ok(run.calls.includes('switch --quiet feat/a'))
  assert.ok(!run.calls.some((call) => call.includes('--track')))
})

test('checkout：远端跟踪检出失败时把 git 的原话带回来', async () => {
  const run = runnerOf(repoTable({
    [REMOTE_REFS]: { stdout: 'origin/feat/x\n' },
    'switch --track --create feat/x origin/feat/x': { code: 128, stderr: 'fatal: a branch named feat/x already exists\n' },
  }))
  const result = await createRepository(run).checkout(REPO, 'origin/feat/x')
  assert.deepEqual(result, { ok: false, reason: 'checkout-failed', detail: 'fatal: a branch named feat/x already exists' })
})
// ---- 提交 / 同步 / 删分支 / 改分支名 ----

test('commit：传 paths 时只暂存这些路径，然后提交', async () => {
  const run = runnerOf(repoTable({
    'add -- src/a.ts': { code: 0 },
    'diff --cached --quiet': { code: 1 },
    'commit -m fix: a': { code: 0, stdout: '[main 1234abc] fix: a\n' },
  }))
  const result = await createRepository(run).commit(REPO, 'fix: a', { paths: ['src/a.ts'] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.command, ['commit', '-m', 'fix: a'])
  assert.deepEqual(run.calls.filter((call) => call !== REFS && call !== REMOTE_REFS), [
    'rev-parse --show-toplevel',
    'rev-parse --abbrev-ref HEAD',
    'status --porcelain --untracked-files=no',
    'add -- src/a.ts',
    'diff --cached --quiet',
    'commit -m fix: a',
  ])
})

test('commit：既没暂存内容也没传 all/paths 时直接拦下，并说明两条入口', async () => {
  const result = await createRepository(runnerOf(repoTable())).commit(REPO, 'fix: a')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'commit-failed')
  assert.match(result.detail, /还没有暂存任何改动/)
  assert.match(result.detail, /all: true/)
})

test('commit：all: true 先 add -A；暂存后仍然空则说「暂存之后没有改动」', async () => {
  const empty = runnerOf(repoTable({ 'add -A': { code: 0 } }))
  const blocked = await createRepository(empty).commit(REPO, 'fix: a', { all: true })
  assert.equal(blocked.ok, false)
  assert.match(blocked.detail, /暂存之后没有可提交的改动/)

  const run = runnerOf(repoTable({ 'add -A': { code: 0 }, 'diff --cached --quiet': { code: 1 } }))
  const result = await createRepository(run).commit(REPO, 'fix: a', { all: true })
  assert.equal(result.ok, true)
  assert.ok(run.calls.includes('add -A'))
})

test('commit：git 拒绝时说它的原话，空提交说明在跑 git 之前就挡下', async () => {
  const rejected = runnerOf(repoTable({
    'diff --cached --quiet': { code: 1 },
    'commit -m fix: a': { code: 1, stderr: 'no changes added to commit\n' },
  }))
  const failed = await createRepository(rejected).commit(REPO, 'fix: a')
  assert.equal(failed.ok, false)
  assert.equal(failed.detail, 'no changes added to commit')

  const run = runnerOf(repoTable())
  const empty = await createRepository(run).commit(REPO, '   ')
  assert.equal(empty.ok, false)
  assert.equal(empty.detail, '提交说明不能为空。')
  assert.deepEqual(run.calls, [], '空说明不该触发任何 git 调用')
})

test('sync fetch：只更新远端引用，没有 origin 时先说是远端的问题', async () => {
  const run = runnerOf(repoTable({ remote: { stdout: 'origin\n' } }))
  const result = await createRepository(run).sync(REPO, 'fetch')
  assert.equal(result.ok, true)
  assert.deepEqual(result.command, ['fetch', '--prune', 'origin'])

  const noRemote = await createRepository(runnerOf(repoTable({ remote: { stdout: '' } }))).sync(REPO, 'fetch')
  assert.equal(noRemote.ok, false)
  assert.equal(noRemote.reason, 'sync-failed')
  assert.match(noRemote.detail, /还没有配置任何远端/)
})

test('sync pull：游离 HEAD / 脏工作区 / 没有上游 各说各的下一步', async () => {
  const detached = runnerOf(repoTable({
    remote: { stdout: 'origin\n' },
    'rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' },
  }))
  const one = await createRepository(detached).sync(REPO, 'pull')
  assert.equal(one.ok, false)
  assert.match(one.detail, /游离 HEAD/)

  const dirty = runnerOf(repoTable({
    remote: { stdout: 'origin\n' },
    'status --porcelain --untracked-files=no': { stdout: ' M src/a.ts\n' },
  }))
  const two = await createRepository(dirty).sync(REPO, 'pull')
  assert.equal(two.ok, false)
  assert.match(two.detail, /未提交的改动/)

  const untracked = runnerOf(repoTable({
    remote: { stdout: 'origin\n' },
    'for-each-ref --format=%(upstream:short) refs/heads/main': { stdout: '\n' },
  }))
  const three = await createRepository(untracked).sync(REPO, 'pull')
  assert.equal(three.ok, false)
  assert.match(three.detail, /还没有上游/)
})

test('sync pull：默认 --rebase，显式关掉才用 merge', async () => {
  const table = () => repoTable({
    remote: { stdout: 'origin\n' },
    'for-each-ref --format=%(upstream:short) refs/heads/main': { stdout: 'origin/main\n' },
  })
  const rebaseRun = runnerOf(table())
  assert.deepEqual((await createRepository(rebaseRun).sync(REPO, 'pull')).command, ['pull', '--rebase'])
  assert.ok(rebaseRun.calls.includes('pull --rebase'))

  const mergeRun = runnerOf(table())
  assert.deepEqual((await createRepository(mergeRun).sync(REPO, 'pull', false)).command, ['pull', '--no-rebase'])
  assert.ok(mergeRun.calls.includes('pull --no-rebase'))
})

test('deleteBranch：不删当前分支，也不删不存在的；未合并的分支要显式 force', async () => {
  const current = await createRepository(runnerOf(repoTable())).deleteBranch(REPO, 'main')
  assert.equal(current.ok, false)
  assert.match(current.detail, /不能删除当前分支/)

  const missing = await createRepository(runnerOf(repoTable({
    [REMOTE_REFS]: { stdout: 'origin/feat/gone\n' },
  }))).deleteBranch(REPO, 'feat/gone')
  assert.equal(missing.ok, false)
  assert.match(missing.detail, /远端引用/)

  const run = runnerOf(repoTable({ 'branch -d feat/a': { code: 1, stderr: "error: the branch 'feat/a' is not fully merged\n" } }))
  const unmerged = await createRepository(run).deleteBranch(REPO, 'feat/a')
  assert.equal(unmerged.ok, false)
  assert.equal(unmerged.reason, 'delete-failed')
  assert.match(unmerged.detail, /not fully merged/)

  const forced = runnerOf(repoTable({ 'branch -D feat/a': { code: 0, stdout: 'Deleted branch feat/a\n' } }))
  const result = await createRepository(forced).deleteBranch(REPO, 'feat/a', true)
  assert.equal(result.ok, true)
  assert.deepEqual(result.command, ['branch', '-D', 'feat/a'])
})

test('renameBranch：from 省略时改当前分支，重名与非法名字在跑 git 之前挡下', async () => {
  const run = runnerOf(repoTable({ 'branch -m main feat/rename-me': { code: 0 } }))
  const result = await createRepository(run).renameBranch(REPO, '', 'feat/rename-me')
  assert.equal(result.ok, true)
  assert.deepEqual(result.command, ['branch', '-m', 'main', 'feat/rename-me'])

  const duplicate = await createRepository(runnerOf(repoTable())).renameBranch(REPO, 'main', 'feat/a')
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.reason, 'rename-failed')
  assert.match(duplicate.detail, /已经有名为 feat\/a 的分支/)

  const invalid = await createRepository(runnerOf(repoTable())).renameBranch(REPO, 'main', 'bad name')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'invalid-branch')
})
