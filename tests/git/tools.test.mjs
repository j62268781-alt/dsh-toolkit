/**
 * 两个 git 工具：把设置翻译成 git 参数。
 *
 * 只断言「跑出去的 argv」——工具的职责就是这个；git 怎么执行、结果怎么解析由
 * `tests/git/repository.test.mjs` 覆盖，不必在这里重建仓库。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createGitTools, directoryOf, prefixedName, uniqueName } from '../../src/modules/git/host/tools.js'

const CWD = '/repo'
const EXEC = { agent: { session: { header: { cwd: CWD } } } }
const DEFAULTS = { branchPrefix: '', alwaysForcePush: false, commitInstructions: '' }

/** 能回答 snapshot 那几条查询的假 git；push / 建分支的结果用 `overrides` 覆盖。 */
function fakeGit(overrides = {}) {
  const calls = []
  const run = async (cwd, args) => {
    const key = args.join(' ')
    calls.push({ cwd, args: [...args] })
    if (key in overrides) return overrides[key]
    if (overrides[args[0]] !== undefined) return overrides[args[0]]
    if (key === 'rev-parse --show-toplevel') return { code: 0, stdout: `${CWD}\n`, stderr: '' }
    if (key === 'rev-parse --abbrev-ref HEAD') return { code: 0, stdout: 'main\n', stderr: '' }
    if (key === 'status --porcelain --untracked-files=no') return { code: 0, stdout: '', stderr: '' }
    if (args[0] === 'for-each-ref') return { code: 0, stdout: 'main\n', stderr: '' }
    if (key === 'remote') return { code: 0, stdout: 'origin\n', stderr: '' }
    if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') {
      return { code: 128, stdout: '', stderr: 'fatal: no upstream configured' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

function build(overrides = {}, settings = {}) {
  const git = fakeGit(overrides)
  const [push, branch, commit, sync, removeBranch, renameBranch] = createGitTools({
    settings: () => ({ ...DEFAULTS, ...settings }),
    run: git.run,
    now: () => new Date('2026-01-17T09:30:00'),
  })
  const argvOf = (command) => git.calls.find((call) => call.args.join(' ') === command)?.args ?? []
  return { push, branch, commit, sync, removeBranch, renameBranch, calls: git.calls, argvOf }
}

test('git_push：开关打开时自动加 --force-with-lease，关闭时一个参数都不多', async () => {
  const on = build({}, { alwaysForcePush: true })
  await on.push.execute({}, EXEC)
  assert.deepEqual(on.argvOf('push --force-with-lease -u origin HEAD'), ['push', '--force-with-lease', '-u', 'origin', 'HEAD'])

  const off = build({}, { alwaysForcePush: false })
  await off.push.execute({}, EXEC)
  assert.deepEqual(off.argvOf('push -u origin HEAD'), ['push', '-u', 'origin', 'HEAD'])
})

test('git_push：上游已存在就不加 -u；显式给了 setUpstream 时听它的', async () => {
  const tracked = {
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/main\n', stderr: '' },
  }
  const auto = build(tracked)
  await auto.push.execute({}, EXEC)
  assert.deepEqual(auto.argvOf('push origin HEAD'), ['push', 'origin', 'HEAD'])

  const forced = build(tracked)
  await forced.push.execute({ setUpstream: true }, EXEC)
  assert.deepEqual(forced.argvOf('push -u origin HEAD'), ['push', '-u', 'origin', 'HEAD'])

  const skipped = build()
  await skipped.push.execute({ setUpstream: false }, EXEC)
  assert.deepEqual(skipped.argvOf('push origin HEAD'), ['push', 'origin', 'HEAD'])
})

test('git_push：显式分支名、游离 HEAD、非法名字', async () => {
  const named = build()
  await named.push.execute({ branch: 'feature/x' }, EXEC)
  assert.deepEqual(named.argvOf('push -u origin feature/x'), ['push', '-u', 'origin', 'feature/x'])

  const detached = build({ 'rev-parse --abbrev-ref HEAD': { code: 0, stdout: 'HEAD\n', stderr: '' } })
  await assert.rejects(() => detached.push.execute({}, EXEC), /游离 HEAD/)

  const illegal = build()
  await assert.rejects(() => illegal.push.execute({ branch: 'bad name' }, EXEC), /分支名无效/)
})

test('git_branch_create：形状不对与 git 拒绝说的是两句话', async () => {
  const shape = build()
  await assert.rejects(() => shape.branch.execute({ name: 'bad name' }, EXEC), /新分支名称无效/)

  // `HEAD` 能过本地正则、过不了 git——这类名字必须由 git 裁决，且把它的原话带回来。
  const refused = build({
    'check-ref-format --branch HEAD': {
      code: 1,
      stdout: '',
      stderr: "'HEAD' is not a valid branch name\n",
    },
  })
  await assert.rejects(
    () => refused.branch.execute({ name: 'HEAD' }, EXEC),
    (error) => {
      assert.match(error.message, /新分支名称不符合 Git 规则/)
      assert.match(error.message, /is not a valid branch name/)
      return true
    },
  )
})

test('git_push：失败时带上真实命令与「远端有你没有的提交」的下一步', async () => {
  const failing = build({
    'push -u origin HEAD': {
      code: 1,
      stdout: '',
      stderr: ' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs',
    },
  })
  await assert.rejects(
    () => failing.push.execute({}, EXEC),
    (error) => {
      assert.match(error.message, /git push -u origin HEAD/)
      assert.match(error.message, /\[rejected\]/)
      assert.match(error.message, /git fetch/)
      return true
    },
  )
})

test('git_push：没有 origin 时先说是远端的问题，不是直接开推', async () => {
  const none = build({ remote: { code: 0, stdout: '', stderr: '' } })
  await assert.rejects(() => none.push.execute({}, EXEC), /还没有配置任何远端/)
  assert.equal(none.calls.some((call) => call.args[0] === 'push'), false, '没有远端就不该跑 push')

  const other = build({ remote: { code: 0, stdout: 'upstream\n', stderr: '' } })
  await assert.rejects(() => other.push.execute({}, EXEC), /没有名为 origin 的远端（现有：upstream）/)
})

test('git_push：落后上游时不开强推就直接拦下，并把两条路写清楚', async () => {
  const behind = build({
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'rev-list --left-right --count @{upstream}...HEAD': { code: 0, stdout: '3\t1\n', stderr: '' },
  })
  await assert.rejects(
    () => behind.push.execute({}, EXEC),
    (error) => {
      assert.match(error.message, /上游比本地多 3 个提交/)
      assert.match(error.message, /git pull --rebase/)
      assert.match(error.message, /始终强制推送/)
      return true
    },
  )
  assert.equal(behind.calls.some((call) => call.args[0] === 'push'), false)

  const forced = build({
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'rev-list --left-right --count @{upstream}...HEAD': { code: 0, stdout: '3\t1\n', stderr: '' },
  }, { alwaysForcePush: true })
  const output = await forced.push.execute({}, EXEC)
  assert.deepEqual(forced.argvOf('push --force-with-lease origin HEAD'), ['push', '--force-with-lease', 'origin', 'HEAD'])
  assert.match(output, /覆盖了远端历史/)
})

test('git_push：成功后把「设了上游」「领先几个提交」讲出来', async () => {
  const auto = build()
  const created = await auto.push.execute({}, EXEC)
  assert.match(created, /已用 -u 把 origin\/main 设为上游/)

  const tracked = build({
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'rev-list --left-right --count @{upstream}...HEAD': { code: 0, stdout: '0\t2\n', stderr: '' },
  })
  const ahead = await tracked.push.execute({}, EXEC)
  assert.match(ahead, /领先上游 2 个提交/)
  assert.doesNotMatch(ahead, /-u/, '已有上游时不该再提 -u')
})

test('git_branch_create：前缀自动拼上，用户自己写全了就不重复', async () => {
  const { branch, argvOf } = build({}, { branchPrefix: 'dsh/' })
  const first = await branch.execute({ name: 'fix-login' }, EXEC)
  assert.match(first, /已创建并切换到 dsh\/fix-login/)
  assert.deepEqual(argvOf('check-ref-format --branch dsh/fix-login'), ['check-ref-format', '--branch', 'dsh/fix-login'])

  const prefixed = build({}, { branchPrefix: 'dsh/' })
  await prefixed.branch.execute({ name: 'dsh/already' }, EXEC)
  assert.deepEqual(prefixed.argvOf('check-ref-format --branch dsh/already'), ['check-ref-format', '--branch', 'dsh/already'])
})

test('git_branch_create：重名退到 -2，省略名字时用日期', async () => {
  const taken = { 'for-each-ref': { code: 0, stdout: 'main\ndsh/fix-2\n', stderr: '' } }
  const dup = build(taken, { branchPrefix: 'dsh/' })
  const created = await dup.branch.execute({ name: 'fix-2' }, EXEC)
  assert.match(created, /dsh\/fix-2-2/)

  const auto = build({}, { branchPrefix: '' })
  const generated = await auto.branch.execute({}, EXEC)
  assert.match(generated, /dsh-20260117-0930/)
})

test('git_branch_create：不是仓库时报可读原因', async () => {
  const outside = build({
    'rev-parse --show-toplevel': { code: 128, stdout: '', stderr: 'fatal: not a git repository' },
  })
  await assert.rejects(() => outside.branch.execute({ name: 'x' }, EXEC), /不是 Git 仓库/)
})

test('缺 cwd 时不猜目录：直接报错，而不是退回 DSH 自己的安装目录', () => {
  assert.throws(() => directoryOf({}), /无法确定工作目录/)
  assert.equal(directoryOf({ agent: { session: { header: { cwd: CWD } } } }), CWD)
  assert.equal(directoryOf({ agent: { cwd: '/fallback' } }), '/fallback')
})

test('纯函数：前缀与去重', () => {
  assert.equal(prefixedName('', 'x'), 'x')
  assert.equal(prefixedName('dsh/', 'x'), 'dsh/x')
  assert.equal(prefixedName('dsh/', 'dsh/x'), 'dsh/x')
  assert.equal(uniqueName('a', ['a', 'a-2']), 'a-3')
  assert.equal(uniqueName('a', []), 'a')
})

test('git_commit：paths 只暂存指定路径，回显带上新提交的短哈希', async () => {
  const git = build({
    'add -- src/a.ts': { code: 0 },
    'diff --cached --quiet': { code: 1 },
    'commit -m fix: 修 A': { code: 0, stdout: '[main 1234abc] fix: 修 A\n' },
    'rev-parse --short HEAD': { code: 0, stdout: '1234abc\n' },
  })
  const output = await git.commit.execute({ message: 'fix: 修 A', paths: ['src/a.ts'] }, EXEC)
  assert.match(output, /^\$ git commit -m "fix: 修 A"/)
  assert.match(output, /新提交 1234abc。/)
  assert.deepEqual(git.argvOf('commit -m fix: 修 A'), ['commit', '-m', 'fix: 修 A'])
})

test('git_commit：空说明与空暂存区都不跑 git commit', async () => {
  const empty = build()
  await assert.rejects(() => empty.commit.execute({ message: '   ' }, EXEC), /提交说明不能为空/)
  assert.equal(empty.calls.some((call) => call.args[0] === 'commit'), false)

  const nothing = build()
  await assert.rejects(
    () => nothing.commit.execute({ message: 'fix: a' }, EXEC),
    (error) => {
      assert.match(error.message, /还没有暂存任何改动/)
      assert.match(error.message, /all: true/)
      return true
    },
  )
  assert.equal(nothing.calls.some((call) => call.args[0] === 'commit'), false)
})

test('git_sync：fetch 只取不合并，落后几个提交会说出来', async () => {
  const git = build({
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'rev-list --left-right --count @{upstream}...HEAD': { code: 0, stdout: '3\t0\n', stderr: '' },
  })
  const output = await git.sync.execute({ action: 'fetch' }, EXEC)
  assert.match(output, /^\$ git fetch --prune origin/)
  assert.match(output, /上游比本地多 3 个提交/)
  assert.match(output, /action: "pull"/)
})

test('git_sync：pull 说清楚合并了几个提交；冲突时提示继续变基', async () => {
  const merged = build({
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'for-each-ref --format=%(upstream:short) refs/heads/main': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'rev-list --left-right --count @{upstream}...HEAD': { code: 0, stdout: '2\t0\n', stderr: '' },
  })
  const output = await merged.sync.execute({ action: 'pull' }, EXEC)
  assert.match(output, /合并了 2 个上游提交/)
  assert.ok(merged.argvOf('pull --rebase').length > 0)

  const conflicted = build({
    'for-each-ref --format=%(upstream:short) refs/heads/main': { code: 0, stdout: 'origin/main\n', stderr: '' },
    'pull --rebase': { code: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in src/a.ts\n' },
  })
  await assert.rejects(
    () => conflicted.sync.execute({ action: 'pull' }, EXEC),
    (error) => {
      assert.match(error.message, /CONFLICT/)
      assert.match(error.message, /git rebase --continue/)
      return true
    },
  )

  const bogus = build()
  await assert.rejects(() => bogus.sync.execute({ action: 'merge' }, EXEC), /只能是 `fetch` 或 `pull`/)
})

test('git_branch_delete：删完提醒远端还在；未合并时提示再传 force', async () => {
  const git = build({
    'for-each-ref --count=200 --sort=-committerdate --format=%(refname:short) refs/heads': { code: 0, stdout: 'feat/a\nmain\n', stderr: '' },
    'for-each-ref --format=%(upstream:short) refs/heads/feat/a': { code: 0, stdout: 'origin/feat/a\n', stderr: '' },
    'branch -d feat/a': { code: 0, stdout: 'Deleted branch feat/a\n', stderr: '' },
  })
  const output = await git.removeBranch.execute({ name: 'feat/a' }, EXEC)
  assert.match(output, /^\$ git branch -d feat\/a/)
  assert.match(output, /远端 origin\/feat\/a 仍然存在/)

  const unmerged = build({
    'for-each-ref --count=200 --sort=-committerdate --format=%(refname:short) refs/heads': { code: 0, stdout: 'feat/a\nmain\n', stderr: '' },
    'branch -d feat/a': { code: 1, stdout: '', stderr: "error: the branch 'feat/a' is not fully merged\n" },
  })
  await assert.rejects(
    () => unmerged.removeBranch.execute({ name: 'feat/a' }, EXEC),
    (error) => {
      assert.match(error.message, /not fully merged/)
      assert.match(error.message, /force: true/)
      return true
    },
  )

  const empty = build()
  await assert.rejects(() => empty.removeBranch.execute({ name: ' ' }, EXEC), /不能为空/)
})

test('git_branch_rename：没有上游时提醒下次推送会补 -u', async () => {
  const git = build({
    'branch -m main feat/rename-me': { code: 0, stdout: '', stderr: '' },
    'for-each-ref --format=%(upstream:short) refs/heads/feat/rename-me': { code: 0, stdout: '', stderr: '' },
  })
  const output = await git.renameBranch.execute({ to: 'feat/rename-me' }, EXEC)
  assert.match(output, /^\$ git branch -m main feat\/rename-me/)
  assert.match(output, /还没有上游/)

  const tracked = build({
    'branch -m main feat/rename-me': { code: 0, stdout: '', stderr: '' },
    'for-each-ref --format=%(upstream:short) refs/heads/feat/rename-me': { code: 0, stdout: 'origin/main\n', stderr: '' },
  })
  assert.match(await tracked.renameBranch.execute({ to: 'feat/rename-me' }, EXEC), /跟踪 origin\/main/)

  await assert.rejects(() => build().renameBranch.execute({ to: '' }, EXEC), /不能为空/)
})
