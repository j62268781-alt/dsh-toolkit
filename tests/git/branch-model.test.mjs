/**
 * 分支按钮的纯投影：载荷容错与搜索过滤。
 *
 * 这两件事决定了弹层「会不会把 200 行分支原样吐出来」和「宿主版本落后时会不会崩」，
 * 所以脱离 React 单测；组件层只验证调用顺序（见 branch-chip.test.mjs）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_VIEW, filterBranches, prefilledBranchName, showsAt, toBranchView } from '../../src/modules/git/client/model.ts'

test('toBranchView：正常载荷原样投影，当前分支永远在最前', () => {
  const view = toBranchView({
    ok: true,
    root: 'D:/repo',
    branch: 'main',
    detached: false,
    dirty: true,
    branches: ['main', 'feat/a', 'fix/b'],
  })
  assert.deepEqual(view, {
    root: 'D:/repo',
    branch: 'main',
    detached: false,
    dirty: true,
    branches: ['main', 'feat/a', 'fix/b'],
  })
})

test('toBranchView：缺字段与非字符串成员都退回安全默认值，不抛错', () => {
  assert.deepEqual(toBranchView(undefined), EMPTY_VIEW)
  assert.deepEqual(toBranchView({}), EMPTY_VIEW)
  assert.deepEqual(toBranchView({ branch: 42, detached: 'yes', dirty: 1, branches: ['ok', 7, null] }), {
    root: '',
    branch: '',
    detached: false,
    dirty: false,
    branches: ['ok'],
  })
})

test('filterBranches：空查询返回全部，多个关键词要同时命中', () => {
  const branches = ['main', 'feat/review-panel', 'feat/login-form', 'fix/login']
  assert.deepEqual(filterBranches(branches, ''), branches)
  assert.deepEqual(filterBranches(branches, '   '), branches)
  assert.deepEqual(filterBranches(branches, 'feat'), ['feat/review-panel', 'feat/login-form'])
  // 与 Qoder 一致：按空白分词，顺序无关，大小写不敏感。
  assert.deepEqual(filterBranches(branches, 'LOGIN feat'), ['feat/login-form'])
  assert.deepEqual(filterBranches(branches, 'feat/re'), ['feat/review-panel'])
  assert.deepEqual(filterBranches(branches, 'nope'), [])
})

test('filterBranches：不改动入参', () => {
  const branches = ['main', 'dev']
  const result = filterBranches(branches, '')
  result.push('pushed')
  assert.deepEqual(branches, ['main', 'dev'])
})

test('prefilledBranchName：前缀为空时不加任何字符', () => {
  assert.equal(prefilledBranchName('', 'feat/x'), 'feat/x')
  assert.equal(prefilledBranchName('qoder/', 'feat/x'), 'qoder/feat/x')
})

test('showsAt：新会话只留顶栏，已开始的会话只留 composer', () => {
  // 新会话页（blank）：顶栏已有宿主的 worktree 控件，底栏不能再露一个 git。
  assert.equal(showsAt('hero', true), true)
  assert.equal(showsAt('composer', true), false)
  // 发第一条消息后 hero 行消失，按钮落到 composer。
  assert.equal(showsAt('hero', false), false)
  assert.equal(showsAt('composer', false), true)
})
