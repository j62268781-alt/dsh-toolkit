/**
 * 分发器测试：偏好门控（总开关 / 类型开关 / 全局时机 / 窗口焦点）、
 * 提示音与系统通知的调用顺序，以及标题/正文的取材。
 *
 * 提醒只有系统通知一条通道（宿主没有给插件应用内弹窗的能力），所以这里的期望值
 * 就是「什么时候会调用 showNotification」。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotificationDispatcher, SOUND_WINDOW } from '../../src/modules/notification/client/dispatch.js'
import { TAG_LIMIT, notificationTag } from '../../src/modules/notification/client/browser-notify.js'
import { resolveSettings } from '../../src/modules/notification/client/model.js'

/** 默认偏好上打补丁。 */
function settings(patch = {}) {
  return resolveSettings({ notification: patch })
}

/** 可编程的 t。 */
function translate(key, params = {}) {
  const dictionary = {
    bodyCompleted: '已完成这一轮回复。',
    bodyFailed: '这一轮执行失败，请打开会话查看详情。',
    bodyQuestion: '正在等待你的回答。',
    bodyPermission: '需要你的授权才能继续。',
    untitled: '无标题会话',
  }
  return String(dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
}

/** 记录调用的端口，默认模拟窗口失焦。 */
function createDeps(overrides = {}) {
  const calls = { sounds: [], notifications: [], order: [] }
  // 默认时钟：每次读都前进 10 秒，保证「一次 dispatch 一声」的既有用例不会被去抖窗口吃掉；
  // 需要验证去抖的用例自己注入 now。
  let clock = 0
  const deps = {
    settings: () => settings(),
    t: translate,
    playSound: (sound, volume) => {
      calls.order.push('sound')
      calls.sounds.push({ sound, volume })
      return true
    },
    showNotification: (payload) => {
      calls.order.push('notification')
      calls.notifications.push(payload)
      return true
    },
    isCurrent: () => false,
    isHidden: () => false,
    hasFocus: () => false,
    now: () => {
      clock += 10_000
      return clock
    },
    ...overrides,
  }
  return { deps, calls }
}

const completed = { kind: 'completed', sessionId: 's1', title: '修复登录', detail: '最后一条回复' }

test('默认偏好：窗口失焦时播放系统提示音并弹通知，标题是会话标题、正文是固定短句', () => {
  const { deps, calls } = createDeps()
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: true, sounded: true, title: '修复登录', body: '已完成这一轮回复。' })
  assert.deepEqual(calls.sounds, [{ sound: 'system', volume: 1 }])
  assert.deepEqual(calls.order, ['sound', 'notification'])
  assert.equal(calls.notifications.length, 1)
  assert.equal(calls.notifications[0].title, '修复登录')
  assert.equal(calls.notifications[0].body, '已完成这一轮回复。')
  assert.equal(calls.notifications[0].sessionId, 's1')
  assert.equal(calls.notifications[0].tag, notificationTag('s1', 'completed'))
  assert.ok(calls.notifications[0].tag.length <= TAG_LIMIT, 'tag 必须在原生层长度上限内，否则整条通知会被丢弃')
})

test('tag 折叠语义：同会话同类型稳定，不同会话或类型互不覆盖', () => {
  const { deps, calls } = createDeps()
  const dispatcher = new NotificationDispatcher(deps)
  dispatcher.dispatch(completed)
  dispatcher.dispatch({ ...completed })
  dispatcher.dispatch({ ...completed, kind: 'failed' })
  dispatcher.dispatch({ ...completed, sessionId: 's2' })
  const [first, second, third, fourth] = calls.notifications.map((payload) => payload.tag)
  assert.equal(first, second, '同一会话同一类型必须折叠到同一张卡片')
  assert.notEqual(first, third, '不同事件类型不能互相覆盖')
  assert.notEqual(first, fourth, '不同会话不能互相覆盖')
})

