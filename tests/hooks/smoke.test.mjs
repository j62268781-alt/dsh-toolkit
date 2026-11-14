/**
 * 冒烟：像宿主那样加载包，确认导出面与 apply 在「没有 webServer / 没有会话」时也不炸。
 * 只验证装配层，不重复单测里的事件语义。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const pkg = await import('../../packages/hooks/index.js')

/** 极简 ctx 替身：记录 inject 声明与监听器，effect 立即执行。 */
function fakeCtx() {
  const injected = []
  const listeners = []
  return {
    injected,
    listeners,
    logger: { warn() {}, info() {} },
    inject(names) { injected.push(names) },
    on(name) { listeners.push(name) },
    effect(fn) { fn() },
  }
}

test('包导出面：cordis 需要 name / inject / Config / apply 四样俱全', () => {
  assert.equal(pkg.name, 'dsh-toolkit-hooks')
  assert.ok(pkg.default, '默认导出必须存在（cordis 用它当插件）')
  assert.equal(typeof pkg.default.apply, 'function')
  assert.ok(Array.isArray(pkg.default.inject))
  assert.ok(pkg.default.Config, '要能在宿主配置表单里出现')
})

test('apply：没有 webServer 也能装上五个触发点，路由等它出现再注册', () => {
  const ctx = fakeCtx()
  pkg.default.apply(ctx, {})
  assert.deepEqual(ctx.injected.at(-1), ['webServer', 'connection'], '路由要等 webServer 就绪才注册')
  assert.ok(ctx.injected.some((names) => names.includes('workingDirectory')), '项目级 hooks 必须能拿到会话目录')
  assert.deepEqual(
    [...ctx.listeners].sort(),
    ['agent/created', 'agent/pre-step', 'agent/turn-stopping', 'tools/post-execute', 'tools/pre-execute'],
    '五个触发点全部接上',
  )
})

test('apply：开关关掉、改成自定义路径都不影响装配本身', () => {
  const disabled = fakeCtx()
  pkg.default.apply(disabled, { enabled: false })
  assert.equal(disabled.listeners.length, 5, '关掉开关也照样挂监听器，只是里面不执行')

  const custom = fakeCtx()
  pkg.default.apply(custom, { projectDir: 'D:/repo', userFile: 'my-hooks.json', includeProject: false })
  assert.equal(custom.listeners.length, 5)
})
