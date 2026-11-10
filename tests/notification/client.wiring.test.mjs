/**
 * 端到端接线测试：真实 index.jsx + 假 ctx 服务，覆盖用户要求的关键行为。
 *
 *   - 会话跑完 → 系统通知的标题是会话标题、正文是最后一个回复；
 *   - 点击通知 → `uiWorkspace.openSession(sessionId)` 跳回对应会话（归档的先取消归档）；
 *   - 会话失败 / 待回答 → 各自的类型与正文；
 *   - 正在读的会话默认不打扰；总开关关闭时完全不打扰。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { notificationTag } from '../../src/modules/notification/client/browser-notify.js'
import {
  chatSnapshot, createFakeContext, createNotificationStub, createSoundFetchStub, loadNotificationModule, makeDom, sleep,
} from './helpers.mjs'

/** 桌面壳通知 id 的固定前缀长度：`n#dsh-app://app#`（WinRT Tag 是整串 id，上限 64）。 */
const DESKTOP_ID_PREFIX = 'n#dsh-app://app#'.length

/** 组装一次完整接线：jsdom + 通知桩 + 假 ctx + 真实 apply。 */
async function boot(options = {}) {
  const page = makeDom()
  // jsdom 没实现 Window.focus()，把它换成一个可断言的空实现（测试自己会覆盖计数）。
  page.window.focus = () => {}
  const stub = createNotificationStub({ permission: options.permission ?? 'granted' })
  const fetch = createSoundFetchStub()
  const runtime = createFakeContext(options)
  const module = await loadNotificationModule(`notification-wiring-${Math.random().toString(36).slice(2)}`)
  const client = module.default((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: undefined, Button: undefined }
    throw new Error(`unexpected module ${id}`)
  })
  client.apply(runtime.ctx)
  assert.deepEqual(fetch.requests, [], 'registration must not fetch sounds before mount or notification event')
  return {
    page,
    stub,
    fetch,
    runtime,
    async dispose() {
      runtime.dispose()
      stub.restore()
      fetch.restore()
      page.restore()
    },
  }
}

/** 让 settle 窗口与分发链路跑完。 */
async function flush() {
  await act(async () => {
    await sleep(450)
  })
}

test('会话跑完：通知标题是会话标题，正文是固定的完成短句', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '修复登录问题', running: true } },
    chats: { s1: chatSnapshot({ reply: '已修复登录跳转，并补了回归测试。' }) },
  })
  t.after(() => app.dispose())

  app.runtime.setRunning('s1', false)
  await flush()

  assert.equal(app.stub.instances.length, 1)
  const [notification] = app.stub.instances
  assert.equal(notification.title, '修复登录问题')
  // 正文不再搬运最终回复：长回复会把通知卡片挤爆，信息也不如「发生了什么」有用。
  assert.equal(notification.options.body, '已完成这一轮回复。')
  assert.equal(notification.options.tag, notificationTag('s1', 'completed'))
  assert.ok(
    notification.options.tag.length + DESKTOP_ID_PREFIX <= 64,
    '桌面壳把 tag 拼进 n#<origin>#<tag> 后必须仍在 WinRT 的 64 字符上限内',
  )
})

test('点击通知：聚焦窗口、请求提窗并跳转到对应会话', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '会话标题', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  let focused = 0
  app.page.window.focus = () => {
    focused += 1
  }

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.runtime.openedSessions.length, 0)

  app.stub.instances[0].onclick()
  // 系统横幅点击本身会先 focus 一次；openSession 再聚焦一次（旧实现只聚焦一次）。
  assert.equal(focused, 2, 'clicking a notification focuses the page/window before navigating')
  assert.deepEqual(app.runtime.openedSessions, ['s1'])
  // window.focus() 在 Windows 上会被前台锁忽略，必须再让 host 侧启动一次应用实例；
  // 这条请求就是「真的把窗口提到前台」的那一步。
  const raise = app.fetch.requests.filter(({ url }) => url.pathname === '/api/plugins/dsh-toolkit/notification/raise')
  assert.equal(raise.length, 1, 'clicking a notification must ask the host to raise the desktop window')
  assert.equal(raise[0].options.method, 'POST')
})

