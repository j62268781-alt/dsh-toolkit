/**
 * 桥接状态、入站转换与会话映射的测试：全部离线，不碰网络。
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { INSTRUCTIONS_SOURCE, collectReply, createConversations, eventCount, eventsSince, sessionIdFor, sessionTitleFor } from '../../src/modules/weixin-clawbot/host/conversation.js'
import { INBOX_DIR, buildInboundContent, messageKey, safeFileName } from '../../src/modules/weixin-clawbot/host/inbound.js'
import { bridgeStatePath, createBridgeStore } from '../../src/modules/weixin-clawbot/host/store.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wc-test-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('bridgeStatePath 按 accountId 派生稳定文件路径', () => {
  const first = bridgeStatePath('ilink-bot-account-0123456789', { homeDir: join(tmpdir(), 'home') })
  const second = bridgeStatePath('ilink-bot-account-0123456789', { homeDir: join(tmpdir(), 'home') })
  const other = bridgeStatePath('ilink-bot-account-9999', { homeDir: join(tmpdir(), 'home') })
  assert.equal(first, second)
  assert.notEqual(first, other)
  // 用 join 拼期望值：Windows 上分隔符是 \，硬编码 '/' 会误判成回归。
  assert.ok(first.startsWith(join(tmpdir(), 'home', 'weixin-clawbot')))
  assert.ok(first.endsWith('.json'))
  assert.ok(!first.includes('ilink-bot-account'))
})

test('桥状态：游标/context_token/去重表/开关/策略/白名单都能落盘并读回', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'weixin-clawbot', 'state.json')
    const store = createBridgeStore({ filePath })
    await store.load()
    assert.equal(store.getCursor(), '')
    assert.equal(store.getEnabled(), undefined)

    store.setCursor('cursor-abc')
    store.setContextToken('user-1', 'ctx-1')
    store.markSeen('id:m1')
    store.markSeen('id:m1')
    store.setEnabled(false)
    store.setPolicy('open')
    store.setAllowFrom([' user-1 ', 'user-1', '', 'user-2'])
    assert.deepEqual(store.getAllowFrom(), ['user-1', 'user-2'])
    store.setGeneration('user-1', 3)
    assert.equal(store.getGeneration('user-1'), 3)
    await store.flush()

    const raw = JSON.parse(await readFile(filePath, 'utf8'))
    assert.equal(raw.cursor, 'cursor-abc')
    assert.deepEqual(raw.contexts, { 'user-1': 'ctx-1' })
    assert.deepEqual(raw.seen, ['id:m1'])
    assert.equal(raw.enabled, false)
    assert.equal(raw.policy, 'open')
    assert.deepEqual(raw.allowFrom, ['user-1', 'user-2'])
    assert.deepEqual(raw.generations, { 'user-1': 3 })

    const reopened = createBridgeStore({ filePath })
    await reopened.load()
    assert.equal(reopened.getCursor(), 'cursor-abc')
    assert.equal(reopened.getContextToken('user-1'), 'ctx-1')
    assert.equal(reopened.hasSeen('id:m1'), true)
    assert.equal(reopened.hasSeen('id:m2'), false)
    assert.equal(reopened.getEnabled(), false)
    assert.equal(reopened.getPolicy(), 'open')
    assert.deepEqual(reopened.getAllowFrom(), ['user-1', 'user-2'])
    assert.equal(reopened.getGeneration('user-1'), 3)
    assert.equal(reopened.getGeneration('nobody'), undefined)
    assert.deepEqual(reopened.summary(), { cursor: 'saved', contexts: 1, generations: 1, bindings: 0, greeted: 0, seen: 1, updatedAt: raw.updatedAt })
  })
})

test('桥状态：坏文件回退成空状态，不会让模块起不来', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'broken.json')
    await writeFile(filePath, '{ this is not json')
    const store = createBridgeStore({ filePath })
    await store.load()
    assert.equal(store.getCursor(), '')
    assert.deepEqual(store.getAllowFrom(), [])
    assert.equal(store.summary().cursor, 'empty')
  })
})

test('入站：文本消息带发送者前缀，正文原样保留', async () => {
  const { content, text } = await buildInboundContent({
    message: {
      message_id: 'm-1',
      from_user_id: 'user-0123456789',
      item_list: [{ type: 1, text_item: { text: '帮我看下这个报错' } }],
    },
  })
  assert.equal(content.length, 1)
  assert.equal(content[0].type, 'text')
  assert.ok(text.startsWith('[来自微信的私聊消息'))
  assert.ok(text.includes('use…789'))
  assert.ok(text.includes('帮我看下这个报错'))
})

test('入站：语音用微信转写，视频与未知类型给出说明', async () => {
  const voice = await buildInboundContent({
    message: { from_user_id: 'user-1', item_list: [{ type: 3, voice_item: { text: '今天天气如何' } }] },
  })
  assert.ok(voice.text.includes('[语音转写]'))
  assert.ok(voice.text.includes('今天天气如何'))

  const empty = await buildInboundContent({
    message: { from_user_id: 'user-1', item_list: [{ type: 3, voice_item: {} }] },
  })
  assert.ok(empty.text.includes('没有提供转写'))

  const video = await buildInboundContent({
    message: { from_user_id: 'user-1', item_list: [{ type: 5, video_item: {} }] },
  })
  assert.ok(video.text.includes('视频'))
})

test('入站：引用消息以 > 前缀折叠，并限制递归深度', async () => {
  const { text } = await buildInboundContent({
    message: {
      from_user_id: 'user-1',
      item_list: [{ type: 1, text_item: { text: '这条怎么改？' } }],
      ref_msg: {
        title: '上一轮的回复',
        message_item: [{ type: 1, text_item: { text: '原话' } }],
      },
    },
  })
  assert.ok(text.includes('[引用的消息]'))
  assert.ok(text.includes('标题：上一轮的回复'))
  assert.ok(text.includes('> 原话'))
})

test('入站：图片走 attachments.saveImage，拿到的是图片块而不是 URL', async () => {
  const saved = []
  const { content, text } = await buildInboundContent({
    message: { from_user_id: 'user-1', item_list: [{ type: 2, image_item: { media: {} } }] },
    api: { async downloadImage() { return PNG } },
    attachments: {
      imageLimits: { maxImagesPerMessage: 4, maxMessageImageBytes: 1_000_000 },
      async saveImage(input) {
        saved.push(input)
        return { mediaType: input.mediaType, attachmentId: 'att-1' }
      },
    },
  })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.deepEqual(content.filter((block) => block.type === 'image'), [
    { type: 'image', attachment: { mediaType: 'image/png', attachmentId: 'att-1' } },
  ])
  assert.ok(!text.includes('http'))
})

test('入站：文件落盘到工作区收件箱，正文标注为不可信输入', async () => {
  await withTempDir(async (dir) => {
    const { text } = await buildInboundContent({
      message: { from_user_id: 'user-1', item_list: [{ type: 4, file_item: { file_name: '../../报告.pdf', len: '5' } }] },
      api: { async downloadFile() { return Buffer.from('hello') } },
      workspaceCwd: dir,
    })
    assert.ok(text.includes('报告.pdf'))
    assert.ok(text.includes('不可信输入'))
    const inbox = join(dir, INBOX_DIR)
    const { readdir } = await import('node:fs/promises')
    const [messageDir] = await readdir(inbox)
    assert.ok(messageDir.startsWith('message-'))
    assert.deepEqual(await readdir(join(inbox, messageDir)), ['报告.pdf'])
    assert.equal(await readFile(join(inbox, messageDir, '报告.pdf'), 'utf8'), 'hello')
  })
})

test('去重键与文件名净化', () => {
  assert.equal(messageKey({ message_id: ' abc ' }), 'id:abc')
  assert.equal(messageKey({ seq: 7, create_time_ms: 1000, from_user_id: 'u1' }), 'seq:7:1000:u1')
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName(''), 'file-1')
  assert.equal(safeFileName(undefined, 2), 'file-3')
})

test('会话 id 跨重启稳定，多代有后缀；标题只留尾号', () => {
  const first = sessionIdFor('account-1', 'user-1')
  assert.equal(first, sessionIdFor('account-1', 'user-1'))
  assert.notEqual(first, sessionIdFor('account-1', 'user-2'))
  assert.notEqual(first, sessionIdFor('account-2', 'user-1'))
  assert.equal(sessionIdFor('account-1', 'user-1', 2), `${first}-r2`)
  assert.equal(sessionTitleFor('user-0123456789'), '微信 · …6789')
})

test('collectReply：拼接文本、收集图片、跳过带工具调用的消息、记录错误 turn', () => {
  const events = [
    { type: 'turn/start', data: {} },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '第一段' }] } },
    },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'tool-call', name: 'bash' }] } },
    },
    {
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'text', text: '最终回复' },
            { type: 'image', attachment: { attachmentId: 'att-1' } },
          ],
        },
      },
    },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: '模型返回 500', code: 'HTTP_500' } } } },
  ]
  const reply = collectReply(events)
  assert.equal(reply.text, '第一段\n\n最终回复')
  assert.deepEqual(reply.images, [{ attachmentId: 'att-1' }])
  assert.equal(reply.sawError, true)
  assert.equal(reply.errorText, '模型返回 500')
})

test('agent 事件日志：新版用 session.seq + snapshotEvents，旧版回落到 events 数组', () => {
  const stored = [{ type: 'turn/start', data: {} }, { type: 'turn/end', data: {} }]
  const modern = {
    session: {
      seq: 5,
      snapshotEvents(from) {
        return stored.slice(from)
      },
    },
  }
  assert.equal(eventCount(modern), 5)
  assert.deepEqual(eventsSince(modern, 1), stored.slice(1))

  const legacy = { session: { events: stored } }
  assert.equal(eventCount(legacy), 2)
  assert.deepEqual(eventsSince(legacy, 1), stored.slice(1))

  // session 上没有可读的日志时不能抛错（曾经的线上崩溃点）
  assert.equal(eventCount({ session: {} }), 0)
  assert.deepEqual(eventsSince({ session: {} }, 0), [])
})

test('collectReply：正常结束（reason.kind=completed）不算错误', () => {
  const reply = collectReply([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好了' }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  assert.equal(reply.text, '好了')
  assert.equal(reply.sawError, false)
  assert.equal(reply.errorText, undefined)
})

test('身份提示用 producer-owned source，不能是已退休的 kind:plugin', () => {
  // 会话格式 v4 写入端会拒绝 { kind: 'plugin' }（线上表现为「处理失败：format v4 message requires a producer-owned source kind」）
  assert.notEqual(INSTRUCTIONS_SOURCE.kind, 'plugin')
  assert.match(INSTRUCTIONS_SOURCE.kind, /^plugin:[a-z0-9-]+$/)
  assert.equal(INSTRUCTIONS_SOURCE.form, 'instructions')
})

test('会话代号落盘：/new 之后重启仍停在新会话，不会跳回旧会话', async () => {
  const saved = new Map()
  const generations = {
    get: (userId) => saved.get(userId),
    set: (userId, generation) => saved.set(userId, generation),
  }
  const ctx = { agents: { get: () => undefined } }
  const conversations = createConversations({ ctx, settings: { accountId: 'acc-1' }, generations })

  const rotated = conversations.rotate('user-1')
  assert.equal(rotated, sessionIdFor('acc-1', 'user-1', 2))
  assert.equal(saved.get('user-1'), 2)

  // 模拟重启：新的会话管理器从同一份落盘状态恢复，再 /new 应到第 3 代
  const restarted = createConversations({ ctx, settings: { accountId: 'acc-1' }, generations })
  assert.equal(restarted.rotate('user-1'), sessionIdFor('acc-1', 'user-1', 3))
  assert.equal(saved.get('user-1'), 3)
  conversations.dispose?.()
  restarted.dispose?.()
})

test('桥状态：/use 选的会话绑定能落盘并读回', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'weixin-clawbot', 'state.json')
    const store = createBridgeStore({ filePath })
    await store.load()
    assert.equal(store.getBinding('user-1'), undefined)

    store.setBinding('user-1', ' gui-session-1 ')
    store.setBinding('user-1', '') // 空值不覆盖已有绑定
    assert.equal(store.getBinding('user-1'), 'gui-session-1')
    await store.flush()

    const raw = JSON.parse(await readFile(filePath, 'utf8'))
    assert.deepEqual(raw.bindings, { 'user-1': 'gui-session-1' })
    assert.equal(store.summary().bindings, 1)

    const reloaded = createBridgeStore({ filePath })
    await reloaded.load()
    assert.equal(reloaded.getBinding('user-1'), 'gui-session-1')
    reloaded.clearBinding('user-1')
    assert.equal(reloaded.getBinding('user-1'), undefined)
    await reloaded.flush()
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')).bindings, {})
  })
})

/** 假宿主：够 runTurn 跑完一轮的最小集合，并记录 create/resume/dispose。 */
function fakeRuntime() {
  const created = []
  const disposed = []
  const live = new Map()
  const persisted = new Map()
  function makeAgent(sessionId) {
    return {
      session: {
        id: sessionId,
        seq: 0,
        snapshotEvents: () => [
          { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `回 ${sessionId}` }] } } },
          { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ],
      },
      status: 'idle',
      async whenIdle() {},
      followup() {},
      cancel() {},
      inject() {},
    }
  }
  const ctx = {
    agents: {
      get: (id) => live.get(id),
      async create({ sessionId }) {
        created.push(sessionId)
        return { agent: makeAgent(sessionId), dispose() { disposed.push(sessionId) } }
      },
      async resume({ resumeSessionId }) {
        created.push(resumeSessionId)
        return { agent: makeAgent(resumeSessionId), dispose() { disposed.push(resumeSessionId) } }
      },
    },
    agentDefaultModel: { currentSelection: () => ({ model: 'test' }) },
    agentPresets: {
      async resolve() { return { id: 'standard' } },
      async mount() {},
      async acquireScope() { return undefined },
    },
    sessionPersistence: {
      async stat(id) { return persisted.get(id) },
      async list() { return [] },
    },
    sessionTitle: { rename() {} },
    permissionPresets: { async resolve() { return { id: 'workspace-write' } }, set() {} },
  }
  return { ctx, created, disposed, live, persisted, makeAgent }
}

