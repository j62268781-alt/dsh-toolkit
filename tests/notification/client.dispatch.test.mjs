/**
 * 分发器测试：偏好门控（总开关 / 类型开关 / 全局时机 / 窗口焦点）、
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

/** 记录调用的端口，默认模拟窗口失焦。 */
function createDeps(overrides = {}) {
  const calls = { sounds: [], notifications: [], cards: [], order: [] }
  const deps = {
    settings: () => settings(),
    t: translate,
    playSound: (sound, volume) => {
      calls.order.push('sound')
      calls.sounds.push({ sound, volume })
      return true
    },
    showCard: (payload) => {
      calls.order.push('card')
      calls.cards.push(payload)
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
    ...overrides,
  }
  return { deps, calls }
}

const completed = { kind: 'completed', sessionId: 's1', title: '修复登录', detail: '最后一条回复' }

test('默认偏好：窗口失焦时播放系统提示音并弹通知，标题是会话标题、正文是最终回复', () => {
  const { deps, calls } = createDeps()
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: true, sounded: true, title: '修复登录', body: '最后一条回复' })
  assert.deepEqual(calls.sounds, [{ sound: 'system', volume: 1 }])
  assert.deepEqual(calls.order, ['sound', 'notification'])
  assert.equal(calls.notifications.length, 1)
  assert.equal(calls.notifications[0].title, '修复登录')
  assert.equal(calls.notifications[0].body, '最后一条回复')
  assert.equal(calls.notifications[0].sessionId, 's1')
  assert.match(calls.notifications[0].tag, /s1:completed$/)
})

// 行为矩阵：窗口在前台（可见且有焦点）时用应用内卡片；后台时用系统通知；always 两者都发。
// 提示音沿用旧契约：只有「后台提醒或 always」才响。
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
        const wantCard = mode === 'always' || (mode === 'unfocused' && !away)
        const wantSystem = mode === 'always' || (mode === 'unfocused' && away)
        assert.equal(result.card === true, wantCard)
        assert.equal(result.notified, wantSystem)
        assert.equal(result.sounded, wantSystem)
        assert.equal(calls.cards.length, wantCard ? 1 : 0)
        assert.equal(calls.notifications.length, wantSystem ? 1 : 0)
        assert.equal(calls.sounds.length, wantSystem ? 1 : 0)
        assert.equal(result.reason, wantCard || wantSystem ? undefined : 'never')
        if (wantCard) {
          assert.deepEqual(calls.cards[0], {
            kind: 'completed', sessionId: 's1', title: '修复登录', body: '最后一条回复',
          })
        }
      })
    }
  }
}

test('默认时机在窗口有焦点时推应用内卡片；当前会话判断出错也不会中断分发', () => {
  const { deps, calls } = createDeps({
    hasFocus: () => true,
    isCurrent: () => { throw new Error('retainInfo exploded') },
  })
  const dispatcher = new NotificationDispatcher(deps)
  for (const sessionId of ['s1', 'other-session']) {
    assert.deepEqual(dispatcher.dispatch({ ...completed, sessionId }), {
      notified: false, sounded: false, card: true, title: '修复登录', body: '最后一条回复',
    })
  }
  assert.deepEqual(calls.sounds, [])
  assert.deepEqual(calls.notifications, [])
  assert.deepEqual(calls.cards.map((card) => card.sessionId), ['s1', 'other-session'])
})

test('前台正在看这个会话时不推卡片（提醒内容就在眼前），其他会话照常推', () => {
  const { deps, calls } = createDeps({
    hasFocus: () => true,
    isCurrent: (sessionId) => sessionId === 's1',
  })
  const dispatcher = new NotificationDispatcher(deps)
  assert.deepEqual(dispatcher.dispatch(completed), {
    notified: false, sounded: false, title: '修复登录', body: '最后一条回复', reason: 'current',
  })
  assert.deepEqual(dispatcher.dispatch({ ...completed, sessionId: 'other-session' }), {
    notified: false, sounded: false, card: true, title: '修复登录', body: '最后一条回复',
  })
  assert.deepEqual(calls.cards.map((card) => card.sessionId), ['other-session'])
  assert.deepEqual(calls.notifications, [])
  assert.deepEqual(calls.sounds, [])
})