test('真实会话 id（36 字符 UUID）也必须落在原生 tag 上限内', () => {
  const { deps, calls } = createDeps()
  const sessionId = 'f44a4570-aaaa-bbbb-cccc-dddddddddddd'
  new NotificationDispatcher(deps).dispatch({ ...completed, sessionId })
  const { tag } = calls.notifications[0]
  assert.ok(tag.length <= TAG_LIMIT, `tag 长度 ${tag.length} 超过 ${TAG_LIMIT}：桌面端会静默丢弃整条通知`)
  // 桌面壳的通知 id 是 n#<origin>#<tag>，origin 为 dsh-app://app 时前缀 16 字符。
  assert.ok(tag.length + 16 <= 64, '加上桌面壳的 id 前缀仍不能超过 WinRT 的 64 字符上限')
  assert.ok(tag.startsWith(`${notificationTag('f44a4570-aaaa-bbbb-cccc-dddddddddddd', 'completed').slice(0, 25)}`))
})

// 行为矩阵：窗口失焦（隐藏或没焦点）时弹系统通知；窗口在前台时只有 always 才弹。
// 提示音与「弹不弹」解耦：只要时机不是 never，事件发生就响（前台横幅会被系统吞掉，
// 声音是唯一反馈），所以 sounded 只看 mode。
for (const mode of ['never', 'unfocused', 'always']) {
  for (const hidden of [false, true]) {
    for (const focused of [false, true]) {
      test(`分发矩阵：${mode}, hidden=${hidden}, focused=${focused}`, () => {
        const { deps, calls } = createDeps({
          settings: () => ({ ...settings(), currentMode: mode }),
          isHidden: () => hidden,
          hasFocus: () => focused,
        })
        const result = new NotificationDispatcher(deps).dispatch(completed)
        const away = hidden || !focused
        const wantSystem = mode === 'always' || (mode === 'unfocused' && away)
        const wantSound = mode !== 'never'
        assert.equal(result.notified, wantSystem)
        assert.equal(result.sounded, wantSound)
        assert.equal(calls.notifications.length, wantSystem ? 1 : 0)
        assert.equal(calls.sounds.length, wantSound ? 1 : 0)
        // never 一律静默；前台被抑制时给出可诊断的原因。
        assert.equal(result.reason, mode === 'never' ? 'never' : wantSystem ? undefined : 'foreground')
      })
    }
  }
}

test('窗口在前台：默认时机不弹通知，但仍然响一次提示音', () => {
  const { deps, calls } = createDeps({ hasFocus: () => true })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, {
    notified: false, sounded: true, title: '修复登录', body: '已完成这一轮回复。', reason: 'foreground',
  })
  assert.deepEqual(calls.sounds, [{ sound: 'system', volume: 1 }])
  assert.deepEqual(calls.notifications, [])
})

test('前台正在看这个会话：原因标记为 current（诊断用，行为与前台抑制一致）', () => {
  const { deps, calls } = createDeps({
    hasFocus: () => true,
    isCurrent: (sessionId) => sessionId === 's1',
  })
  const dispatcher = new NotificationDispatcher(deps)
  assert.deepEqual(dispatcher.dispatch(completed), {
    notified: false, sounded: true, title: '修复登录', body: '已完成这一轮回复。', reason: 'current',
  })
  assert.deepEqual(dispatcher.dispatch({ ...completed, sessionId: 'other-session' }), {
    notified: false, sounded: true, title: '修复登录', body: '已完成这一轮回复。', reason: 'foreground',
  })
  assert.deepEqual(calls.notifications, [])
})

test('当前会话判断出错也不会中断分发（前台仍然静默，不抛错）', () => {
  const { deps } = createDeps({
    hasFocus: () => true,
    isCurrent: () => { throw new Error('retainInfo exploded') },
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.notified, false)
  assert.equal(result.reason, 'foreground')
})

test('always 下窗口在前台也发系统通知，提示音只播一次', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'always' }),
    hasFocus: () => true,
    isCurrent: () => true,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: true, sounded: true, title: '修复登录', body: '已完成这一轮回复。' })
  assert.deepEqual(calls.order, ['sound', 'notification'])
  assert.equal(calls.notifications.length, 1)
})