test('已归档的会话：点击时先取消归档再打开', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '归档会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
    archived: ['s1'],
  })
  t.after(() => app.dispose())

  app.runtime.setRunning('s1', false)
  await flush()
  app.stub.instances[0].onclick()
  await act(async () => {
    await sleep(20)
  })
  assert.deepEqual(app.runtime.unarchived, ['s1'])
  assert.deepEqual(app.runtime.openedSessions, ['s1'])
})

test('会话失败：用 failed 类型与错误信息，正文不冒充最终回复', async (t) => {
  const chats = { s1: chatSnapshot({ reply: '' }) }
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '失败的会话', running: true } },
    chats,
  })
  t.after(() => app.dispose())

  // 开跑后本轮才出现 turn-error：基线是 0，所以会被判为失败。
  chats.s1 = chatSnapshot({ error: { seq: 2, message: '工具调用超时' } })
  app.runtime.setRunning('s1', false)
  await flush()

  assert.equal(app.stub.instances.length, 1)
  assert.equal(app.stub.instances[0].title, '失败的会话')
  assert.equal(app.stub.instances[0].options.body, '这一轮执行失败，请打开会话查看详情。')
})

test('等待回答：待交互出现时提醒一次，正文是固定短句', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '需要你回答', running: false } },
    chats: { s1: chatSnapshot({ reply: '' }) },
  })
  t.after(() => app.dispose())

  app.runtime.setStatuses({
    s1: {
      running: false,
      pendingInteraction: {
        kind: 'question',
        key: 'question:s1:call-1',
        questions: [{ question: '要删除这两个文件吗？' }],
      },
    },
  })
  await flush()

  assert.equal(app.stub.instances.length, 1)
  assert.equal(app.stub.instances[0].title, '需要你回答')
  assert.equal(app.stub.instances[0].options.body, '正在等待你的回答。')

  // 同一个互动重复快照不重复提醒。
  app.runtime.setStatuses({
    s1: {
      running: false,
      pendingInteraction: {
        kind: 'question',
        key: 'question:s1:call-1',
        questions: [{ question: '要删除这两个文件吗？' }],
      },
    },
  })
  await flush()
  assert.equal(app.stub.instances.length, 1)
})

test('需要授权：approval 互动归到 permission 类型', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '等待授权', running: false } },
    chats: { s1: chatSnapshot({ reply: '' }) },
  })
  t.after(() => app.dispose())

  app.runtime.setStatuses({
    s1: {
      running: false,
      pendingInteraction: { kind: 'approval', key: 'approval:1', toolName: 'bash', reason: '需要执行命令' },
    },
  })
  await flush()

  assert.equal(app.stub.instances.length, 1)
  assert.equal(app.stub.instances[0].title, '等待授权')
  assert.equal(app.stub.instances[0].options.body, '需要你的授权才能继续。')
})

test('默认失焦时机：窗口聚焦时安静，隐藏后提醒正在读的会话', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '正在读的会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
    retainedBy: { s1: { mainView: 1 } },
  })
  t.after(() => app.dispose())
  app.page.document.hasFocus = () => true
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => 'visible' })

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 0, 'a focused window stays quiet')
  assert.deepEqual(app.fetch.requests, [], 'a suppressed event must not load audio')

  // 隐藏优先于 hasFocus 的结果。
  app.runtime.setRunning('s1', true)
  await flush()
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 1)
})

