/**
 * 纯逻辑层测试：配置解码、文本裁剪、通知正文与相对时间。
 *
 * 这一层不碰 DOM/ctx，可直接 import；配置字段清单还会和根 Config 交叉校验，
 * 防止「页面写的字段」与「宿主 schema 的 volatile 叶子」漂移。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CONFIG_NS, CURRENT_MODES, DEFAULT_SETTINGS, DEFAULT_SOUND, FIELDS, KINDS, SCOPES, SOUNDS,
  isKind, isSound, notificationBody, readSettings, relativeTime, resolveSettings, safeSnapshot, truncate,
} from '../../src/modules/notification/client/model.js'
// 根 schema 只从构建产物读：`src/host/config.js` 引用的是编译后的 host TS 模块。
import { Config } from '../../lib/index.js'

/** 简单的 t：只回填占位符，用来断言正文与时间文案。 */
function translate(key, params = {}) {
  const dictionary = {
    noReply: '（本轮没有文本回复）',
    typeFailedTitle: '会话失败',
    typeQuestionTitle: '等待回答',
    typePermissionTitle: '需要授权',
    untitled: '无标题会话',
    justNow: '刚刚',
    minutesAgo: '{minutes} 分钟前',
    hoursAgo: '{hours} 小时前',
  }
  const template = dictionary[key] ?? key
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
}

test('常量契约：四种类型、五种提示音、三种范围与三档时机', () => {
  assert.equal(CONFIG_NS, 'notification')
  assert.deepEqual(KINDS, ['completed', 'failed', 'question', 'permission'])
  assert.deepEqual(SOUNDS, ['chime', 'fault', 'pop', 'alert', 'none'])
  assert.deepEqual(CURRENT_MODES, ['never', 'unfocused', 'always'])
  assert.deepEqual(SCOPES, ['all', 'main', 'main-wait'])
  assert.deepEqual(DEFAULT_SOUND, { completed: 'chime', failed: 'fault', question: 'pop', permission: 'alert' })
  assert.equal(isSound('chime'), true)
  assert.equal(isSound('noise'), false)
  assert.equal(isKind('question'), true)
  assert.equal(isKind('everything'), false)
})

test('配置字段清单与根 Config 的 volatile 叶子一一对应', () => {
  const schema = Config()
  assert.ok(schema.notification, 'root schema must expose the notification namespace')
  assert.deepEqual(Object.keys(schema.notification).sort(), [...FIELDS].sort())
  for (const field of FIELDS) {
    const leaf = schema.notification[field]
    assert.ok(leaf, `notification.${field} must exist in the root schema`)
    assert.equal(typeof leaf.get, 'function', `notification.${field} must be volatile`)
  }
  // 默认值必须与客户端默认一致，否则页面刚打开就会显示「未保存的差异」。
  assert.equal(schema.notification.enabled.get(), DEFAULT_SETTINGS.enabled)
  assert.equal(schema.notification.soundEnabled.get(), DEFAULT_SETTINGS.soundEnabled)
  assert.equal(schema.notification.sound.get(), DEFAULT_SETTINGS.sound)
  assert.equal(schema.notification.volume.get(), DEFAULT_SETTINGS.volume)
  assert.equal(schema.notification.currentMode.get(), DEFAULT_SETTINGS.currentMode)
  assert.equal(schema.notification.scope.get(), DEFAULT_SETTINGS.scope)
  for (const kind of KINDS) {
    assert.equal(schema.notification[`${kind}Enabled`].get(), DEFAULT_SETTINGS.types[kind].enabled)
    assert.equal(schema.notification[`${kind}Sound`].get(), DEFAULT_SETTINGS.types[kind].sound)
  }
})

test('resolveSettings：缺省、裸对象、ConfigForm 快照与脏值都收敛到合法偏好', () => {
  assert.deepEqual(resolveSettings(undefined), JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
  assert.deepEqual(resolveSettings(null), JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))

  // 裸命名空间对象。
  const fromNamespace = resolveSettings({ notification: { enabled: false, volume: 0.25, scope: 'all' } })
  assert.equal(fromNamespace.enabled, false)
  assert.equal(fromNamespace.volume, 0.25)
  assert.equal(fromNamespace.scope, 'all')
  assert.equal(fromNamespace.types.completed.sound, 'chime')

  // ConfigForm 快照包装。
  const fromForm = resolveSettings({ value: { notification: { currentMode: 'always', completedSound: 'pop' } }, status: 'ready' })
  assert.equal(fromForm.currentMode, 'always')
  assert.equal(fromForm.types.completed.sound, 'pop')

  // 脏值：越界音量、未知范围/时机/音效都退回默认。
  const dirty = resolveSettings({
    notification: {
      enabled: 'yes', soundEnabled: 0, volume: 4, currentMode: 'sometimes', scope: 'everything',
      completedEnabled: 'no', completedSound: 'trumpet', failedSound: 42,
    },
  })
  assert.equal(dirty.enabled, true)
  assert.equal(dirty.soundEnabled, true)
  assert.equal(dirty.volume, 1)
  assert.equal(dirty.currentMode, 'unfocused')
  assert.equal(dirty.scope, 'main-wait')
  assert.equal(dirty.types.completed.enabled, true)
  assert.equal(dirty.types.completed.sound, 'chime')
  assert.equal(dirty.types.failed.sound, 'fault')
  assert.equal(resolveSettings({ volume: -3 }).volume, 0)
  assert.equal(resolveSettings({ volume: Number.NaN }).volume, DEFAULT_SETTINGS.volume)
})

