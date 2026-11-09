/**
 * 桥接分发测试：白名单、去重、命令、消息转发与发回。
 *
 * 用真实的 store（临时文件）与假的 api / 会话管理器，
 * 这样既验证编排逻辑，又不需要 DSH Agent 运行时和网络。
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createBridge } from '../../src/modules/weixin-clawbot/host/bridge.js'
import { createBridgeStore } from '../../src/modules/weixin-clawbot/host/store.js'

const CREDENTIAL = {
  token: 'tibdr-unit-token',
  accountId: 'ilink-bot-account-0123456789',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  userId: 'user-bot-owner',
}

function settings(overrides = {}) {
  return {
    bridgeEnabled: true,
    bridgeAccessPolicy: 'allowlist',
    bridgeAllowFrom: [],
    bridgeAgentPreset: '',
    bridgePermissionPreset: '',
    bridgeWorkspace: '',
    bridgeIncludeImages: true,
    bridgeRequestTimeoutMs: 20_000,
    bridgeApprovalTimeoutMs: 120_000,
    ...overrides,
  }
}

/**
 * 一套可观测的假环境。
 * options.bound：初始绑定的会话 id（默认绑一条，方便测「已选会话后」的正常链路；
 * 传 undefined 可以测「还没选会话」的选择卡路径）。
 */
async function harness(overrides = {}, ctxExtra = {}, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wc-bridge-'))
  const sent = []
  const calls = { process: [], cancel: 0, rotate: 0, switchTo: [] }
  let bound = 'bound' in options ? options.bound : 'weixin-clawbot-user-0123456789'
  const store = createBridgeStore({ filePath: join(dir, 'state.json') })
  await store.load()
  const api = {
    async sendText(userId, text, contextToken) {
      sent.push({ userId, text, contextToken })
    },
    async sendImage() {},
    async sendTyping() {},
    async getTypingTicket() {
      return 'ticket-1'
    },
  }
  const conversations = {
    async process(userId, content) {
      calls.process.push({ userId, content })
      return { text: '好的，已处理。', images: [] }
    },
    async cancel() {
      calls.cancel += 1
      return true
    },
    rotate(userId, cwd) {
      calls.rotate += 1
      calls.rotateWorkspace = cwd
      bound = 'weixin-clawbot-test-r2'
      return bound
    },
    switchTo(userId, sessionId, cwd) {
      calls.switchTo.push({ userId, sessionId, cwd })
      bound = sessionId
      return sessionId
    },
    bindingOf: () => bound,
    sourceOf: () => (bound === undefined ? 'auto' : 'picked'),
    unbind() {
      bound = undefined
    },
    workspaceOf: () => options.workspaceOf ?? '/tmp/wc-workspace',
    sessionIdOf: (userId) => (userId === undefined ? undefined : `weixin-clawbot-${userId}`),
    dispose() {},
  }
  const bridge = createBridge({
    ctx: { attachments: { async readImage() { throw new Error('no image') } }, ...ctxExtra },
    settings: settings(overrides),
    getCredential: async () => CREDENTIAL,
    createApi: () => api,
    createStore: () => store,
    createConversationManager: () => conversations,
  })
  const message = (text, extra = {}) => ({
    message_type: 1,
    from_user_id: 'user-0123456789',
    message_id: `m-${Math.random()}`,
    context_token: 'ctx-1',
    item_list: [{ type: 1, text_item: { text } }],
    ...extra,
  })
  return {
    bridge,
    sent,
    calls,
    store,
    message,
    boundOf: () => bound,
    async dispose() {
      await bridge.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test('Bot 自己的消息与空发送者不会进入分发', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.handleMessage(h.message('hi', { message_type: 2 }))
    await h.bridge.handleMessage(h.message('hi', { from_user_id: '   ' }))
    assert.equal(h.calls.process.length, 0)
    assert.equal(h.sent.length, 0)
  } finally {
    await h.dispose()
  }
})

test('连接即开启桥接：第一个说话的人被认作本人并锁定白名单', async () => {
  const h = await harness()
  try {
    // 落盘里可能是旧版本留下的关闭状态，连接/预热后应被纠正成开启 + 仅本人。
    await h.bridge.handleMessage(h.message('hi'))
    assert.equal(h.bridge.status().enabled, true)
    assert.equal(h.bridge.status().accessPolicy, 'allowlist')
    assert.equal(h.calls.process.length, 1)
    assert.deepEqual(h.store.getAllowFrom(), ['user-0123456789'])
    assert.equal(h.store.isOwnerPinned(), true)
  } finally {
    await h.dispose()
  }
})

test('本人确认之后，其他人的消息被静默跳过，也不进 Agent', async () => {
  const h = await harness()
  try {
    // 本人先说话 → 锁定。
    await h.bridge.handleMessage(h.message('我是本人'))
    assert.equal(h.calls.process.length, 1)

    await h.bridge.handleMessage(h.message('hi', {
      from_user_id: 'user-9999999999',
      message_id: 'm-stranger-1',
    }))
    assert.equal(h.calls.process.length, 1, '陌生人不能进 Agent')
    assert.equal(h.bridge.status().skipped, 1)
    assert.equal(h.bridge.status().lastUserId, 'user******9999')
    assert.equal(h.bridge.status().canAllowRecent, true)
  } finally {
    await h.dispose()
  }
})

test('显式放行：允许最近联系人后陌生人也能用', async () => {
  const h = await harness()
  try {
    await h.bridge.handleMessage(h.message('我是本人'))
    await h.bridge.handleMessage(h.message('hi', {
      from_user_id: 'user-9999999999',
      message_id: 'm-stranger-1',
    }))
    const status = await h.bridge.setAccess({ allowRecent: true })
    assert.equal(status.allowCount, 2)
    await h.bridge.handleMessage(h.message('再来一次', {
      from_user_id: 'user-9999999999',
      message_id: 'm-stranger-2',
    }))
    assert.equal(h.calls.process.length, 2)
  } finally {
    await h.dispose()
  }
})

test('授权用户的消息交给会话管理器，回复发回微信并带 context_token', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.handleMessage(h.message('帮我看看这个报错'))
    assert.equal(h.calls.process.length, 1)
    const [{ content }] = h.calls.process
    assert.ok(Array.isArray(content))
    assert.ok(content[0].text.includes('帮我看看这个报错'))
    assert.deepEqual(h.sent.at(-1), { userId: 'user-0123456789', text: '好的，已处理。', contextToken: 'ctx-1' })
    assert.equal(h.bridge.status().replied, 1)
  } finally {
    await h.dispose()
  }
})

