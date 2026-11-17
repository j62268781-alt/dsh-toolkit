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
    if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') {
      return { code: 128, stdout: '', stderr: 'fatal: no upstream configured' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

function build(overrides = {}, settings = {}) {
  const git = fakeGit(overrides)
  const [push, branch] = createGitTools({
    settings: () => ({ ...DEFAULTS, ...settings }),
    run: git.run,
    now: () => new Date('2026-01-17T09:30:00'),
  })
  const argvOf = (command) => git.calls.find((call) => call.args.join(' ') === command)?.args ?? []
  return { push, branch, calls: git.calls, argvOf }
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
  await assert.rejects(() => illegal.push.execute({ branch: 'bad name' }, EXEC), /分支名不合法/)
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