test('默认值：全局系统音、满音量、失焦通知，并保留旧类型字段', () => {
  assert.equal(DEFAULT_SETTINGS.volume, 1)
  assert.equal(DEFAULT_SETTINGS.currentMode, 'unfocused')
  assert.equal(DEFAULT_SETTINGS.sound, 'system')
  assert.ok(FIELDS.includes('sound'))
  assert.equal(new Set(FIELDS).size, FIELDS.length)
})

test('时机解码：never/unfocused/always 生效，旧 hidden 迁移为 unfocused', () => {
  for (const mode of CURRENT_MODES) assert.equal(resolveSettings({ currentMode: mode }).currentMode, mode)
  assert.equal(resolveSettings({ currentMode: 'hidden' }).currentMode, 'unfocused')
  assert.equal(readSettings({ value: { notification: { currentMode: 'hidden' } } }).currentMode, 'unfocused')
  for (const mode of ['never', 'unfocused', 'always', 'hidden']) {
    assert.equal(Config({ notification: { currentMode: mode } }).notification.currentMode.get(), mode)
  }
  assert.throws(() => Config({ notification: { currentMode: 'sometimes' } }))
})

test('全局声音解码：系统音和目录 ID 可持久化，无效值回退系统默认', () => {
  const id = 'a1'.repeat(16)
  for (const sound of ['system', id, 'none', 'chime']) {
    assert.equal(resolveSettings({ sound }).sound, sound)
    assert.equal(resolveSettings({ value: { notification: { sound } } }).sound, sound)
    assert.equal(Config({ notification: { sound } }).notification.sound.get(), sound)
  }
  for (const sound of ['', '../private.wav', '/System/Library/Sounds/Funk.aiff', 'unknown', null, 42]) {
    assert.equal(resolveSettings({ sound }).sound, 'system')
  }
})

test('readSettings / safeSnapshot：表单缺失或抛错时给默认值，页面不崩', () => {
  assert.equal(readSettings(undefined).enabled, true)
  assert.equal(readSettings({ value: { notification: { enabled: false } } }).enabled, false)
  const throwing = {
    getSnapshot() {
      throw new Error('entry is not ready')
    },
  }
  assert.equal(safeSnapshot(throwing), undefined)
  assert.equal(readSettings(safeSnapshot(throwing)).enabled, true)
})

test('truncate：折叠空白、按字符截断并补省略号', () => {
  assert.equal(truncate('  hello\n\nworld  '), 'hello world')
  assert.equal(truncate('abcdef', 4), 'abc…')
  assert.equal(truncate(''), '')
  assert.equal(truncate(undefined), '')
  assert.equal(truncate('abcd', 10), 'abcd')
})

test('notificationBody：标题之外的正文按类型取材，完成时用最终回复', () => {
  assert.equal(notificationBody({ kind: 'completed', detail: '最后一条回复' }, translate), '最后一条回复')
  assert.equal(notificationBody({ kind: 'completed', detail: '' }, translate), '（本轮没有文本回复）')
  assert.equal(notificationBody({ kind: 'failed', detail: 'ECONNRESET' }, translate), 'ECONNRESET')
  assert.equal(notificationBody({ kind: 'failed', detail: '' }, translate), '会话失败')
  assert.equal(notificationBody({ kind: 'question', detail: '继续吗？' }, translate), '继续吗？')
  assert.equal(notificationBody({ kind: 'question', detail: '' }, translate), '等待回答')
  assert.equal(notificationBody({ kind: 'permission', detail: 'bash' }, translate), 'bash')
  assert.equal(notificationBody({ kind: 'permission', detail: '' }, translate), '需要授权')
  // 正文统一压成一行并截断：系统通知卡片只显示两三行。
  const long = 'x'.repeat(400)
  const body = notificationBody({ kind: 'completed', detail: long }, translate)
  assert.equal(body.length, 160)
  assert.ok(body.endsWith('…'))
})

test('relativeTime：刚刚 / 分钟 / 小时', () => {
  const now = 1_700_000_000_000
  assert.equal(relativeTime(now - 5_000, now, translate), '刚刚')
  assert.equal(relativeTime(now - 5 * 60_000, now, translate), '5 分钟前')
  assert.equal(relativeTime(now - 3 * 3_600_000, now, translate), '3 小时前')
  assert.equal(relativeTime(now + 60_000, now, translate), '刚刚')
})