test('同一条消息只处理一次（去重表落盘）', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    const message = h.message('重复')
    await h.bridge.handleMessage(message)
    await h.bridge.handleMessage(message)
    assert.equal(h.calls.process.length, 1)
  } finally {
    await h.dispose()
  }
})

test('关闭桥接后彻底不处理（运行时开关优先于配置）', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.setAccess({ enabled: false })
    await h.bridge.handleMessage(h.message('hi'))
    assert.equal(h.calls.process.length, 0)
    assert.equal(h.bridge.status().enabled, false)
    await h.bridge.setAccess({ enabled: true })
    await h.bridge.handleMessage(h.message('hi again'))
    assert.equal(h.calls.process.length, 1)
  } finally {
    await h.dispose()
  }
})

test('重启后落盘的开关与策略生效（首条消息前不预热也能读到状态）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wc-bridge-'))
  const filePath = join(dir, 'state.json')
  try {
    // 上一个进程：面板里开了桥接、切到 open 策略。
    const before = createBridgeStore({ filePath })
    await before.load()
    before.setEnabled(true)
    before.setPolicy('open')
    await before.flush()

    // 新进程：配置文件里桥接是关的，只有状态文件里是开的。
    const sent = []
    const bridge = createBridge({
      ctx: {},
      settings: settings({ bridgeEnabled: false, bridgeAccessPolicy: 'allowlist' }),
      getCredential: async () => CREDENTIAL,
      createApi: () => ({
        async sendText(userId, text) {
          sent.push({ userId, text })
        },
        async sendTyping() {},
        async getTypingTicket() {
          return 'ticket-1'
        },
      }),
      // 刻意返回一个还没 load() 的 store：模拟启动后第一条消息就到达。
      createStore: () => createBridgeStore({ filePath }),
      createConversationManager: () => ({
        async process() {
          return { text: '重启后也能回', images: [] }
        },
        rotate: () => 'weixin-clawbot-test-r2',
        sessionIdOf: () => 'weixin-clawbot-sid',
        bindingOf: () => 'weixin-clawbot-sid',
        dispose() {},
      }),
    })
    try {
      assert.equal(bridge.status().enabled, false) // 预热前：配置兜底
      await bridge.handleMessage({
        message_type: 1,
        from_user_id: 'user-abcdefghijkl',
        message_id: 'm-restart-1',
        item_list: [{ type: 1, text_item: { text: '重启后还在吗' } }],
      })
      assert.equal(bridge.status().enabled, true)
      assert.equal(bridge.status().received, 1)
      assert.equal(sent.length, 1)
      assert.match(sent[0].text, /重启后也能回/)
    } finally {
      await bridge.dispose()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('斜杠命令：/status 回状态、/new 旋转会话、未知命令回帮助', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.handleMessage(h.message('/status'))
    assert.ok(h.sent.at(-1).text.includes('微信桥接'))
    // 策略固定 allowlist：面板不再提供「任何人」选项。
    assert.ok(h.sent.at(-1).text.includes('策略：allowlist'))

    await h.bridge.handleMessage(h.message('/new'))
    assert.equal(h.calls.rotate, 1)
    assert.ok(h.sent.at(-1).text.includes('已开启新会话'))

    await h.bridge.handleMessage(h.message('/nope'))
    assert.ok(h.sent.at(-1).text.includes('未知命令'))

    await h.bridge.handleMessage(h.message('/cancel'))
    assert.equal(h.calls.cancel, 1)

    assert.equal(h.calls.process.length, 0)
  } finally {
    await h.dispose()
  }
})