test('always 下正在看当前会话：卡片仍然跳过，但按旧契约继续发系统通知', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'always' }),
    hasFocus: () => true,
    isCurrent: () => true,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, { notified: true, sounded: true, title: '修复登录', body: '最后一条回复' })
  assert.deepEqual(calls.cards, [])
  assert.equal(calls.notifications.length, 1)
})

test('always：窗口在前台时卡片与系统通知都发，提示音只播一次', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'always' }),
    hasFocus: () => true,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.deepEqual(result, {
    notified: true, sounded: true, card: true, title: '修复登录', body: '最后一条回复',
  })
  assert.deepEqual(calls.order, ['sound', 'card', 'notification'])
  assert.equal(calls.cards.length, 1)
  assert.equal(calls.notifications.length, 1)
})

test('窗口隐藏时只发系统通知，不推卡片', () => {
  const { deps, calls } = createDeps({
    isHidden: () => true,
    hasFocus: () => true,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.card, undefined)
  assert.equal(result.notified, true)
  assert.deepEqual(calls.cards, [])
  assert.equal(calls.notifications.length, 1)
})

test('卡片通道不可用（宿主没有 overlay 槽位）时回退到系统通知，不丢提醒', () => {
  const { deps, calls } = createDeps({
    hasFocus: () => true,
    showCard: undefined,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.card, undefined)
  assert.equal(result.notified, true)
  assert.equal(calls.notifications.length, 1)
})

test('卡片通道返回 false 或抛错时回退到系统通知', () => {
  for (const showCard of [() => false, () => { throw new Error('overlay exploded') }]) {
    const { deps, calls } = createDeps({
      hasFocus: () => true,
      showCard,
    })
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(result.card, undefined)
    assert.equal(result.notified, true)
    assert.equal(calls.notifications.length, 1)
  }
})

test('系统通知失败（权限被拒）不影响卡片：卡片仍然算已提醒', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'always' }),
    hasFocus: () => true,
    showNotification: () => false,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.notified, false)
  assert.equal(result.card, true)
  assert.equal(calls.cards.length, 1)
})

test('unfocused 时机缺失 hasFocus 时保守视为有焦点：可见时推卡片，窗口隐藏仍发系统通知', () => {
  for (const hidden of [false, true]) {
    const { deps, calls } = createDeps({
      settings: () => settings({ currentMode: 'unfocused' }),
      hasFocus: undefined,
      isHidden: () => hidden,
    })
    const result = new NotificationDispatcher(deps).dispatch(completed)
    assert.equal(result.card === true, !hidden)
    assert.equal(result.notified, hidden)
    assert.equal(result.sounded, hidden)
    assert.equal(calls.cards.length, hidden ? 0 : 1)
    assert.equal(calls.notifications.length, hidden ? 1 : 0)
  }
})

test('unfocused 时机仅把 hasFocus 明确返回 false 视为失焦（undefined 按有焦点走卡片）', () => {
  const { deps, calls } = createDeps({
    settings: () => settings({ currentMode: 'unfocused' }),
    hasFocus: () => undefined,
  })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.card, true)
  assert.equal(result.notified, false)
  assert.deepEqual(calls.sounds, [])
  assert.deepEqual(calls.notifications, [])
  assert.equal(calls.cards.length, 1)
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

test('通知接口拒绝显示时返回未通知，提示音结果保留', () => {
  const { deps } = createDeps({ showNotification: () => false })
  const result = new NotificationDispatcher(deps).dispatch(completed)
  assert.equal(result.notified, false)
  assert.equal(result.sounded, true)
})