test('全局通知时机适用于后台会话与待交互，旧 hidden 与 unfocused 一致', async (t) => {
  for (const currentMode of ['never', 'unfocused', 'always', 'hidden']) {
    await t.test(currentMode, async (t) => {
      const app = await boot({
        notification: { currentMode, soundEnabled: false },
        sessions: {
          s1: { id: 's1', displayTitle: '后台完成', running: true },
          s2: { id: 's2', displayTitle: '后台待回答', running: false },
        },
        chats: { s1: chatSnapshot({ reply: '完成' }) },
      })
      t.after(() => app.dispose())
      let focused = true
      app.page.document.hasFocus = () => focused
      Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => 'visible' })
      app.runtime.setRunning('s1', false)
      app.runtime.setStatuses({ s2: { running: false, pendingInteraction: { kind: 'question', key: 'question:1', questions: ['继续吗？'] } } })
      await flush()
      assert.equal(app.stub.instances.length, currentMode === 'always' ? 2 : 0, 'foreground policy applies even when neither session is open')
      focused = false
      app.runtime.setRunning('s1', true)
      app.runtime.setRunning('s1', false)
      app.runtime.setStatuses({ s2: { running: false, pendingInteraction: { kind: 'approval', key: 'approval:2', reason: '需要授权' } } })
      await flush()
      assert.equal(app.stub.instances.length, currentMode === 'never' ? 0 : currentMode === 'always' ? 4 : 2)
      assert.deepEqual(app.fetch.requests, [], 'muted or suppressed events never fetch audio')
    })
  }
})

test('自定义声音的系统通知在浏览器和桌面都 silent，防止重复响铃', async (t) => {
  for (const desktop of [false, true]) {
    await t.test(desktop ? 'desktop' : 'web', async (t) => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'dshDesktop')
      if (desktop) Object.defineProperty(globalThis, 'dshDesktop', { configurable: true, value: {} })
      else delete globalThis.dshDesktop
      t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'dshDesktop', previous)
        else delete globalThis.dshDesktop
      })
      const app = await boot({
        notification: { sound: 'a'.repeat(32) },
        sessions: { s1: { id: 's1', displayTitle: '自定义声音', running: true } },
        chats: { s1: chatSnapshot({ reply: '完成' }) },
      })
      t.after(() => app.dispose())
      app.runtime.setRunning('s1', false)
      await flush()
      assert.equal(app.stub.instances.length, 1)
      assert.equal(app.stub.instances[0].options.silent, true)
    })
  }
})

test('系统音播放在事件发生后异步获取音频，通知和会话跳转不等待解码', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  const played = [], gains = []
  let finishDecode
  class FakeAudioContext {
    state = 'running'
    destination = {}
    async decodeAudioData(bytes) {
      assert.ok(bytes.byteLength > 0)
      return new Promise((resolve) => { finishDecode = () => resolve({ duration: 0.1 }) })
    }
    createGain() {
      const gain = { gain: { value: 0 }, connect() {}, disconnect() {} }
      gains.push(gain)
      return gain
    }
    createBufferSource() {
      return { connect() {}, disconnect() {}, start() { played.push(this.buffer) }, stop() {} }
    }
    async close() {}
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext })
  const app = await boot({
    notification: { sound: 'system', volume: 0.25 },
    sessions: { s1: { id: 's1', displayTitle: '系统声音', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(async () => {
    await app.dispose()
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous)
    else delete globalThis.AudioContext
  })
  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 1)
  assert.equal(played.length, 0, 'notification display does not wait for audio decoding')
  assert.equal(app.fetch.requests.length, 1, 'an event fetches only its audio; catalogue loading stays panel-lazy')
  assert.equal(app.fetch.requests[0].url.pathname, '/api/plugins/dsh-toolkit/notification/sound')
  assert.equal(app.fetch.requests[0].url.searchParams.get('id'), 'system')
  assert.equal(app.fetch.requests[0].options.credentials, 'same-origin')
  app.stub.instances[0].onclick()
  assert.deepEqual(app.runtime.openedSessions, ['s1'])
  assert.equal(typeof finishDecode, 'function')
  finishDecode()
  await act(async () => { await sleep(10) })
  assert.equal(played.length, 1)
  assert.equal(gains[0].gain.value, 0.25)
})