test('窗口隐藏或有焦点缺失时都按「离开」处理，发系统通知', () => {
  for (const overrides of [{ isHidden: () => true }, { hasFocus: () => false }, { isHidden: () => true, hasFocus: () => true }]) {
    const { deps, calls } = createDeps(overrides)
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(result.notified, true)
    assert.equal(calls.notifications.length, 1)
  }
})

test('系统通知被拒（权限未授予）时返回未通知，提示音结果保留', () => {
  const { deps } = createDeps({ showNotification: () => false })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.notified, false)
  assert.equal(result.sounded, true)
})

test('系统通知接口抛错时返回未通知，不中断提示音', () => {
  const { deps } = createDeps({
    showNotification: () => { throw new Error('notification exploded') },
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.notified, false)
  assert.equal(result.sounded, true)
})

test('unfocused 时机缺失 hasFocus 时保守视为有焦点：前台不弹通知，但提示音照响', () => {
  for (const hidden of [false, true]) {
    const { deps, calls } = createDeps({
      settings: () => settings({ currentMode: 'unfocused' }),
      hasFocus: undefined,
      isHidden: () => hidden,
    })
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(result.notified, hidden)
    assert.equal(result.sounded, true)
    assert.equal(calls.notifications.length, hidden ? 1 : 0)
    assert.equal(calls.sounds.length, 1)
  }
})

test('hasFocus 明确返回 undefined 时视为有焦点：不弹通知，但仍响提示音', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'unfocused' }),
    hasFocus: () => undefined,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.notified, false)
  assert.equal(calls.sounds.length, 1)
  assert.deepEqual(calls.notifications, [])
})

test('总开关关闭：即使 always 时机也既不响也不弹', () => {
  const { deps, calls } = createDeps({ settings: () => settings({ enabled: false, currentMode: 'always' }) })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: false, sounded: false, reason: 'disabled' })
  assert.deepEqual(calls.sounds, [])
  assert.deepEqual(calls.notifications, [])
})

test('单类型关闭：即使 always 时机也抑制该类型，其他类型仍提醒', () => {
  const { deps, calls } = createDeps({ settings: () => settings({ completedEnabled: false, currentMode: 'always' }) })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: false, sounded: false, reason: 'kind-disabled' })
  assert.deepEqual(calls.sounds, [])
  assert.deepEqual(calls.notifications, [])
  const failed = new NotificationDispatcher(deps).dispatch({ kind: 'failed', sessionId: 's1', title: 't', detail: 'boom' })
  assert.equal(failed.notified, true)
  assert.equal(failed.sounded, true)
})

test('提示音关闭、全局 none 或零音量：不播放但仍弹通知', () => {
  for (const patch of [{ soundEnabled: false }, { sound: 'none' }, { volume: 0 }]) {
    const { deps, calls } = createDeps({ settings: () => ({ ...settings(), ...patch }) })
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(result.sounded, false)
    assert.equal(result.notified, true)
    assert.deepEqual(calls.sounds, [])
    assert.equal(calls.notifications.length, 1)
  }
})

test('全局系统提示音覆盖旧版每类型提示音，包括旧版 none', () => {
  for (const completedSound of ['none', 'chime', 'fault']) {
    const { deps, calls } = createDeps({
      settings: () => ({ ...settings({ completedSound }), sound: 'system' }),
    })
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(result.sounded, true)
    assert.equal(result.notified, true)
    assert.equal(calls.sounds[0].sound, 'system')
  }
})

