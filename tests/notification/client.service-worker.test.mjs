/**
 * Service Worker 通知通道的客户端测试。
 *
 * jsdom 没有 `navigator.serviceWorker`，所以这里自己造一个够真的假 SW：
 * 只实现 `register()` / `ready` / `showNotification()` / `getNotifications()`，
 * 足以验证「注册参数、发出去的载荷、失败回退、按 tag 回收」四件事。
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  dismissLiveNotifications, liveNotificationCount, showBrowserNotification,
} from '../../src/modules/notification/client/browser-notify.ts'
import {
  ensureNotificationServiceWorker, resetNotificationServiceWorker, serviceWorkerSupported,
} from '../../src/modules/notification/client/service-worker.ts'
import { SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE } from '../../src/modules/notification/host/constants.ts'
import { createNotificationStub, makeDom, sleep } from './helpers.mjs'

const restores = []
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
  resetNotificationServiceWorker()
})

/** 装一个假 SW 环境，返回可观察的调用记录。 */
function stubServiceWorker({ failRegister = false, failShow = false } = {}) {
  const registered = []
  const shown = []
  const closed = []
  const registration = {
    scope: SERVICE_WORKER_SCOPE,
    showNotification: async (title, options) => {
      if (failShow) throw new Error('showNotification refused')
      shown.push({ title, options })
    },
    getNotifications: async () => shown.map(({ title, options }) => ({
      title,
      tag: options.tag,
      data: options.data,
      close() { closed.push(options.tag) },
    })),
  }
  const worker = {
    register: async (url, options) => {
      registered.push({ url, options })
      if (failRegister) throw new Error('registration blocked')
      return registration
    },
    ready: Promise.resolve(registration),
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { serviceWorker: worker } })
  restores.push(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
    else delete globalThis.navigator
  })
  return { registered, shown, closed, registration, worker }
}

test('没有 serviceWorker 时判定为不支持，通知照旧走构造器', () => {
  const dom = makeDom()
  restores.push(() => dom.restore())
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  assert.equal(serviceWorkerSupported(), false)
  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), true)
  assert.equal(stub.instances.length, 1)
})

test('支持时用 SW 发通知：注册参数、载荷与启动 URL 都对，页面级构造器不参与', async () => {
  const dom = makeDom()
  restores.push(() => dom.restore())
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const sw = stubServiceWorker()

  // live/liveTags 是模块级状态，会跨用例累加：先清掉上一个用例留下的，后面的计数才有意义。
  dismissLiveNotifications()
  await sleep(10)
  const base = liveNotificationCount()

  assert.equal(serviceWorkerSupported(), true)
  assert.equal(showBrowserNotification({ title: '会话标题', body: '最后回复', tag: 'tag-1', sessionId: 'abc-123' }), true)
  await sleep(10)

  assert.deepEqual(sw.registered.map(({ url, options }) => [url, options.scope]), [[SERVICE_WORKER_PATH, SERVICE_WORKER_SCOPE]])
  assert.equal(sw.shown.length, 1)
  assert.equal(sw.shown[0].title, '会话标题')
  assert.equal(sw.shown[0].options.body, '最后回复')
  assert.equal(sw.shown[0].options.tag, 'tag-1')
  assert.equal(sw.shown[0].options.silent, true)
  // 点击时只剩 data：会话与带 token 的启动地址都必须在这里。
  assert.equal(sw.shown[0].options.data.sessionId, 'abc-123')
  assert.ok(sw.shown[0].options.data.url.endsWith('#dsh-toolkit-session=abc-123'))
  assert.equal(stub.instances.length, 0, 'SW 成功时不该再造一份页面级通知')
  assert.equal(liveNotificationCount(), base + 1)
})

test('SW 发通知失败时安静退回构造器', async () => {
  const dom = makeDom()
  restores.push(() => dom.restore())
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  stubServiceWorker({ failShow: true })

  assert.equal(showBrowserNotification({ title: '退路', body: 'b', tag: 'tag-2' }), true)
  await sleep(10)
  assert.equal(stub.instances.length, 1)
  assert.equal(stub.instances[0].title, '退路')
})

test('注册被拦时同样退回构造器，且不会反复重试', async () => {
  const dom = makeDom()
  restores.push(() => dom.restore())
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const sw = stubServiceWorker({ failRegister: true })

  showBrowserNotification({ title: '一', body: 'b' })
  showBrowserNotification({ title: '二', body: 'b' })
  await sleep(10)
  assert.equal(stub.instances.length, 2)
  // 记忆化：一次失败之后不再重复 register（否则每次通知都白跑一次注册）。
  assert.equal(sw.registered.length, 1)
})

test('resetNotificationServiceWorker 让下一次重新注册', async () => {
  const dom = makeDom()
  restores.push(() => dom.restore())
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const sw = stubServiceWorker()

  await ensureNotificationServiceWorker()
  await ensureNotificationServiceWorker()
  assert.equal(sw.registered.length, 1)
  resetNotificationServiceWorker()
  await ensureNotificationServiceWorker()
  assert.equal(sw.registered.length, 2)
})

test('回前台回收时按 data 过滤并关掉 SW 侧的通知', async () => {
  const dom = makeDom()
  restores.push(() => dom.restore())
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const sw = stubServiceWorker()

  // 同上：模块级 live/liveTags 会带进来上一个用例留的条目。
  dismissLiveNotifications()
  await sleep(10)
  const base = liveNotificationCount()

  showBrowserNotification({ title: '甲', body: 'b', tag: 'tag-a', sessionId: 'a' })
  showBrowserNotification({ title: '乙', body: 'b', tag: 'tag-b', sessionId: 'b' })
  await sleep(10)
  assert.equal(liveNotificationCount(), base + 2)

  // 只回收当前会话 a 的那条：b 的卡片应该留着。
  assert.equal(dismissLiveNotifications((entry) => entry.sessionId === 'a'), 0)
  await sleep(10)
  assert.deepEqual(sw.closed, ['tag-a'])
  assert.equal(liveNotificationCount(), base + 1)
})