test('总开关关闭时不发通知；提示音开关关闭时只发通知不响铃', async (t) => {
  const off = await boot({
    notification: { enabled: false },
    sessions: { s1: { id: 's1', displayTitle: '会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => off.dispose())
  off.runtime.setRunning('s1', false)
  await flush()
  assert.equal(off.stub.instances.length, 0)

  const muted = await boot({
    notification: { soundEnabled: false },
    sessions: { s1: { id: 's1', displayTitle: '会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => muted.dispose())
  muted.runtime.setRunning('s1', false)
  await flush()
  assert.equal(muted.stub.instances.length, 1)
})

test('回到前台：看得见的会话的提醒被收回，别的会话不受影响', async (t) => {
  const app = await boot({
    sessions: {
      s1: { id: 's1', displayTitle: '正在读的会话', running: true },
      s2: { id: 's2', displayTitle: '后台会话', running: true },
    },
    chats: { s1: chatSnapshot({ reply: '完成一' }), s2: chatSnapshot({ reply: '完成二' }) },
  })
  t.after(() => app.dispose())
  let focused = false
  app.page.document.hasFocus = () => focused
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => (focused ? 'visible' : 'hidden') })

  app.runtime.setRunning('s1', false)
  app.runtime.setRunning('s2', false)
  await flush()
  assert.equal(app.stub.instances.length, 2)

  // 用户回到 s1：s1 的卡片收起，s2 的留着（还没看）。
  focused = true
  app.runtime.ctx.uiWorkspace.openSession('s1')
  await act(async () => { await sleep(10) })
  app.page.window.dispatchEvent(new app.page.window.Event('focus'))
  assert.deepEqual(app.stub.instances.map((instance) => instance.closed), [true, false])
})

test('回到前台时没有可见会话：把所有挂着的提醒一起收掉', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  t.after(() => app.dispose())
  let focused = false
  app.page.document.hasFocus = () => focused
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => (focused ? 'visible' : 'hidden') })

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 1)
  assert.equal(app.stub.instances[0].closed, false)

  focused = true
  app.page.document.dispatchEvent(new app.page.window.Event('visibilitychange'))
  assert.equal(app.stub.instances[0].closed, true, '用户回来了就不要再把卡片挂在外面')
})

test('没回到前台时不会误收提醒；卸载时摘掉事件监听', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
  })
  let focused = false
  app.page.document.hasFocus = () => focused
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => 'hidden' })

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 1)

  app.page.window.dispatchEvent(new app.page.window.Event('focus'))
  assert.equal(app.stub.instances[0].closed, false, '窗口还没真正回到前台时不该收卡片')

  await app.dispose()
  focused = true
  app.page.document.dispatchEvent(new app.page.window.Event('visibilitychange'))
  assert.equal(app.stub.instances[0].closed, false, '卸载后监听必须被摘掉')
})

test('灵动岛在线时前台不再响提示音：标记消失后恢复', async (t) => {
  // jsdom 没有 Web Audio：装一个最小实现，才能观察到「提示音到底有没有被接受」。
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  class FakeAudioContext {
    state = 'running'
    destination = {}
    async decodeAudioData() { return { duration: 0.1 } }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} } }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {} } }
    async close() {}
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext })
  const app = await boot({
    sessions: {
      s1: { id: 's1', displayTitle: '岛在显示', running: true },
      s2: { id: 's2', displayTitle: '岛不在', running: true },
    },
    chats: { s1: chatSnapshot({ reply: '完成一' }), s2: chatSnapshot({ reply: '完成二' }) },
  })
  t.after(async () => {
    await app.dispose()
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous)
    else delete globalThis.AudioContext
  })
  app.page.document.hasFocus = () => true
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => 'visible' })
  // pet 客户端在「岛开启 + helper 在跑」时写下的跨模块标记。
  app.page.document.documentElement.dataset.dshIsland = 'on'

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 0, '前台本来就不弹横幅')
  assert.deepEqual(app.fetch.requests, [], '岛在前台时通知侧连提示音都不该响')

  // 岛下线（helper 停了 / 用户关掉岛）：同一个标记消失，恢复「前台只有提示音」的旧行为。
  delete app.page.document.documentElement.dataset.dshIsland
  app.runtime.setRunning('s2', false)
  await flush()
  assert.equal(app.stub.instances.length, 0, '前台仍然不弹横幅')
  const audio = app.fetch.requests.filter(({ url }) => url.pathname === '/api/plugins/dsh-toolkit/notification/sound')
  assert.equal(audio.length, 1, '没有岛时前台回到提示音反馈')
})