test('切换会话：绑定落盘、自己建的 agent 切走时释放、接管的绝不 dispose', async () => {
  const runtime = fakeRuntime()
  const saved = new Map()
  const bindings = {
    get: (userId) => saved.get(userId),
    set: (userId, sessionId) => saved.set(userId, sessionId),
    clear: (userId) => saved.delete(userId),
  }
  const conversations = createConversations({ ctx: runtime.ctx, settings: { accountId: 'acc-1' }, bindings })
  try {
    const derived = sessionIdFor('acc-1', 'user-1')
    const first = await conversations.process('user-1', [{ type: 'text', text: 'hi' }])
    assert.equal(first.sessionId, derived)
    assert.deepEqual(runtime.created, [derived])
    assert.equal(conversations.bindingOf('user-1'), undefined)

    // /use 切到 GUI 里正开着的一条：接管，不重建
    runtime.live.set('gui-session-live', runtime.makeAgent('gui-session-live'))
    conversations.switchTo('user-1', 'gui-session-live')
    assert.equal(conversations.sessionIdOf('user-1'), 'gui-session-live')
    assert.equal(conversations.bindingOf('user-1'), 'gui-session-live')
    assert.equal(saved.get('user-1'), 'gui-session-live')
    assert.deepEqual(runtime.disposed, [derived], '切走时释放我们自己建的会话')

    const second = await conversations.process('user-1', [{ type: 'text', text: 'hi' }])
    assert.match(second.text, /回 gui-session-live/)
    assert.deepEqual(runtime.created, [derived], '接管已有会话不会重新创建')

    // 再切走：接管的这条不能被 dispose（GUI 还在用）
    conversations.switchTo('user-1', 'weixin-clawbot-bound-other')
    assert.deepEqual(runtime.disposed, [derived])

    // 模拟重启：绑定还在，第一条消息就落在绑定会话上
    const restarted = createConversations({ ctx: runtime.ctx, settings: { accountId: 'acc-1' }, bindings })
    assert.equal(restarted.sessionIdOf('user-1'), 'weixin-clawbot-bound-other')
    restarted.dispose()
  } finally {
    conversations.dispose()
  }
})