test('会话处理抛错时把可读错误回给用户，并计入失败数', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    // 换掉会话管理器，让这一轮必然失败
    const failing = createBridge({
      ctx: { attachments: {} },
      settings: settings({ bridgeAccessPolicy: 'open' }),
      getCredential: async () => CREDENTIAL,
      createApi: () => ({ async sendText(userId, text) { h.sent.push({ userId, text }) }, async sendTyping() {}, async getTypingTicket() { return 't' } }),
      createStore: () => h.store,
      createConversationManager: () => ({
        async process() { throw new Error('模型不可用') },
        async cancel() { return false },
        rotate() { return 'r' },
        sessionIdOf() { return 'x' },
        bindingOf() { return 'x' },
        dispose() {},
      }),
    })
    await failing.handleMessage(h.message('hi'))
    assert.equal(failing.status().failed, 1)
    assert.equal(failing.status().lastError, '模型不可用')
    assert.ok(h.sent.at(-1).text.includes('处理失败'))
    await failing.dispose()
  } finally {
    await h.dispose()
  }
})

test('没有凭据时状态里说明原因，不会抛到调用方', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wc-bridge-'))
  try {
    const bridge = createBridge({
      settings: settings(),
      getCredential: async () => undefined,
      createStore: () => createBridgeStore({ filePath: join(dir, 'state.json') }),
    })
    await bridge.handleMessage({ message_type: 1, from_user_id: 'u1', item_list: [] })
    assert.equal(bridge.status().lastError, '未找到微信凭据，请先连接微信')
    assert.equal(bridge.status().ready, false)
    await bridge.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sendTest 发给最近联系人；没有联系人时报可读错误', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await assert.rejects(() => h.bridge.sendTest(), /还没有收到过微信消息/)
    await h.bridge.handleMessage(h.message('我先说一句'))
    await h.bridge.sendTest('', '测试一下')
    assert.deepEqual(h.sent.at(-1), { userId: 'user-0123456789', text: '测试一下', contextToken: 'ctx-1' })
  } finally {
    await h.dispose()
  }
})

