import assert from 'node:assert/strict'
import test from 'node:test'

import { CSS, HERO_ORDER, NAME, ORDER, install, installHero } from '../../src/modules/git/client/surfaces/branch-chip/index.js'

/**
 * 这里只验注册面：弹层本身依赖宿主 primitives.Menu 与 portal，
 * 真挂载一次要 esbuild + jsdom，内存开销接近整个测试套件（本机会把 DSH 打到 OOM），
 * 交互逻辑因此放在 model 与 domain 两层测。
 */
function fakeCtx() {
  const seats = []
  const ctx = {
    locale: { bind: () => (key) => key },
    configForms: { get: () => undefined },
    slots: {
      inject(name, run) {
        seats.push({ name, entry: run() })
        return () => {}
      },
      register(descriptor, component) {
        return { descriptor, component }
      },
    },
  }
  return { ctx, seats }
}

test('install：只占 composer 左侧空位，descriptor 带 id/order/locale', () => {
  const { ctx, seats } = fakeCtx()
  const dispose = install(ctx)

  assert.equal(seats.length, 1)
  const [{ name, entry }] = seats
  assert.equal(name, 'conversation.input.left')
  assert.equal(entry.descriptor.name, 'conversation.input.left')
  assert.equal(entry.descriptor.id, 'dsh-toolkit.git.branch')
  assert.equal(entry.descriptor.order, ORDER)
  assert.equal(entry.descriptor.locale, 'shell-kit.git')
  assert.equal(typeof entry.component, 'function')
  assert.equal(typeof dispose, 'function')
})

test('installHero：新会话顶栏 list 槽，排在宿主 worktree 控件右侧', () => {
  const { ctx, seats } = fakeCtx()
  installHero(ctx)

  assert.equal(seats.length, 1)
  const [{ name, entry }] = seats
  assert.equal(name, 'conversation.hero.options')
  assert.equal(entry.descriptor.order, HERO_ORDER)
  // forge 的 `forge-panel.worktree` 没有写 order（缺省 0），排到它右边才能紧挨着。
  assert.ok(entry.descriptor.order > 0)
  assert.deepEqual(entry.descriptor.inject(), { placement: 'hero' })
})

test('两处注册并存：composer 与 hero 各占一个槽位', () => {
  const { ctx, seats } = fakeCtx()
  install(ctx)
  installHero(ctx)

  assert.deepEqual(seats.map(seat => seat.name), ['conversation.input.left', 'conversation.hero.options'])
  assert.equal(seats[0].entry.descriptor.id, seats[1].entry.descriptor.id)
})

test('模块自述：NAME 与全局注入的样式文本', () => {
  assert.equal(NAME, 'branch-chip')
  assert.match(CSS, /sk-git-branch__trigger/)
  assert.match(CSS, /corner-shape: round/)
})

test('createBranchChip 在缺 configForms 时也能装出组件', () => {
  const { ctx, seats } = fakeCtx()
  install(ctx)
  assert.equal(typeof seats[0].entry.component, 'function')
})
