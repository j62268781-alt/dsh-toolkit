import assert from 'node:assert/strict'
import test from 'node:test'

import { CSS, NAME, ORDER, install } from '../../src/modules/git/client/surfaces/branch-chip/index.js'

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