test('/where 用当前会话 id 回答，宿主缺查询服务时退化成「未登记」', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.handleMessage(h.message('/where'))
    const text = h.sent.at(-1).text
    assert.match(text, /当前会话：/)
    assert.match(text, /session_id：weixin-clawbot-user-0123456789/)
    assert.match(text, /（未登记）/)
    assert.equal(h.calls.process.length, 0, '命令不进入 Agent')
  } finally {
    await h.dispose()
  }
})

test('/workspaces 与 /sessions 在没有工作区数据时给可读提示', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.handleMessage(h.message('/workspaces'))
    assert.match(h.sent.at(-1).text, /还没有登记任何工作区/)

    await h.bridge.handleMessage(h.message('/sessions'))
    assert.match(h.sent.at(-1).text, /当前工作区（.+）还没有登记/)

    await h.bridge.handleMessage(h.message('/sessions 7'))
    assert.match(h.sent.at(-1).text, /找不到工作区「7」/)

    await h.bridge.handleMessage(h.message('/ls all'))
    assert.match(h.sent.at(-1).text, /还没有登记任何工作区/)
  } finally {
    await h.dispose()
  }
})

test('斜杠命令：/use 按 /sessions 的序号与 id 前缀切换会话', async () => {
  const home = process.env.HOME
  const records = [
    { header: { id: 'gui-session-aaaa', cwd: home, createdAt: 2 }, live: false, persisted: true },
    { header: { id: 'gui-session-bbbb', cwd: home, createdAt: 1 }, live: false, persisted: true },
  ]
  const h = await harness({ bridgeAccessPolicy: 'open' }, {
    sessionPersistence: {
      async list() {
        return records
      },
      async stat() {
        return undefined
      },
    },
  })
  try {
    await h.bridge.handleMessage(h.message('/sessions'))
    assert.ok(h.sent.at(-1).text.includes('gui-session-aaaa'))

    await h.bridge.handleMessage(h.message('/use 1'))
    assert.deepEqual(h.calls.switchTo, [{ userId: 'user-0123456789', sessionId: 'gui-session-aaaa', cwd: undefined }])
    assert.ok(h.sent.at(-1).text.includes('已切到会话'))

    await h.bridge.handleMessage(h.message('/use gui-session-bbbb'))
    assert.equal(h.calls.switchTo.at(-1).sessionId, 'gui-session-bbbb')
    assert.ok(h.sent.at(-1).text.includes('gui-session-bbbb'))

    await h.bridge.handleMessage(h.message('/use gui-session-'))
    assert.ok(h.sent.at(-1).text.includes('匹配到 2 条'))

    await h.bridge.handleMessage(h.message('/use nope'))
    assert.ok(h.sent.at(-1).text.includes('没找到'))

    await h.bridge.handleMessage(h.message('/use 9'))
    assert.ok(h.sent.at(-1).text.includes('超出范围') || h.sent.at(-1).text.includes('只有'))

    await h.bridge.handleMessage(h.message('/use'))
    assert.ok(h.sent.at(-1).text.includes('用法'))

    assert.equal(h.calls.switchTo.length, 2)
    assert.equal(h.calls.process.length, 0)
  } finally {
    await h.dispose()
  }
})

