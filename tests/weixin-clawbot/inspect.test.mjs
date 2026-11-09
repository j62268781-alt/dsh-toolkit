/**
 * 只读查询的文案测试：当前会话 / 工作区列表 / 某工作区的会话列表。
 *
 * 用鸭子类型的假 ctx（workspaceRegistry / sessionQuery / agents / permissionPresets），
 * 断言的是微信里真正读到的纯文本，所以对所有可缺省的服务都做了退化覆盖。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeAllSessions,
  describeCurrent,
  describeWorkspaceSessions,
  describeWorkspaces,
  isAllRef,
  loadWorkspaces,
  resolveWorkspace,
  sessionsByPrefix,
  sessionsOfWorkspace,
} from '../../src/modules/weixin-clawbot/host/inspect.js'

const SESSION_ID = 'weixin-clawbot-6f338b7ca279'

/** 一条会话记录（与 sessionQuery.listSessions 的形状一致）。 */
function record(id, cwd) {
  return { header: { id, cwd, createdAt: 1 }, live: false, persisted: true }
}

/** 假 ctx：只有被用到的服务，其余缺省。 */
function fakeCtx({ workspaces, records = [], titles = {}, livePreset, omit = [] } = {}) {
  const services = {
    workspaceRegistry: workspaces === undefined ? undefined : { list: () => workspaces },
    sessionQuery: {
      async listSessions() {
        return records
      },
      async readTitleSnapshots(ids) {
        return ids.map((id) =>
          titles[id] === undefined
            ? { sessionId: id, status: 'rejected', reason: new Error('no title') }
            : { sessionId: id, status: 'fulfilled', value: { session: { id }, title: { title: titles[id] } } },
        )
      },
    },
    agents: { get: (id) => (livePreset === undefined ? undefined : { session: { id } }) },
    permissionPresets: { current: () => livePreset },
  }
  for (const name of omit) delete services[name]
  return { get: (name) => services[name], ...services }
}

test('describeCurrent：给出工作区、会话名、session_id 与权限预设', async () => {
  const ctx = fakeCtx({
    workspaces: [{ id: 'w1', title: 'dsh-toolkit', path: '/tmp/dsh-ws-toolkit', sessionIds: [SESSION_ID] }],
    records: [record(SESSION_ID, '/tmp/dsh-ws-toolkit')],
    titles: { [SESSION_ID]: '修复桥接错误' },
    livePreset: 'workspace-write',
  })
  const text = await describeCurrent({ ctx, sessionId: SESSION_ID, workspaceCwd: '/tmp/dsh-ws-toolkit' })
  assert.match(text, /工作区：dsh-toolkit — \/tmp\/dsh-ws-toolkit/)
  assert.match(text, /会话名：修复桥接错误/)
  assert.match(text, new RegExp(`session_id：${SESSION_ID}`))
  assert.match(text, /权限预设：workspace-write/)
})

test('describeCurrent：还没有会话、标题与会话未激活时给出占位而不是崩', async () => {
  const ctx = fakeCtx({ workspaces: [] })
  const text = await describeCurrent({ ctx })
  assert.match(text, /工作区：\(未登记\)|工作区：\s*（未登记）|工作区：$/)
  assert.match(text, /会话名：（还没有名字）/)
  assert.match(text, /session_id：（还没有会话）/)
  assert.match(text, /权限预设：（会话当前未激活/)

  const noTitle = await describeCurrent({
    ctx: fakeCtx({ workspaces: [{ id: 'w', title: 'ws', path: '/tmp/ws', sessionIds: [] }] }),
    sessionId: 'weixin-clawbot-abc',
    workspaceCwd: '/tmp/ws',
  })
  assert.match(noTitle, /会话名：（还没有名字）/)
  assert.match(noTitle, /session_id：weixin-clawbot-abc/)
})

