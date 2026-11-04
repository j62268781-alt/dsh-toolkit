/**
 * 外围件测试：系统通知封装（权限 / 选项 / 点击激活 / 图标降级）、
 * 「最近通知」store、以及 Web Audio 提示音的降级行为。
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  TAG_PREFIX, activateWindow, browserPermission, pageIconUrl, requestBrowserPermission,
  showBrowserNotification, showTestNotification,
} from '../../src/modules/notification/client/browser-notify.js'
import { RECENT_LIMIT, createRecentStore } from '../../src/modules/notification/client/recent.js'
import { SOUND_IDS, SOUND_RECIPES, SoundPlayer, audioSupported, clampVolume, recipeDuration } from '../../src/modules/notification/client/sounds.js'
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

test('权限不足时不弹通知；授予后按选项发一条', () => {
  dom()
  const stub = createNotificationStub({ permission: 'default' })
  restores.push(() => stub.restore())
  assert.equal(browserPermission(), 'default')
  assert.equal(showBrowserNotification({ title: 't', body: 'b' }), false)
  assert.equal(stub.instances.length, 0)

  stub.FakeNotification.permission = 'granted'
  assert.equal(showBrowserNotification({ title: '会话标题', body: '最后回复', tag: 'custom-tag' }), true)
  const [instance] = stub.instances
  assert.equal(instance.title, '会话标题')
  assert.equal(instance.options.body, '最后回复')
  assert.equal(instance.options.tag, 'custom-tag')
  assert.equal(instance.options.renotify, true)
  assert.equal(instance.options.silent, true, 'the selected sound and mute preference control audio on web too')
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