test('/use 在回答进行中不切会话，先要求 /cancel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wc-bridge-'))
  const sent = []
  const switched = []
  const home = process.env.HOME
  try {
    const bridge = createBridge({
      ctx: {
        sessionPersistence: {
          async list() {
            return [{ header: { id: 'gui-session-busy', cwd: home }, live: true, persisted: true }]
          },
          async stat() {
            return undefined
          },
        },
      },
      settings: settings({ bridgeAccessPolicy: 'open' }),
      getCredential: async () => CREDENTIAL,
      createApi: () => ({
        async sendText(userId, text) {
          sent.push(text)
        },
        async sendTyping() {},
        async getTypingTicket() {
          return 't'
        },
      }),
      createStore: () => createBridgeStore({ filePath: join(dir, 'state.json') }),
      createConversationManager: () => ({
        async process() {
          return { text: 'ok', images: [] }
        },
        isBusy: () => true,
        switchTo(userId, sessionId) {
          switched.push(sessionId)
          return sessionId
        },
        bindingOf: () => undefined,
        sessionIdOf: () => 'weixin-clawbot-busy',
        rotate: () => 'r',
        dispose() {},
      }),
    })
    try {
      await bridge.handleMessage({
        message_type: 1,
        from_user_id: 'user-abcdefghijkl',
        message_id: 'm-busy-1',
        item_list: [{ type: 1, text_item: { text: '/use 1' } }],
      })
      assert.match(sent.at(-1), /还在回答中/)
      assert.deepEqual(switched, [])
    } finally {
      await bridge.dispose()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('还没选会话时：先发欢迎语 + 选择卡，消息挂起不进 Agent', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' }, {}, { bound: undefined })
  try {
    await h.bridge.handleMessage(h.message('帮我看看这个报错'))
    assert.equal(h.calls.process.length, 0)
    const text = h.sent.map((item) => item.text).join('\n')
    assert.match(text, /你好！我是你的 AI 助手/)
    // 没有任何工作区数据时，跳过工作区卡，直接给默认工作区的会话卡
    assert.match(text, /请选择会话（回复序号）/)
    assert.match(text, /1\. 新建一条会话/)
    assert.equal(h.bridge.status().sessionBound, false)
    assert.equal(h.bridge.status().awaitingChoice, true)
    // 欢迎语写进了状态文件：重启后不会再寒暄一遍
    assert.equal(typeof h.store.getGreetedAt('user-0123456789'), 'number')
  } finally {
    await h.dispose()
  }
})

test('先选工作区：卡上只显示目录名，选完才列这个工作区的会话', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' }, {
    workspaceRegistry: {
      list() {
        return [
          { id: 'ws-a', title: '主目录', path: '/tmp/wc-workspace', sessionIds: ['s1'] },
          { id: 'ws-b', title: 'dsh-toolkit', path: '/Users/joeson/Documents/dsh-plugins/dsh-toolkit', sessionIds: [] },
        ]
      },
    },
  }, { bound: undefined })
  try {
    await h.bridge.handleMessage(h.message('在吗'))
    const card = h.sent.at(-1).text
    assert.ok(card.includes('先选工作区（回复序号）'))
    assert.ok(card.includes('wc-workspace（当前）'))
    assert.ok(card.includes('dsh-toolkit'))
    assert.ok(!card.includes('/Users/joeson/Documents'))
    assert.ok(card.includes('3. 不选，用默认工作区（~）'))

    await h.bridge.handleMessage(h.message('2'))
    const sessions = h.sent.at(-1).text
    assert.ok(sessions.includes('请选择会话'))
    assert.ok(sessions.includes('工作区：dsh-toolkit'))
    assert.ok(sessions.includes('1. 新建一条会话'))
    // 还没真正选会话，所以不补跑
    assert.equal(h.calls.process.length, 0)
    assert.equal(h.calls.switchTo.length, 0)
  } finally {
    await h.dispose()
  }
})

test('会话卡选 1：在选中的工作区新建，并补跑挂起的问题', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' }, {
    workspaceRegistry: {
      list() {
        return [
          { id: 'ws-a', title: '主目录', path: '/tmp/wc-workspace', sessionIds: [] },
          { id: 'ws-b', title: 'dsh-toolkit', path: '/Users/joeson/Documents/dsh-plugins/dsh-toolkit', sessionIds: [] },
        ]
      },
    },
  }, { bound: undefined })
  try {
    await h.bridge.handleMessage(h.message('写个脚本'))
    await h.bridge.handleMessage(h.message('2'))
    await h.bridge.handleMessage(h.message('1'))
    assert.equal(h.calls.rotate, 1)
    assert.equal(h.calls.rotateWorkspace, '/Users/joeson/Documents/dsh-plugins/dsh-toolkit')
    assert.equal(h.calls.process.length, 1)
    assert.ok(h.sent.some((item) => item.text.includes('已新建会话')))
    assert.ok(h.sent.some((item) => item.text.includes('接着回你刚才那条')))
  } finally {
    await h.dispose()
  }
})