test('直接传入旧版偏好且无全局提示音时，仍回落到每类型提示音', () => {
  for (const globalSound of [undefined, null]) {
    for (const typeSound of ['chime', 'none']) {
      const { deps, calls } = createDeps({
        settings: () => ({
          ...settings(),
          sound: globalSound,
          types: { completed: { enabled: true, sound: typeSound } },
        }),
      })
      const result = new NotificationDispatcher(deps).dispatch(completed)
      assert.equal(result.sounded, typeSound !== 'none')
      assert.equal(result.notified, true)
      assert.deepEqual(calls.sounds.map(({ sound }) => sound), typeSound === 'none' ? [] : [typeSound])
    }
  }
})

test('playSound 明确返回 false 时不记为已响；true 或旧接口 undefined 仍记为已接受', () => {
  for (const accepted of [false, true, undefined]) {
    let attempts = 0
    const { deps, calls } = createDeps({
      playSound: () => {
        attempts += 1
        return accepted
      },
    })
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(attempts, 1)
    assert.equal(result.sounded, accepted !== false)
    assert.equal(result.notified, true)
    assert.equal(calls.notifications.length, 1)
  }
})

test('提示音接口抛错时仍然弹系统通知', () => {
  const { deps, calls } = createDeps({
    playSound: () => { throw new Error('sound exploded') },
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.sounded, false)
  assert.equal(result.notified, true)
  assert.equal(calls.notifications.length, 1)
})

test('通知正文：每种类型一条固定短句，不再搬运最终回复', () => {
  const { deps, calls } = createDeps()
  const dispatcher = new NotificationDispatcher(deps)
  dispatcher.dispatch({ kind: 'failed', sessionId: 's1', title: '会话', detail: 'ECONNRESET' })
  dispatcher.dispatch({ kind: 'question', sessionId: 's1', title: '会话', detail: '继续吗？' })
  dispatcher.dispatch({ kind: 'permission', sessionId: 's1', title: '会话', detail: 'bash' })
  dispatcher.dispatch({ kind: 'completed', sessionId: 's1', title: '会话', detail: '很长很长的一段最终回复，含 markdown' })
  assert.deepEqual(calls.notifications.map((entry) => entry.body), [
    '这一轮执行失败，请打开会话查看详情。', '正在等待你的回答。', '需要你的授权才能继续。', '已完成这一轮回复。',
  ])
})

test('提示音去抖：窗口内连续触发只响一次，通知仍各自发出', () => {
  let now = 1_000
  const { deps, calls } = createDeps({ now: () => now })
  const dispatcher = new NotificationDispatcher(deps)
  dispatcher.dispatch(completed)
  now += 100
  const second = dispatcher.dispatch({ ...completed, sessionId: 's2' })
  assert.deepEqual(calls.sounds, [{ sound: 'system', volume: 1 }], '100ms 内的第二次不该再出声')
  assert.equal(second.sounded, false)
  assert.equal(calls.notifications.length, 2, '通知本身不能去抖：两个会话各一张卡')
  assert.equal(calls.sounds.length, 1)
})

test('提示音去抖：走出窗口后恢复发声；「从不」时机连提示音都不响', () => {
  let now = 1_000
  const { deps, calls } = createDeps({ now: () => now })
  const dispatcher = new NotificationDispatcher(deps)
  dispatcher.dispatch(completed)
  now += SOUND_WINDOW
  assert.equal(dispatcher.dispatch({ ...completed, sessionId: 's2' }).sounded, true)
  assert.equal(calls.sounds.length, 2)

  const silent = createDeps({ settings: () => settings({ currentMode: 'never' }) })
  const result = new NotificationDispatcher(silent.deps).dispatch(completed)
  assert.deepEqual(result, { notified: false, sounded: false, reason: 'never' })
  assert.deepEqual(silent.calls.sounds, [])
})

test('标题缺失时回落到「无标题会话」', () => {
  const { deps, calls } = createDeps()
  const result = new NotificationDispatcher(deps).dispatch({ kind: 'completed', sessionId: 's1', title: '   ', detail: 'x' })
  assert.equal(result.title, '无标题会话')
  assert.equal(result.notified, true)
  assert.equal(calls.notifications[0].title, '无标题会话')
})
