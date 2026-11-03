/**
 * 分发器测试：偏好门控（总开关 / 类型开关 / 当前会话时机 / 窗口可见性）、
 * 提示音与系统通知的调用顺序，以及标题/正文的取材。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotificationDispatcher } from '../../src/modules/notification/client/dispatch.js'
import { resolveSettings } from '../../src/modules/notification/client/model.js'

/** 默认偏好上打补丁。 */
function settings(patch = {}) {
  return resolveSettings({ notification: patch })
}

/** 可编程的 t。 */
function translate(key, params = {}) {
  const dictionary = {
    noReply: '（本轮没有文本回复）',
    untitled: '无标题会话',
    typeFailedTitle: '会话失败',
    typeQuestionTitle: '等待回答',
    typePermissionTitle: '需要授权',
  }
  return String(dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
}

/** 记录调用的端口。 */
function createDeps(overrides = {}) {
  const calls = { sounds: [], notifications: [] }
  const deps = {
    settings: () => settings(),
    t: translate,
    playSound: (sound, volume) => calls.sounds.push({ sound, volume }),
    showNotification: (payload) => {
      calls.notifications.push(payload)
      return true
    },
    isCurrent: () => false,
    isHidden: () => false,
    hasFocus: () => true,
    ...overrides,
  }
  return { deps, calls }
}

const completed = { kind: 'completed', sessionId: 's1', title: '修复登录', detail: '最后一条回复' }

test('默认偏好：后台会话完成时响铃并弹通知，标题是会话标题、正文是最终回复', () => {
  const { deps, calls } = createDeps()
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: true, sounded: true, title: '修复登录', body: '最后一条回复' })
  assert.equal(calls.sounds.length, 1)
  assert.deepEqual(calls.sounds[0], { sound: 'chime', volume: 0.6 })
  assert.equal(calls.notifications.length, 1)
  assert.equal(calls.notifications[0].title, '修复登录')
  assert.equal(calls.notifications[0].body, '最后一条回复')
  assert.equal(calls.notifications[0].sessionId, 's1')
  assert.match(calls.notifications[0].tag, /s1:completed$/)
})

test('总开关关闭：既不响也不弹', () => {
  const { deps, calls } = createDeps({ settings: () => settings({ enabled: false }) })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: false, sounded: false, reason: 'disabled' })
  assert.deepEqual(calls.sounds, [])
  assert.deepEqual(calls.notifications, [])
})

test('单类型关闭：只静音该类型', () => {
  const { deps, calls } = createDeps({ settings: () => settings({ completedEnabled: false }) })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.reason, 'kind-disabled')
  assert.deepEqual(calls.sounds, [])
  const failed = new NotificationDispatcher(deps).dispatch({ kind: 'failed', sessionId: 's1', title: 't', detail: 'boom' })
  assert.equal(failed.notified, true)
})

test('正在读的会话默认静默；hidden 时机在窗口隐藏时才提醒', () => {
  const current = createDeps({ isCurrent: (id) => id === 's1' })
  const quiet = new NotificationDispatcher(current.deps).dispatch(completed)
  assert.equal(quiet.reason, 'current-session')
  assert.deepEqual(current.calls.notifications, [])

  let hidden = false
  const deps = createDeps({ isCurrent: (id) => id === 's1', isHidden: () => hidden }).deps
  const dispatcher = new NotificationDispatcher(deps)
  assert.equal(dispatcher.dispatch(completed).notified, false)
  hidden = true
  assert.equal(dispatcher.dispatch(completed).notified, true)
})

test('unfocused 时机：切到其他应用也提醒，但窗口仍有焦点时静默', () => {
  let focused = true
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'unfocused' }),
    isCurrent: () => true,
    hasFocus: () => focused,
  })
  const dispatcher = new NotificationDispatcher(deps)
  assert.equal(dispatcher.dispatch(completed).reason, 'current-session')
  focused = false
  assert.equal(dispatcher.dispatch(completed).notified, true)
  assert.equal(calls.notifications.length, 1)
})

test('always 时机：即使正在看当前会话也提醒', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'always' }),
    isCurrent: () => true,
    isHidden: () => false,
    hasFocus: () => true,
  })
  assert.equal(new NotificationDispatcher(deps).dispatch(completed).notified, true)
  assert.equal(calls.notifications.length, 1)
})

test('提示音开关与 none：不播放但仍然弹通知', () => {
  const muted = createDeps({ settings: () => settings({ soundEnabled: false }) })
  const result = new NotificationDispatcher(muted.deps).dispatch(completed)
  assert.equal(result.sounded, false)
  assert.equal(result.notified, true)
  assert.deepEqual(muted.calls.sounds, [])

  const silentKind = createDeps({ settings: () => settings({ completedSound: 'none' }) })
  const silentResult = new NotificationDispatcher(silentKind.deps).dispatch(completed)
  assert.equal(silentResult.sounded, false)
  assert.equal(silentResult.notified, true)
})

test('通知正文：失败/提问/授权各用自己的详情，空详情有兜底', () => {
  const { deps, calls } = createDeps()
  const dispatcher = new NotificationDispatcher(deps)
  dispatcher.dispatch({ kind: 'failed', sessionId: 's1', title: '会话', detail: 'ECONNRESET' })
  dispatcher.dispatch({ kind: 'question', sessionId: 's1', title: '会话', detail: '继续吗？' })
  dispatcher.dispatch({ kind: 'permission', sessionId: 's1', title: '会话', detail: 'bash' })
  dispatcher.dispatch({ kind: 'failed', sessionId: 's1', title: '会话', detail: '' })
  assert.deepEqual(calls.notifications.map((entry) => entry.body), [
    'ECONNRESET', '继续吗？', 'bash', '会话失败',
  ])
})

test('标题缺失时回落到「无标题会话」；通知接口抛错不影响提示音与返回', () => {
  const { deps } = createDeps({
    showNotification: () => {
      throw new Error('notification exploded')
    },
  })
  const result = new NotificationDispatcher(deps).dispatch({ kind: 'completed', sessionId: 's1', title: '   ', detail: 'x' })
  assert.equal(result.title, '无标题会话')
  assert.equal(result.notified, false)
  assert.equal(result.sounded, true)
})