test('会话卡选 2：切到列表里那条会话，并把挂着的问题补跑掉', async () => {
  const records = [
    { header: { id: 'gui-session-aaaa', cwd: '/tmp/wc-workspace', createdAt: 2 }, live: false, persisted: true },
    { header: { id: 'gui-session-bbbb', cwd: '/tmp/wc-workspace', createdAt: 1 }, live: false, persisted: true },
  ]
  const h = await harness({ bridgeAccessPolicy: 'open' }, {
    sessionPersistence: {
      async list() {
        return records
      },
      async stat() {
        return undefined
      },
    },
  }, { bound: undefined })
  try {
    await h.bridge.handleMessage(h.message('帮我看一下构建日志'))
    assert.equal(h.calls.process.length, 0)

    // 有历史会话但没登记工作区 → 先给由会话 cwd 派生的工作区卡，选 1 才进会话卡
    await h.bridge.handleMessage(h.message('1'))
    assert.ok(h.sent.at(-1).text.includes('请选择会话'))

    await h.bridge.handleMessage(h.message('2'))
    assert.deepEqual(h.calls.switchTo, [
      { userId: 'user-0123456789', sessionId: 'gui-session-aaaa', cwd: '/tmp/wc-workspace' },
    ])
    // 选完立刻补跑刚才挂起的那条，而不是让它石沉大海
    assert.equal(h.calls.process.length, 1)
    const texts = h.sent.map((item) => item.text)
    assert.ok(texts.some((text) => text.includes('已切到')))
    assert.ok(texts.some((text) => text.includes('接着回你刚才那条')))
    assert.ok(texts.some((text) => text.includes('好的，已处理。')))
    assert.equal(h.bridge.status().sessionBound, true)
  } finally {
    await h.dispose()
  }
})

test('工作区卡最后一项：不选，用默认工作区', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' }, {
    workspaceRegistry: {
      list() {
        return [
          { id: 'ws-a', title: '主目录', path: '/tmp/wc-workspace', sessionIds: [] },
          { id: 'ws-b', title: 'dsh-toolkit', path: '/Users/joeson/Documents/dsh-plugins/dsh-toolkit', sessionIds: [] },
        ]
      },
    },
  }, { bound: undefined })
  try {
    await h.bridge.handleMessage(h.message('在吗'))
    await h.bridge.handleMessage(h.message('3'))
    assert.ok(h.sent.at(-1).text.includes('请选择会话'))
    // 「不选」用的是桥的默认工作区（$HOME），卡上显示成 ~
    assert.ok(h.sent.at(-1).text.includes('工作区：~'))
  } finally {
    await h.dispose()
  }
})

test('基础命令不被选择门禁拦住', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' }, {}, { bound: undefined })
  try {
    await h.bridge.handleMessage(h.message('/help'))
    assert.ok(h.sent.at(-1).text.includes('可用命令：'))
    assert.ok(!h.sent.at(-1).text.includes('请选择会话'))

    await h.bridge.handleMessage(h.message('/start'))
    assert.ok(h.sent.at(-1).text.includes('请选择会话'))
  } finally {
    await h.dispose()
  }
})

test('刚打过招呼的用户再触发选择时不重复发欢迎语', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' }, {}, { bound: undefined })
  try {
    h.store.setGreetedAt('user-0123456789', Date.now() - 60_000)
    await h.bridge.handleMessage(h.message('/start'))
    const text = h.sent.at(-1).text
    assert.ok(text.includes('请选择会话'))
    assert.ok(!text.includes('你好！我是你的 AI 助手'))
  } finally {
    await h.dispose()
  }
})

test('已绑定会话后，普通数字照常当消息发给 Agent', async () => {
  const h = await harness({ bridgeAccessPolicy: 'open' })
  try {
    await h.bridge.handleMessage(h.message('2'))
    assert.equal(h.calls.process.length, 1)
    assert.ok(h.calls.process[0].content[0].text.includes('2'))
  } finally {
    await h.dispose()
  }
})
