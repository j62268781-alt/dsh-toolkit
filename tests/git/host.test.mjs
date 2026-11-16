/**
 * Git 偏好的纯规则与装配层。
 *
 * 这里不碰 DOM：校验规则（client 与 host 共用 constants.ts）、配置归一的容错、
 * 提示词文本的拼装，以及「三项全空就不注册提示词段」这条装配决策。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GIT_BRANCHES_PATH,
  GIT_CHECKOUT_PATH,
  GIT_CREATE_BRANCH_PATH,
  MAX_BRANCH_PREFIX_LENGTH,
  MAX_COMMIT_INSTRUCTIONS_LENGTH,
  PROMPT_ORDER,
  PROMPT_SECTION,
  isBranchPrefix,
  normalizeBranchPrefix,
  normalizeCommitInstructions,
} from '../../src/modules/git/host/constants.js'
import { readSettings } from '../../src/modules/git/host/config.js'
import { gitPromptText } from '../../src/modules/git/host/prompt.js'
import { createGitRoutes } from '../../src/modules/git/host/routes/branches.js'
import * as host from '../../src/modules/git/host/index.js'

const DEFAULTS = { branchPrefix: '', alwaysForcePush: false, commitInstructions: '' }

test('分支前缀：手滑形态静默修正，真正非法的才拒绝', () => {
  assert.equal(normalizeBranchPrefix('  qoder/  '), 'qoder/')
  assert.equal(normalizeBranchPrefix('/qoder//x/'), 'qoder/x/')
  assert.equal(normalizeBranchPrefix(''), '')
  for (const value of ['', 'qoder/', 'feat/x-1', 'a.b_c/d', 'v1/']) {
    assert.equal(isBranchPrefix(value), true, `${value} 应当合法`)
  }
  for (const value of ['-x', '/x', 'a..b', 'a b', 'a~b', '.', 'a/.', '中文/']) {
    assert.equal(isBranchPrefix(value), false, `${value} 应当非法`)
  }
  assert.equal(isBranchPrefix('a'.repeat(MAX_BRANCH_PREFIX_LENGTH)), true)
  assert.equal(isBranchPrefix('a'.repeat(MAX_BRANCH_PREFIX_LENGTH + 1)), false)
})

test('提交说明：统一换行、剔除控制字符、裁掉首尾空白并截断', () => {
  assert.equal(normalizeCommitInstructions('  a\r\nb\r  '), 'a\nb')
  // 保留 \n 与 \t，但 \u0001 与 \u001b 不该进入系统提示词。
  assert.equal(normalizeCommitInstructions('a\u0001b\tc\u001bd'), 'ab\tcd')
  assert.equal(normalizeCommitInstructions('x'.repeat(MAX_COMMIT_INSTRUCTIONS_LENGTH + 10)).length, MAX_COMMIT_INSTRUCTIONS_LENGTH)
  assert.equal(normalizeCommitInstructions(''), '')
})

test('readSettings：读法容错，坏值退回默认而不是让插件起不来', () => {
  assert.deepEqual(readSettings({}), DEFAULTS)
  assert.deepEqual(readSettings(undefined), DEFAULTS)
  assert.deepEqual(
    readSettings({ branchPrefix: '/qoder//x/', alwaysForcePush: true, commitInstructions: ' 用中文 \r\n' }),
    { branchPrefix: 'qoder/x/', alwaysForcePush: true, commitInstructions: '用中文' },
  )
  // 宿主可能把字段做成活动引用（`{ get() }`）。
  assert.deepEqual(readSettings({ branchPrefix: { get: () => 'team/' }, alwaysForcePush: { get: () => true } }),
    { branchPrefix: 'team/', alwaysForcePush: true, commitInstructions: '' })
  // 手改 cordis.patch.yml 写出来的非法值：前缀清空，非布尔值按 false。
  assert.deepEqual(readSettings({ branchPrefix: '-nope', alwaysForcePush: 'yes', commitInstructions: 42 }), DEFAULTS)
  assert.deepEqual(readSettings({ branchPrefix: { get() { throw new Error('gone') } } }), DEFAULTS)
})

test('提示词：只写用户真的开了的规则', () => {
  assert.equal(gitPromptText(DEFAULTS), '', '三项全空时一个字都不说')

  const prefixOnly = gitPromptText({ ...DEFAULTS, branchPrefix: 'qoder/' })
  assert.match(prefixOnly, /^## Git conventions/)
  assert.match(prefixOnly, /name starts with `qoder\/`/)
  assert.doesNotMatch(prefixOnly, /--force-with-lease/)

  const forceOnly = gitPromptText({ ...DEFAULTS, alwaysForcePush: true })
  assert.match(forceOnly, /--force-with-lease/)
  assert.match(forceOnly, /never with a bare `--force`/)

  const instructions = gitPromptText({ ...DEFAULTS, commitInstructions: 'Use Conventional Commits\nand Chinese.' })
  assert.match(instructions, /\n {2}Use Conventional Commits\n {2}and Chinese\.$/)
  assert.doesNotMatch(instructions, /--force-with-lease/)
})

/** 记录注册的系统提示词段，效果可以手动释放。 */
function fakeCtx() {
  const sections = []
  const released = []
  const effects = []
  const injected = []
  return {
    sections,
    released,
    effects,
    injected,
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => released.push(section.name)
      },
    },
    /** 路由那条回调用不到 Web 服务时不会触发，这里只记录它请求了什么。 */
    inject(names, run) {
      injected.push({ names, run })
    },
    effect(run, label) {
      effects.push(label)
      return run()
    },
  }
}

