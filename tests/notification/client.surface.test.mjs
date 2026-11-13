/**
 * 外围件测试：系统通知封装（权限 / 选项 / 点击激活 / 图标降级）、
 * 「最近通知」store、以及 Web Audio 提示音的降级行为。
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  TAG_LIMIT, TAG_PREFIX, activateWindow, browserPermission, dismissLiveNotifications,
  liveNotificationCount, notificationTag, pageIconUrl, requestBrowserPermission,
  showBrowserNotification, showTestNotification,
} from '../../src/modules/notification/client/browser-notify.ts'
import { RECENT_LIMIT, createRecentStore } from '../../src/modules/notification/client/recent.ts'
import { SOUND_IDS, SOUND_RECIPES, SoundPlayer, audioSupported, clampVolume, recipeDuration } from '../../src/modules/notification/client/sounds.ts'
import { createNotificationStub, makeDom } from './helpers.mjs'

const restores = []
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
})

function dom() {
  const page = makeDom()
  restores.push(() => page.restore())
  return page
}

test('没有 Notification API 时一切降级为 no-op', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Notification')
  Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: undefined })
  restores.push(() => {
    if (previous) Object.defineProperty(globalThis, 'Notification', previous)
    else delete globalThis.Notification
  })
  assert.equal(browserPermission(), 'unsupported')
  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), false)
})

test('只拦明确拒绝的权限；default 与 granted 都照发', () => {
  dom()
  const stub = createNotificationStub({ permission: 'default' })
  restores.push(() => stub.restore())
  assert.equal(browserPermission(), 'default')
  // default 不是拒绝：桌面外壳里权限由 Electron/系统侧决定，Chromium 的 permission 状态
  // 并不总能反映系统设置，所以这里尝试发，真被拒还有构造器异常与 error 事件两条诊断线。
  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), true)
  assert.equal(stub.instances.length, 1)

  stub.FakeNotification.permission = 'granted'
  assert.equal(showBrowserNotification({ title: '会话标题', body: '最后回复', tag: 'custom-tag' }), true)
  const instance = stub.instances[1]
  assert.equal(instance.title, '会话标题')
  assert.equal(instance.options.body, '最后回复')
  assert.equal(instance.options.tag, 'custom-tag')
  assert.equal(instance.options.renotify, true)
  assert.equal(instance.options.silent, true, 'the selected sound and mute preference control audio on web too')

  stub.FakeNotification.permission = 'denied'
  const before = stub.instances.length
  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), false)
  assert.equal(stub.instances.length, before, 'denied 时不构造通知')
})

test('只有交互类通知要求常驻（requireInteraction）', () => {
  dom()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  for (const kind of ['question', 'permission']) {
    showBrowserNotification({ title: 't', body: 'b', kind, sessionId: 's1' })
    assert.equal(stub.instances.at(-1).options.requireInteraction, true, `${kind} 必须常驻到用户处理`)
  }
  for (const kind of ['completed', 'failed']) {
    showBrowserNotification({ title: 't', body: 'b', kind, sessionId: 's1' })
    assert.equal(stub.instances.at(-1).options.requireInteraction, false, `${kind} 走系统默认超时`)
  }
  // 没给 kind（例如测试通知）也按默认超时处理。
  showBrowserNotification({ title: 't', body: 'b' })
  assert.equal(stub.instances.at(-1).options.requireInteraction, false)
})

test('dismissLiveNotifications 按归属会话回收，缺省全部回收', () => {
  dom()
  // live 是模块级的：先清干净，断言只针对本用例产生的通知。
  dismissLiveNotifications()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  showBrowserNotification({ title: 'a', body: 'b', kind: 'completed', sessionId: 's1' })
  showBrowserNotification({ title: 'a', body: 'b', kind: 'completed', sessionId: 's2' })
  showBrowserNotification({ title: 'a', body: 'b', kind: 'question', sessionId: 's2' })
  assert.equal(liveNotificationCount(), 3)

  assert.equal(dismissLiveNotifications((entry) => entry.sessionId === 's2'), 2)
  assert.equal(stub.instances.filter((instance) => instance.closed).length, 2)
  assert.equal(liveNotificationCount(), 1, '没被回收的仍然占着引用')

  assert.equal(dismissLiveNotifications(), 1)
  assert.equal(liveNotificationCount(), 0)
  assert.equal(stub.instances.filter((instance) => instance.closed).length, 3)
})

test('通知被关闭或平台拒绝后不再占引用', () => {
  dom()
  dismissLiveNotifications()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  showBrowserNotification({ title: 'a', body: 'b', kind: 'completed', sessionId: 's1' })
  showBrowserNotification({ title: 'a', body: 'b', kind: 'completed', sessionId: 's2' })
  assert.equal(liveNotificationCount(), 2)
  stub.instances[0].emit('close')
  assert.equal(liveNotificationCount(), 1)
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    stub.instances[1].emit('error')
  } finally {
    console.error = original
  }
  assert.equal(liveNotificationCount(), 0, '平台拒绝的通知不该继续留在引用表里')
  assert.equal(errors.length, 1)
})

test('桌面外壳下透传 silent，避免系统提示音与本模块提示音叠加', () => {
  dom()
  Object.defineProperty(globalThis, 'dshDesktop', { configurable: true, writable: true, value: { protocolVersion: 1 } })
  restores.push(() => delete globalThis.dshDesktop)
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  showBrowserNotification({ title: 't', body: 'b' })
  assert.equal(stub.instances[0].options.silent, true)
})

test('点击通知：聚焦窗口、执行跳转、关闭卡片', () => {
  const page = dom()
  let focused = 0
  page.window.focus = () => {
    focused += 1
  }
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const opened = []
  showBrowserNotification({
    title: 't',
    body: 'b',
    onClick: () => opened.push('session-1'),
  })
  const [instance] = stub.instances
  instance.onclick()
  assert.equal(focused, 1)
  assert.deepEqual(opened, ['session-1'])
  assert.equal(instance.closed, true)
})

test('点击回调抛错不吞掉关闭动作', () => {
  const page = dom()
  page.window.focus = () => {}
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  showBrowserNotification({
    title: 't',
    body: 'b',
    onClick: () => {
      throw new Error('navigation failed')
    },
  })
  const [instance] = stub.instances
  assert.doesNotThrow(() => instance.onclick())
  assert.equal(instance.closed, true)
})

test('图标：页面声明可抓取的 favicon 时带上；被拒绝时去掉图标重试一次', () => {
  const page = dom()
  const link = page.document.createElement('link')
  link.rel = 'icon'
  link.href = 'https://dsh.example.test/icon.png'
  page.document.head.appendChild(link)
  assert.equal(pageIconUrl(), 'https://dsh.example.test/icon.png')

  // 第一次带图标构造失败，第二次去掉图标成功。
  const instances = []
  class PickyNotification {
    constructor(title, options) {
      if (options?.icon !== undefined) throw new Error('icon rejected')
      this.title = title
      this.options = options
      instances.push(this)
    }
    close() {}
  }
  PickyNotification.permission = 'granted'
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Notification')
  Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: PickyNotification })
  restores.push(() => {
    if (previous) Object.defineProperty(globalThis, 'Notification', previous)
    else delete globalThis.Notification
  })
  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), true)
  assert.equal(instances.length, 1)
  assert.equal(instances[0].options.icon, undefined)
})

test('图标：SVG data URL 与 dsh-app: 协议不可用，跳过图标', () => {
  const page = dom()
  const link = page.document.createElement('link')
  link.rel = 'icon'
  link.href = 'data:image/svg+xml,<svg/>'
  page.document.head.appendChild(link)
  assert.equal(pageIconUrl(), undefined)
  link.href = 'dsh-app://app/icon.svg'
  assert.equal(pageIconUrl(), undefined)
})

test('申请权限：需要用户手势，返回最终权限状态', async () => {
  dom()
  const stub = createNotificationStub({ permission: 'default', requestResult: 'granted' })
  restores.push(() => stub.restore())
  assert.equal(await requestBrowserPermission(), 'granted')

  stub.FakeNotification.permission = 'denied'
  assert.equal(await requestBrowserPermission(), 'denied')
})

test('测试通知使用独立的 tag，便于和真实会话通知区分', () => {
  dom()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const t = (key) => ({ title: '通知', testDesc: '验证通知通道' }[key] ?? key)
  assert.equal(showTestNotification(t), true)
  assert.equal(stub.instances[0].title, '通知')
  assert.equal(stub.instances[0].options.body, '验证通知通道')
  assert.equal(stub.instances[0].options.tag, `${TAG_PREFIX}:test`)
})

// 桌面壳把通知 id `n#dsh-app://app#<tag>` 原样当 WinRT Toast 的 Tag，WinRT 上限 64 字符：
// 超了 put_Tag() 失败，整条通知被丢弃且渲染进程收不到任何错误。所以 tag 必须自己压住长度。
test('超长 tag 被压进原生上限：不再是整条通知静默消失', () => {
  dom()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const longTag = `${TAG_PREFIX}:f44a4570-aaaa-bbbb-cccc-dddddddddddd:permission`
  assert.ok(longTag.length > TAG_LIMIT, '前提：这个 tag 确实超限')
  assert.equal(showBrowserNotification({ title: 't', body: 'b', tag: longTag }), true)
  const { tag } = stub.instances[0].options
  assert.ok(tag.length <= TAG_LIMIT, `压到 ${tag.length} 字符仍超 ${TAG_LIMIT}`)
  assert.ok(tag.startsWith(`${TAG_PREFIX}:`), '压短后仍要保留前缀，便于识别是本模块发的')
})

test('notificationTag：稳定、定长、会话/类型不同则不同、且给桌面壳前缀留足余量', () => {
  const a = notificationTag('f44a4570-aaaa-bbbb-cccc-dddddddddddd', 'completed')
  assert.equal(a, notificationTag('f44a4570-aaaa-bbbb-cccc-dddddddddddd', 'completed'), '同输入必须稳定，否则折叠失效')
  assert.notEqual(a, notificationTag('f44a4570-aaaa-bbbb-cccc-dddddddddddd', 'failed'))
  assert.notEqual(a, notificationTag('other-session', 'completed'))
  assert.equal(notificationTag('s1'), notificationTag('s1', ''), '缺省类型归一为空串，仍要稳定')
  assert.ok(a.length <= TAG_LIMIT)
  assert.ok(a.length + 'n#dsh-app://app#'.length <= 64, '桌面壳 id 前缀 + tag 不能超过 WinRT 的 64')
  assert.match(a, new RegExp(`^${TAG_PREFIX}:[0-9a-f]{16}$`))
})

test('短 tag 原样保留（折叠语义不被改写）', () => {
  dom()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  showBrowserNotification({ title: 't', body: 'b', tag: 'short-tag' })
  assert.equal(stub.instances[0].options.tag, 'short-tag')
})

// 构造成功 ≠ 上屏成功：平台层（例如 WinRT 拒绝 Tag）只会发 `error` 事件，构造器不抛错。
// 不接这条线的话，「通知没弹」在外部完全查不出来——这正是 tag 超长隐藏了这么久的原因。
test('平台拒绝上屏时打 error 级诊断（warn 在宿主里等于静默）', () => {
  dom()
  const stub = createNotificationStub({ permission: 'granted' })
  restores.push(() => stub.restore())
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  restores.push(() => {
    console.error = original
  })

  assert.equal(showBrowserNotification({ title: 't', body: 'b', tag: 'short-tag' }), true)
  assert.deepEqual(errors, [], '刚发出去还不该报错')
  stub.instances[0].emit('error')
  assert.equal(errors.length, 1)
  assert.match(errors[0], /\[dsh-toolkit:notification\]/)
  assert.match(errors[0], /short-tag/)
})

test('构造器抛错也走 error 级诊断，并返回 false', () => {
  dom()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Notification')
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: class {
      static permission = 'granted'
      constructor() {
        throw new Error('constructor boom')
      }
    },
  })
  restores.push(() => {
    if (previous) Object.defineProperty(globalThis, 'Notification', previous)
    else delete globalThis.Notification
  })
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  restores.push(() => {
    console.error = original
  })

  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), false)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /constructor boom/)
})

test('activateWindow 在没有 window 时也不抛错', () => {
  assert.doesNotThrow(() => activateWindow())
})

test('最近通知 store：新的在前、有上限、可清空、订阅收到变更', () => {
  const store = createRecentStore(3)
  const seen = []
  const off = store.subscribe(() => seen.push(store.getSnapshot().length))
  assert.deepEqual(store.getSnapshot(), [])
  store.add({ kind: 'completed', sessionId: 's1', title: '一', body: 'a' })
  store.add({ kind: 'failed', sessionId: 's2', title: '二', body: 'b' })
  store.add({ kind: 'question', sessionId: 's3', title: '三', body: 'c' })
  store.add({ kind: 'permission', sessionId: 's4', title: '四', body: 'd' })
  const entries = store.getSnapshot()
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map((entry) => entry.title), ['四', '三', '二'])
  assert.ok(entries[0].id > entries[1].id)
  assert.deepEqual(seen, [1, 2, 3, 3])
  off()
  store.clear()
  assert.deepEqual(store.getSnapshot(), [])
  assert.equal(RECENT_LIMIT, 6)
  // 同一快照引用在两次变更之间保持稳定（useSyncExternalStore 的前提）。
  store.add({ kind: 'completed', sessionId: 's1', title: 'x', body: 'y' })
  assert.equal(store.getSnapshot(), store.getSnapshot())
})

test('提示音：配方与时长自洽，音量收窄到 0..1', () => {
  assert.deepEqual(SOUND_IDS, ['chime', 'fault', 'pop', 'alert'])
  for (const id of SOUND_IDS) {
    assert.ok(Array.isArray(SOUND_RECIPES[id]))
    assert.ok(SOUND_RECIPES[id].length > 0)
    assert.ok(recipeDuration(SOUND_RECIPES[id]) > 0)
  }
  assert.equal(recipeDuration(SOUND_RECIPES.pop), 0.08)
  assert.equal(clampVolume(2), 1)
  assert.equal(clampVolume(-1), 0)
  assert.equal(clampVolume('0.4'), 0.4)
  assert.equal(clampVolume('nope'), 0)
})

test('提示音：没有 AudioContext 时静默返回 false，dispose 幂等', () => {
  const player = new SoundPlayer(() => 0.6)
  assert.equal(audioSupported(), false)
  assert.equal(player.play('chime'), false)
  assert.equal(player.play('none'), false)
  assert.equal(player.play('unknown'), false)
  player.dispose()
  player.dispose()
  assert.equal(player.play('pop'), false)
})

test('提示音：有 AudioContext 时按配方排程振荡器', () => {
  const started = []
  const stopped = []
  const gains = []
  class FakeGain {
    constructor() {
      this.gain = { value: 1, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }
    }
    connect() {}
  }
  class FakeOscillator {
    constructor() {
      this.type = 'sine'
      this.frequency = { value: 0 }
    }
    connect() {}
    start(at) {
      started.push(at)
    }
    stop(at) {
      stopped.push(at)
    }
  }
  class FakeCompressor {
    constructor() {
      this.threshold = { value: 0 }
      this.knee = { value: 0 }
      this.ratio = { value: 0 }
    }
    connect() {}
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'running'
      this.currentTime = 1
      this.destination = {}
    }
    createGain() {
      const gain = new FakeGain()
      gains.push(gain)
      return gain
    }
    createOscillator() {
      return new FakeOscillator()
    }
    createDynamicsCompressor() {
      return new FakeCompressor()
    }
    suspend() {
      this.state = 'suspended'
    }
    close() {}
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, writable: true, value: FakeAudioContext })
  restores.push(() => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous)
    else delete globalThis.AudioContext
  })

  const player = new SoundPlayer(() => 0.5)
  assert.equal(player.play('chime'), true)
  assert.equal(started.length, 2, 'chime has two tones')
  assert.equal(stopped.length, 2)
  assert.ok(gains.length >= 3, 'master + per-tone envelopes')
  player.dispose()
})