test('/new 把绑定换到新会话（不然下一条消息会被选择门禁拦下）', async () => {
  const saved = new Map([['user-1', 'gui-session-old']])
  const bindings = {
    get: (userId) => saved.get(userId),
    set: (userId, sessionId) => saved.set(userId, sessionId),
    clear: (userId) => saved.delete(userId),
  }
  const generations = { get: () => undefined, set: () => {} }
  const conversations = createConversations({ ctx: fakeRuntime().ctx, settings: { accountId: 'acc-1' }, bindings, generations })
  try {
    assert.equal(conversations.sessionIdOf('user-1'), 'gui-session-old')
    const created = conversations.rotate('user-1')
    assert.equal(created, sessionIdFor('acc-1', 'user-1', 2))
    assert.equal(conversations.bindingOf('user-1'), created)
    assert.equal(saved.get('user-1'), created)
    assert.equal(conversations.sourceOf('user-1'), 'created')
  } finally {
    conversations.dispose()
  }
})

test('欢迎语时间戳落盘：重启后不会重新打招呼，隔一天才会', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wc-store-'))
  const filePath = join(dir, 'state.json')
  try {
    const before = createBridgeStore({ filePath })
    await before.load()
    assert.equal(before.getGreetedAt('user-1'), undefined)
    before.setGreetedAt('user-1', 1_700_000_000_000)
    before.setGreetedAt('user-bad', Number.NaN)
    await before.flush()

    const after = createBridgeStore({ filePath })
    await after.load()
    assert.equal(after.getGreetedAt('user-1'), 1_700_000_000_000)
    assert.equal(after.getGreetedAt('user-bad'), undefined)
    assert.equal(after.summary().greeted, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('绑定的会话被删掉：明确报 SESSION_MISSING，而不是悄悄新建一条同 id 的空会话', async () => {
  const runtime = fakeRuntime()
  const saved = new Map([['user-1', 'gui-session-gone']])
  const bindings = {
    get: (userId) => saved.get(userId),
    set: (userId, sessionId) => saved.set(userId, sessionId),
    clear: (userId) => saved.delete(userId),
  }
  const conversations = createConversations({ ctx: runtime.ctx, settings: { accountId: 'acc-1' }, bindings })
  try {
    // gui-session-gone 既不在 live 里，也没有历史 → 选中的会话已经不在了
    await assert.rejects(
      () => conversations.process('user-1', [{ type: 'text', text: '在吗' }]),
      (error) => error.code === 'SESSION_MISSING' && error.sessionId === 'gui-session-gone',
    )
    assert.deepEqual(runtime.created, [])
    conversations.unbind('user-1')
    assert.equal(conversations.bindingOf('user-1'), undefined)
  } finally {
    conversations.dispose()
  }
})

test('/new 新建的会话即使还没落盘也不会被当成「丢失」，rotate 还记住选过的工作区', async () => {
  const runtime = fakeRuntime()
  const saved = new Map()
  const bindings = {
    get: (userId) => saved.get(userId),
    set: (userId, sessionId) => saved.set(userId, sessionId),
    clear: (userId) => saved.delete(userId),
  }
  const generations = { get: () => undefined, set: () => {} }
  const conversations = createConversations({ ctx: runtime.ctx, settings: { accountId: 'acc-1' }, bindings, generations })
  try {
    const created = conversations.rotate('user-1', '/Users/joeson/Documents/dsh-plugins/dsh-toolkit')
    assert.equal(conversations.workspaceOf('user-1'), '/Users/joeson/Documents/dsh-plugins/dsh-toolkit')
    // 新会话没有历史（stat 返回 undefined，runtime.persisted 是空的）→ 应该直接创建
    await conversations.process('user-1', [{ type: 'text', text: '第一条' }])
    assert.deepEqual(runtime.created, [created])
    // 切换别的会话时，这次选择的工作区要带过去（新建下一轮还在这里）
    runtime.persisted.set('gui-session-2', { header: { id: 'gui-session-2', agentPreset: 'standard' } })
    conversations.switchTo('user-1', 'gui-session-2', '/Users/joeson')
    assert.equal(conversations.workspaceOf('user-1'), '/Users/joeson')
    assert.equal(conversations.sourceOf('user-1'), 'picked')
  } finally {
    conversations.dispose()
  }
})
