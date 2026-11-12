/**
 * 选择器测试：卡片文案、序号解析、先工作区后会话、新建/切换，以及待选状态的时效。
 *
 * 这里只碰 picker.js + inspect.js 的只读服务，用假 ctx 造数据。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BACK_TO_WORKSPACES,
  NEW_SESSION_OPTION,
  SESSION_LIST_LIMIT,
  WELCOME_TEXT,
  createPicker,
  parseChoice,
  sessionCardText,
  workspaceCardText,
  workspaceLabel,
} from '../../src/modules/remote/host/picker.js'

const HOME = '/Users/joeson'
const WORKSPACE_A = '/Users/joeson'
const WORKSPACE_B = '/Users/joeson/Documents/dsh-plugins/dsh-toolkit'
const WORKSPACE_C = '/Users/joeson/Documents/dsh-plugins'

function records(count, cwd = WORKSPACE_B, prefix = 'session') {
  return Array.from({ length: count }, (_, index) => ({
    header: { id: `${prefix}-${index + 1}`, cwd, createdAt: 1_000 + index },
    live: false,
    persisted: true,
  }))
}

function fakeCtx({ sessions = records(3), workspaces } = {}) {
  return {
    sessionQuery: {
      async listSessions() {
        return sessions
      },
      async readTitleSnapshots(ids) {
        return ids.map((sessionId) => ({
          sessionId,
          status: 'fulfilled',
          value: { session: { id: sessionId }, title: { title: `标题 ${sessionId}` } },
        }))
      },
    },
    workspaceRegistry: {
      list() {
        return workspaces ?? [
          { id: 'ws-a', title: '主目录', path: WORKSPACE_A, sessionIds: ['a'] },
          { id: 'ws-b', title: 'dsh-toolkit', path: WORKSPACE_B, sessionIds: ['b', 'c'] },
          { id: 'ws-c', title: 'dsh-plugins', path: WORKSPACE_C, sessionIds: [] },
        ]
      },
    },
  }
}

function fakeConversations() {
  const calls = { rotate: [], switchTo: [] }
  return {
    calls,
    rotate(userId, cwd) {
      calls.rotate.push({ userId, cwd })
      return 'remote-new-r2'
    },
    switchTo(userId, sessionId, cwd) {
      calls.switchTo.push({ userId, sessionId, cwd })
      return sessionId
    },
  }
}

function pickerWith(options = {}) {
  const conversations = fakeConversations()
  const picker = createPicker({
    ctx: options.ctx ?? fakeCtx(),
    conversations,
    workspaceCwd: options.workspaceCwd ?? WORKSPACE_B,
    home: HOME,
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  })
  return { picker, conversations }
}

test('workspaceLabel：工作区只显示最后一段目录名，家目录显示成 ~', () => {
  assert.equal(workspaceLabel(HOME, HOME), '~')
  assert.equal(workspaceLabel(WORKSPACE_B, HOME), 'dsh-toolkit')
  assert.equal(workspaceLabel(WORKSPACE_C, HOME), 'dsh-plugins')
  assert.equal(workspaceLabel('/Users/joeson/Documents/dsh-plugins/dsh-toolkit/', HOME), 'dsh-toolkit')
  assert.equal(workspaceLabel('', HOME), '默认工作区')
})

test('工作区卡：只列目录名，标注当前，最后一项是「不选，用默认工作区」', () => {
  const text = workspaceCardText({
    workspaces: [
      { path: WORKSPACE_A, sessionIds: ['a'] },
      { path: WORKSPACE_B, sessionIds: ['b', 'c'] },
      { path: WORKSPACE_C, sessionIds: [] },
    ],
    currentPath: WORKSPACE_B,
    defaultPath: WORKSPACE_A,
    home: HOME,
  })
  assert.ok(text.startsWith('先选工作区（回复序号）'))
  assert.ok(text.includes('1. ~\n'))
  assert.ok(text.includes('2. dsh-toolkit（当前）'))
  assert.ok(text.includes('3. dsh-plugins'))
  assert.ok(text.includes('4. 不选，用默认工作区（~）'))
  // 卡片要短：不出现完整路径，也不出现会话 id
  assert.ok(!text.includes('/Users/joeson/Documents'))
  assert.ok(!text.includes('session-'))
})

test('会话卡：第 1 项是新建，后面只列标题、不列 session_id，最后 0 换工作区', () => {
  const text = sessionCardText({
    workspacePath: WORKSPACE_B,
    sessions: [
      { id: 'gui-aaa111-bbb-ccc', title: '修一下登录跳转' },
      { id: 'gui-bbb222-ddd-eee', title: null },
    ],
    total: 2,
    home: HOME,
  })
  assert.ok(text.includes('请选择会话（回复序号）'))
  assert.ok(text.includes('工作区：dsh-toolkit'))
  assert.ok(text.includes('1. 新建一条会话'))
  assert.ok(text.includes('2. 修一下登录跳转'))
  assert.ok(text.includes('3. （未命名）'))
  assert.ok(text.includes('0. 换个工作区'))
  assert.ok(!text.includes('gui-aaa111'))
  assert.ok(!text.includes('/Users/joeson'))
})

test('会话卡：工作区里一条会话都没有时也有可读提示', () => {
  const text = sessionCardText({ workspacePath: WORKSPACE_C, sessions: [], total: 0, home: HOME })
  assert.ok(text.includes('（这个工作区还没有会话，回复 1 直接新建）'))
  assert.ok(text.includes('1. 新建一条会话'))
})

test('会话卡：工作区里的会话超过上限时只列最近 100 条，卡尾说明总数', async () => {
  // total 来自真实条数、sessions 来自 limit 之后的结果，两者对不上时必须给出说明，
  // 否则用户会以为「回复 137 就能直接选」到那条排在列表外的会话。
  const { picker } = pickerWith({ ctx: fakeCtx({ sessions: records(137) }) })
  await picker.showWorkspaces('user-1')
  const card = (await picker.choose('user-1', 2)).texts[0] // 2 = dsh-toolkit

  assert.ok(card.includes('共 137 条，这里列了最近 100 条，用 /sessions 看剩下的。'))
  // 1 = 新建、2..101 = 会话、0 = 换工作区，一共 102 个带序号的选项。
  const numbered = card.split('\n').filter((line) => /^\d+\. /.test(line))
  assert.equal(numbered.length, 102)
  assert.ok(numbered[0].startsWith(`${NEW_SESSION_OPTION}. 新建一条会话`))
  assert.ok(numbered.at(-1).startsWith(`${BACK_TO_WORKSPACES}. 换个工作区`))
  assert.equal(SESSION_LIST_LIMIT, 100)

  // 越界提示要按「上限后的条数 + 1」算，不能报 137。
  const out = await picker.choose('user-1', 102)
  assert.ok(out.texts[0].includes('没有「102」这个选项：回复 1-101 选会话，0 换工作区。'))
})

test('parseChoice：只有纯数字算选项', () => {
  assert.equal(parseChoice('2'), 2)
  assert.equal(parseChoice(' 09 '), 9)
  assert.equal(parseChoice('0'), 0)
  assert.equal(parseChoice('帮我写个脚本'), undefined)
  assert.equal(parseChoice('1.5'), undefined)
  assert.equal(parseChoice('-1'), undefined)
  assert.equal(parseChoice(''), undefined)
  assert.equal(parseChoice(undefined), undefined)
})

test('入口先给工作区卡：选序号后给出该工作区的会话卡', async () => {
  const { picker } = pickerWith()
  const card = await picker.showWorkspaces('user-1')
  assert.ok(card.includes('先选工作区'))
  assert.equal(picker.isAwaiting('user-1'), true)

  const sessions = await picker.choose('user-1', 2) // 2 = dsh-toolkit
  assert.ok(sessions.texts[0].includes('请选择会话'))
  assert.ok(sessions.texts[0].includes('工作区：dsh-toolkit'))
  assert.equal(sessions.bound, undefined)
  assert.equal(picker.isAwaiting('user-1'), true)
})

test('会话卡选 1：在选中的工作区新建，并带上工作区', async () => {
  const { picker, conversations } = pickerWith()
  await picker.showWorkspaces('user-1')
  await picker.choose('user-1', 2)

  const result = await picker.choose('user-1', NEW_SESSION_OPTION)
  assert.deepEqual(conversations.calls.rotate, [{ userId: 'user-1', cwd: WORKSPACE_B }])
  assert.deepEqual(result.bound, { sessionId: 'remote-new-r2', workspacePath: WORKSPACE_B })
  assert.ok(result.texts[0].includes('已新建会话'))
  assert.ok(result.texts[0].includes('dsh-toolkit'))
})

test('会话卡选 2：切到第一条已有会话并带上工作区', async () => {
  const { picker, conversations } = pickerWith()
  await picker.showWorkspaces('user-1')
  await picker.choose('user-1', 2)

  const result = await picker.choose('user-1', 2)
  assert.deepEqual(conversations.calls.switchTo, [{ userId: 'user-1', sessionId: 'session-1', cwd: WORKSPACE_B }])
  assert.ok(result.texts[0].includes('已切到「标题 session-1」'))
  assert.deepEqual(result.bound, { sessionId: 'session-1', workspacePath: WORKSPACE_B })
})

test('工作区卡最后一项：不选，用默认工作区的会话卡', async () => {
  const { picker } = pickerWith({ workspaceCwd: WORKSPACE_A })
  await picker.showWorkspaces('user-1')
  const result = await picker.choose('user-1', 4) // 3 个工作区 + 1
  assert.ok(result.texts[0].includes('请选择会话'))
  assert.ok(result.texts[0].includes('工作区：~'))
})

test('会话卡 0：回到工作区卡', async () => {
  const { picker } = pickerWith()
  await picker.showWorkspaces('user-1')
  await picker.choose('user-1', 2)
  const back = await picker.choose('user-1', BACK_TO_WORKSPACES)
  assert.ok(back.texts[0].includes('先选工作区'))
})

test('越界序号给出明确范围，不会静默换会话', async () => {
  const { picker, conversations } = pickerWith()
  await picker.showWorkspaces('user-1')
  const bad = await picker.choose('user-1', 9)
  assert.ok(bad.texts[0].includes('没有「9」这个选项'))
  assert.ok(bad.texts[0].includes('1-4'))
  assert.equal(conversations.calls.switchTo.length, 0)
  // 越界不算选择，卡还在
  assert.equal(picker.isAwaiting('user-1'), true)

  await picker.choose('user-1', 2)
  const bad2 = await picker.choose('user-1', 8)
  assert.ok(bad2.texts[0].includes('没有「8」这个选项'))
  assert.equal(conversations.calls.switchTo.length, 0)
})

test('没有待选状态时，数字按普通消息处理（选择器返回 undefined）', async () => {
  const { picker } = pickerWith()
  assert.equal(await picker.choose('user-1', 2), undefined)
})

test('待选状态有 10 分钟时效，过期后数字回到普通消息', async () => {
  const { picker } = pickerWith({ ttlMs: 1 })
  await picker.showWorkspaces('user-1')
  await new Promise((resolve) => setTimeout(resolve, 8))
  assert.equal(picker.isAwaiting('user-1'), false)
  assert.equal(await picker.choose('user-1', 1), undefined)
})

test('挂起的问题一次性消费，过期的补跑会被丢弃', async () => {
  const { picker } = pickerWith({ ttlMs: 1 })
  picker.suspend('user-1', { message_id: 'm1' })
  assert.deepEqual(picker.takePending('user-1'), { message_id: 'm1' })
  assert.equal(picker.takePending('user-1'), undefined)

  picker.suspend('user-1', { message_id: 'm2' })
  await new Promise((resolve) => setTimeout(resolve, 8))
  assert.equal(picker.takePending('user-1'), undefined)
})

test('会话卡把该工作区的会话全列出来（不是只列 5 条）', async () => {
  const { picker } = pickerWith({ ctx: fakeCtx({ sessions: records(12) }) })
  await picker.showWorkspaces('user-1')
  const card = await picker.choose('user-1', 2)
  assert.ok(SESSION_LIST_LIMIT >= 12)
  assert.ok(card.texts[0].includes('12. '))
  assert.ok(card.texts[0].includes('13. 标题 session-12'))
  assert.ok(!card.texts[0].includes('共 12 条'))
})

test('一个工作区都没登记时，直接给默认工作区的会话卡', async () => {
  const { picker } = pickerWith({ ctx: fakeCtx({ workspaces: [] }) })
  const card = await picker.showWorkspaces('user-1')
  assert.ok(card.includes('请选择会话'))
  assert.ok(card.includes('工作区：dsh-toolkit'))
})

test('欢迎语是给「第一次接触」用的短文案', () => {
  assert.ok(WELCOME_TEXT.includes('你好'))
  assert.ok(WELCOME_TEXT.length < 200)
})