test('resolveWorkspace：序号、绝对路径、尾段、标题都能定位', () => {
  const workspaces = [
    { id: 'a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] },
    { id: 'b', title: 'beta', path: '/tmp/beta', sessionIds: [] },
  ]
  assert.equal(resolveWorkspace(workspaces, '2').path, '/tmp/beta')
  assert.equal(resolveWorkspace(workspaces, '/tmp/alpha').path, '/tmp/alpha')
  assert.equal(resolveWorkspace(workspaces, '/tmp/alpha/').path, '/tmp/alpha')
  assert.equal(resolveWorkspace(workspaces, 'beta').path, '/tmp/beta')
  assert.equal(resolveWorkspace(workspaces, 'alpha').path, '/tmp/alpha')
  assert.equal(resolveWorkspace(workspaces, '0'), undefined)
  assert.equal(resolveWorkspace(workspaces, '9'), undefined)
  assert.equal(resolveWorkspace(workspaces, 'nope'), undefined)
  assert.equal(resolveWorkspace(workspaces, ''), undefined)
  assert.equal(resolveWorkspace(undefined, '1'), undefined)
})

test('describeWorkspaces：带序号、路径与会话数，并提示下一步', async () => {
  const ctx = fakeCtx({
    workspaces: [
      { id: 'a', title: 'alpha', path: '/tmp/alpha', sessionIds: ['s1', 's2'] },
      { id: 'b', title: 'beta', path: '/tmp/beta', sessionIds: [] },
    ],
  })
  const text = await describeWorkspaces(ctx)
  assert.match(text, /工作区（2 个）：/)
  assert.match(text, /1\. alpha — \/tmp\/alpha（会话 2 个）/)
  assert.match(text, /2\. beta — \/tmp\/beta（会话 0 个）/)
  assert.match(text, /\/sessions <序号>/)
})

test('describeWorkspaceSessions：按工作区过滤、带标题、标出当前会话、最多十条', async () => {
  const cwd = '/tmp/alpha'
  const records = [
    ...Array.from({ length: 12 }, (_, index) => record(`weixin-clawbot-${index}`, cwd)),
    record('other-session', '/tmp/beta'),
  ]
  const titles = { 'weixin-clawbot-0': '第一个', 'weixin-clawbot-1': '第二个' }
  const ctx = fakeCtx({
    workspaces: [{ id: 'a', title: 'alpha', path: cwd, sessionIds: records.map((item) => item.header.id) }],
    records,
    titles,
  })
  const workspace = (await loadWorkspaces(ctx))[0]
  const text = await describeWorkspaceSessions({ ctx, workspace, currentSessionId: 'weixin-clawbot-1' })
  assert.match(text, /alpha 下的会话（共 12 个，显示最近 10 个）：/)
  assert.match(text, /1\. 第一个 · weixin-clawbot-0/)
  assert.match(text, /2\. 第二个（当前） · weixin-clawbot-1/)
  assert.match(text, /10\. （未命名） · weixin-clawbot-9/)
  assert.ok(!text.includes('weixin-clawbot-10'), '超过十条的不显示')
  assert.ok(!text.includes('other-session'), '别的工作区不混进来')
})

test('describeWorkspaceSessions：空工作区与未知工作区都给可读提示', async () => {
  const ctx = fakeCtx({ workspaces: [], records: [] })
  const empty = await describeWorkspaceSessions({
    ctx,
    workspace: { id: 'a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] },
  })
  assert.match(empty, /alpha（\/tmp\/alpha）下还没有会话/)

  const unknown = await describeWorkspaceSessions({ ctx, workspace: undefined })
  assert.match(unknown, /找不到这个工作区/)
})

test('describeAllSessions：按工作区分组，每组最多三条，空工作区跳过', async () => {
  const ctx = fakeCtx({
    workspaces: [
      { id: 'a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] },
      { id: 'b', title: 'beta', path: '/tmp/beta', sessionIds: [] },
      { id: 'c', title: 'empty', path: '/tmp/empty', sessionIds: [] },
    ],
    records: [
      ...Array.from({ length: 5 }, (_, index) => record(`a-${index}`, '/tmp/alpha')),
      record('b-0', '/tmp/beta'),
    ],
    titles: { 'a-0': '甲零', 'b-0': '乙零' },
  })
  const text = await describeAllSessions({ ctx, currentSessionId: 'b-0' })
  assert.match(text, /alpha（\/tmp\/alpha）/)
  assert.match(text, /· 甲零 · a-0/)
  assert.ok(!text.includes('a-3'), '每组最多三条')
  assert.match(text, /beta（\/tmp\/beta）/)
  assert.match(text, /· 乙零（当前） · b-0/)
  assert.ok(!text.includes('empty'), '没有会话的工作区不占篇幅')
})

test('loadWorkspaces：没有 workspaceRegistry 时用会话 cwd 兜底推导', async () => {
  const ctx = fakeCtx({
    records: [record('s1', '/tmp/alpha'), record('s2', '/tmp/alpha'), record('s3', '/tmp/beta')],
    omit: ['workspaceRegistry'],
  })
  const workspaces = await loadWorkspaces(ctx)
  assert.equal(workspaces.length, 2)
  const alpha = workspaces.find((item) => item.path === '/tmp/alpha')
  assert.equal(alpha.title, 'alpha')
  assert.deepEqual(alpha.sessionIds, ['s1', 's2'])
})

test('服务全部缺失时也只会退化，不会抛错', async () => {
  const bare = { get: () => undefined }
  assert.equal(await describeWorkspaces(bare), '还没有登记任何工作区。\n可以从 DSH 桌面端建一个，或把配置里的 bridgeWorkspace 指到某个目录。')
  const current = await describeCurrent({ ctx: bare, sessionId: 'weixin-clawbot-x', workspaceCwd: '/tmp/x' })
  assert.match(current, /工作区：\/tmp\/x（未登记）/)
  assert.equal(await describeAllSessions({ ctx: bare }), '还没有登记任何工作区。')
  assert.deepEqual(await loadWorkspaces(undefined), [])
})

test('isAllRef 只认 all（大小写与首尾空格无关）', () => {
  assert.equal(isAllRef('all'), true)
  assert.equal(isAllRef(' ALL '), true)
  assert.equal(isAllRef('1'), false)
  assert.equal(isAllRef(''), false)
  assert.equal(isAllRef(undefined), false)
})

test('describeCurrent：以会话头里的 cwd 为准（换过工作区也能看出来）', async () => {
  const ctx = fakeCtx({
    workspaces: [
      { id: 'a', title: 'old', path: '/tmp/old', sessionIds: [SESSION_ID] },
      { id: 'b', title: 'new', path: '/tmp/new', sessionIds: [] },
    ],
    records: [record(SESSION_ID, '/tmp/old')],
    titles: { [SESSION_ID]: '老会话' },
  })
  const text = await describeCurrent({ ctx, sessionId: SESSION_ID, workspaceCwd: '/tmp/new' })
  assert.match(text, /工作区：old — \/tmp\/old/)
  assert.ok(!text.includes('/tmp/new'), '不看桥接的当前值，看会话头')
})

test('sessionsOfWorkspace：按 cwd 过滤、带标题、按 limit 截断', async () => {
  const ctx = fakeCtx({
    records: [record('s1', '/tmp/alpha'), record('s2', '/tmp/alpha'), record('s3', '/tmp/alpha'), record('s4', '/tmp/beta')],
    titles: { s1: '一', s2: '二' },
  })
  const listing = await sessionsOfWorkspace(ctx, '/tmp/alpha', { limit: 2 })
  assert.equal(listing.total, 3)
  assert.deepEqual(listing.sessions.map((item) => item.id), ['s1', 's2'])
  assert.equal(listing.sessions[0].title, '一')
  assert.equal(listing.sessions[1].title, '二')
  assert.equal((await sessionsOfWorkspace(ctx, '/tmp/nowhere')).total, 0)
})

test('sessionsByPrefix：按 id 前缀跨工作区查找', async () => {
  const ctx = fakeCtx({
    records: [record('gui-session-aaa', '/tmp/a'), record('gui-session-bbb', '/tmp/b'), record('weixin-clawbot-1', '/tmp/c')],
  })
  const matches = await sessionsByPrefix(ctx, ' gui-session ')
  assert.deepEqual(matches.map((item) => item.id), ['gui-session-aaa', 'gui-session-bbb'])
  assert.equal(matches[0].cwd, '/tmp/a')
  assert.deepEqual(await sessionsByPrefix(ctx, '   '), [])
  assert.deepEqual(await sessionsByPrefix(ctx, 'nope'), [])
  assert.deepEqual(await sessionsByPrefix(undefined, 'gui'), [])
})