test('apply：注册一段提示词，自由文本必须关掉插值', () => {
  const ctx = fakeCtx()
  host.apply(ctx, { branchPrefix: 'qoder/', commitInstructions: '引用 {{user}} 的名字' })
  assert.equal(ctx.sections.length, 1)
  const [section] = ctx.sections
  assert.equal(section.name, PROMPT_SECTION)
  assert.equal(section.order, PROMPT_ORDER)
  // 用户的文本里出现 `{{…}}` 也不能让宿主当成插值表达式（未知引用会直接抛错）。
  assert.equal(section.interpolate, false)
  assert.match(section.text, /\{\{user\}\}/)
  // 注销交给 effect，插件重启时旧段必须跟着走。
  assert.deepEqual(ctx.effects, [`dsh-toolkit-git:${PROMPT_SECTION}`])
  assert.deepEqual(ctx.released, [])
})

test('apply：什么都没配就一个段都不注册，但路由仍然挂上', () => {
  const ctx = fakeCtx()
  host.apply(ctx, {})
  assert.equal(ctx.sections.length, 0)
  assert.equal(ctx.effects.length, 0)
  // 提示词的早退不能把分支按钮的路由一起跳过。
  assert.equal(ctx.injected.length, 1)
  assert.deepEqual(ctx.injected[0].names, ['webServer', 'connection'])

  const legacy = fakeCtx()
  host.apply(legacy, undefined)
  assert.equal(legacy.sections.length, 0)
})

test('apply：配了提示词时，路由与段落同时在', () => {
  const ctx = fakeCtx()
  host.apply(ctx, { alwaysForcePush: true })
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.injected.length, 1)
})

test('路由：领域失败按「改输入 / 换状态 / 环境坏了」折成 400 / 409 / 503', async () => {
  const results = new Map([
    ['invalid-cwd', { ok: false, reason: 'invalid-cwd' }],
    ['not-a-repository', { ok: false, reason: 'not-a-repository' }],
    ['git-missing', { ok: false, reason: 'git-missing' }],
    ['ok', { ok: true, root: '/repo', branch: 'main', detached: false, dirty: false, branches: ['main'] }],
  ])
  let current = 'ok'
  const repository = {
    snapshot: async () => results.get(current),
    checkout: async () => results.get(current),
    createBranch: async () => results.get(current),
  }
  const specs = createGitRoutes({ repository })
  assert.deepEqual(specs.map((spec) => spec.path), [GIT_BRANCHES_PATH, GIT_CHECKOUT_PATH, GIT_CREATE_BRANCH_PATH])

  const status = async (name, value) => {
    current = name
    const [code] = await specs[0].run({}, value)
    return code
  }
  assert.equal(await status('ok', '/repo'), 200)
  assert.equal(await status('invalid-cwd', '/repo'), 400)
  assert.equal(await status('not-a-repository', '/repo'), 409)
  assert.equal(await status('git-missing', '/repo'), 503)
})

test('路由：body 形状在跑 git 之前就被拦下', () => {
  const specs = createGitRoutes({ repository: { snapshot: async () => ({ ok: true }) } })
  assert.equal(specs[0].pick({ cwd: '/repo' }), '/repo')
  assert.equal(specs[0].check('/repo'), true)
  assert.equal(specs[0].check(undefined), false)
  assert.deepEqual(specs[1].pick({ cwd: '/repo', name: 'dev' }), ['/repo', 'dev'])
  assert.equal(specs[1].check(['/repo', 'dev']), true)
  assert.equal(specs[1].check(['/repo']), false)
  assert.equal(specs[1].check('nope'), false)
})

test('装配面：name / inject / Config / apply 四样俱全', () => {
  assert.equal(host.name, 'dsh-toolkit-git')
  assert.deepEqual(host.inject, ['systemPrompt'])
  assert.ok(host.Config, '要能在宿主配置表单里出现')
  assert.equal(typeof host.apply, 'function')
})
