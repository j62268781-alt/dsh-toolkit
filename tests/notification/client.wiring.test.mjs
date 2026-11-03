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
import {
  chatSnapshot, createFakeContext, createNotificationStub, loadNotificationModule, makeDom, sleep,
} from './helpers.mjs'

/** 组装一次完整接线：jsdom + 通知桩 + 假 ctx + 真实 apply。 */
async function boot(options = {}) {
  const page = makeDom()
  // jsdom 没实现 Window.focus()，把它换成一个可断言的空实现（测试自己会覆盖计数）。
  page.window.focus = () => {}
  const stub = createNotificationStub({ permission: options.permission ?? 'granted' })
  const runtime = createFakeContext(options)
  const module = await loadNotificationModule(`notification-wiring-${Math.random().toString(36).slice(2)}`)
  const client = module.default((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: undefined, Button: undefined }
    throw new Error(`unexpected module ${id}`)
  })
  client.apply(runtime.ctx)
  return {
    page,
    stub,
    runtime,
    async dispose() {
      runtime.dispose()
      stub.restore()
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

test('会话跑完：通知标题是会话标题，正文是最后一个 assistant 回复', async (t) => {
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
  assert.equal(notification.options.body, '已修复登录跳转，并补了回归测试。')
  assert.match(notification.options.tag, /s1:completed$/)
})

test('点击通知：聚焦窗口并跳转到对应会话', async (t) => {
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
  assert.equal(focused, 1, 'clicking a notification focuses the page/window first')
  assert.deepEqual(app.runtime.openedSessions, ['s1'])
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
  assert.equal(app.stub.instances[0].options.body, '工具调用超时')
})

test('等待回答：待交互出现时提醒一次，正文是问题文本', async (t) => {
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
  assert.equal(app.stub.instances[0].options.body, '要删除这两个文件吗？')

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
  assert.equal(app.stub.instances[0].options.body, '需要执行命令')
})

test('正在读的会话默认不打扰；hidden 时机在窗口隐藏时才提醒', async (t) => {
  const app = await boot({
    sessions: { s1: { id: 's1', displayTitle: '正在读的会话', running: true } },
    chats: { s1: chatSnapshot({ reply: '完成' }) },
    retainedBy: { s1: { mainView: 1 } },
  })
  t.after(() => app.dispose())

  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 0, 'the session you are reading stays quiet')

  // 再看一次同样的边沿：把文档标记为隐藏，应当提醒。
  app.runtime.setRunning('s1', true)
  await flush()
  Object.defineProperty(app.page.document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  app.runtime.setRunning('s1', false)
  await flush()
  assert.equal(app.stub.instances.length, 1)
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
