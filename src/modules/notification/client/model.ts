/**
 * 「通知」模块的纯逻辑层：配置常量、默认值、容错解码与文本裁剪。
 *
 * 这里不放 DOM、不读 ctx、不发请求、不 import React —— 所有可测的算术与判定都在这里，
 * `node --test` 可以直接 `import` 本文件做纯函数单测。
 *
 * 配置以扁平字段持久化在 DSH 用户配置的 `notification` 命名空间里（宿主设置服务只允许写
 * volatile 叶子字段，扁平字段既方便逐个标记 volatile，也让页面用 `form.set(field, value)`
 * 一次写一个字段）。嵌套的「每种类型一组」在读写时由这里折叠/展开。
 */

/** 设置页与宿主配置共用的命名空间（三者必须字面一致：根 Config 键 / findScopedForm / 本常量）。 */
export const CONFIG_NS = 'notification'

/** 四种提醒类型，顺序即页面上的顺序。 */
export const KINDS = ['completed', 'failed', 'question', 'permission']

/** 可选提示音；`none` 表示该类型静音。 */
export const SOUNDS = ['chime', 'fault', 'pop', 'alert', 'none']

/** 统一通知时机；旧版 hidden 在解码时迁移到 unfocused。 */
export const CURRENT_MODES = ['never', 'unfocused', 'always']

/** 哪些会话提醒，以及主会话是否等子会话。 */
export const SCOPES = ['all', 'main', 'main-wait']

/** 每种类型默认的提示音（与参考实现的默认四音一致）。 */
export const DEFAULT_SOUND = Object.freeze({
  completed: 'chime',
  failed: 'fault',
  question: 'pop',
  permission: 'alert',
})

/** 默认偏好。宿主配置里没有覆盖时按这份解析。 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  soundEnabled: true,
  volume: 1,
  currentMode: 'unfocused',
  sound: 'system',
  scope: 'main-wait',
  types: Object.freeze({
    completed: Object.freeze({ enabled: true, sound: 'chime' }),
    failed: Object.freeze({ enabled: true, sound: 'fault' }),
    question: Object.freeze({ enabled: true, sound: 'pop' }),
    permission: Object.freeze({ enabled: true, sound: 'alert' }),
  }),
})

/** 扁平字段名：`completedEnabled` / `completedSound` / …，与根 Config 的叶子一一对应。 */
export const FIELDS = Object.freeze([
  'enabled',
  'soundEnabled',
  'volume',
  'currentMode',
  'sound',
  'scope',
  ...KINDS.flatMap((kind) => [`${kind}Enabled`, `${kind}Sound`]),
])

/** 判断一个值是否是可选提示音。 */
export function isSound(value) {
  return SOUNDS.includes(value)
}

/** 判断一个值是否是合法提醒类型。 */
export function isKind(value) {
  return KINDS.includes(value)
}

/**
 * 把宿主配置里的一项收窄成标量，否则回退默认值。
 * `form.set` 写入后再读回同名字段，因此读取端必须容忍任何历史脏值。
 */
function pick(source, field, candidate, fallback) {
  const value = source?.[field]
  return candidate(value) ? value : fallback
}

/**
 * 容错解码一份配置（可以是 `{ notification: {...} }`、`{ value: {...} }` 或裸字段对象）。
 * 任何非法值都退到默认，而不是让页面崩掉。
 * @param raw - 宿主配置快照或页面读到的裸对象。
 * @returns 完整、合法的偏好对象。
 */
export function resolveSettings(raw) {
  let root = raw !== null && typeof raw === 'object' ? raw : {}
  // ConfigForm 快照是 `{ value: {...} }` 包装；裸配置则是 `{ notification: {...} }`。
  if (root.value !== null && typeof root.value === 'object') root = root.value
  const source = root.notification !== null && typeof root.notification === 'object'
    ? root.notification
    : root
  const volume = Number(source.volume)
  const types: Record<string, { enabled: boolean; sound: string }> = {}
  for (const kind of KINDS) {
    types[kind] = {
      enabled: typeof source[`${kind}Enabled`] === 'boolean'
        ? source[`${kind}Enabled`]
        : DEFAULT_SETTINGS.types[kind].enabled,
      sound: pick(source, `${kind}Sound`, isSound, DEFAULT_SETTINGS.types[kind].sound),
    }
  }
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    soundEnabled: typeof source.soundEnabled === 'boolean' ? source.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SETTINGS.volume,
    currentMode: pick(source, 'currentMode', (value) => CURRENT_MODES.includes(value), DEFAULT_SETTINGS.currentMode),
    sound: pick(source, 'sound', (value) => value === 'system' || isSound(value) || (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)), 'system'),
    scope: pick(source, 'scope', (value) => SCOPES.includes(value), DEFAULT_SETTINGS.scope),
    types,
  }
}

/**
 * 从配置表单快照里读出偏好；表单缺失时返回默认值（页面只读展示，不崩）。
 * @param snapshot - `form.getSnapshot()` 的结果，形状随宿主版本变化。
 */
export function readSettings(snapshot) {
  if (snapshot === undefined || snapshot === null) return resolveSettings(undefined)
  try {
    return resolveSettings(snapshot)
  } catch {
    return resolveSettings(undefined)
  }
}

/**
 * 安全读一次配置表单快照：某些宿主版本在 entry 未就绪时抛错。
 * @param form - 投影后的配置表单。
 */
export function safeSnapshot(form) {
  try {
    return form?.getSnapshot?.()
  } catch {
    return undefined
  }
}

/**
 * 把一段文本压成一行并截断，用于通知正文。
 * 通知正文不保留换行：系统通知卡片只显示两三行，换行会被折叠成空格，
 * 主动折叠能保证首段信息完整出现在卡片上。
 * @param text - 原始文本（可能是整段 Markdown）。
 * @param max - 最大字符数（含省略号）。
 */
export function truncate(text, max = 160) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(1, max - 1))}…`
}

/**
 * 通知正文：每种类型一条固定的短句。
 *
 * 早先的实现把「本轮最终回复」截断后放进 body。实测下来这样有两个问题：
 * 1. 回复常常带 Markdown、表格、公式（`\[ a^2 + b^2 = c^2 \]`）与代码块，折叠成一行后
 *    在 Windows 通知卡片里既不可读、也把真正的信息（哪一类事件）挤没了；
 * 2. 长正文会让系统通知卡片的可用高度全被正文吃掉，标题行反而被压扁。
 * 所以参考实现（Qoder）的做法是以「事件类型」为正文、以「会话标题」为标题，两者都极短。
 * 详情仍然可以从历史面板与侧边栏进入会话查看，通知只负责告诉你「发生了什么」。
 * @param event - 引擎分类出来的事件。
 * @param t - 文案函数。
 */
export function notificationBody(event, t) {
  switch (event?.kind) {
    case 'completed':
      return t('bodyCompleted')
    case 'failed':
      return t('bodyFailed')
    case 'question':
      return t('bodyQuestion')
    case 'permission':
      return t('bodyPermission')
    default:
      return t('bodyCompleted')
  }
}

/**
 * 宿主会话列表快照里通知侧真正读到的字段。
 *
 * 宿主的快照类型随版本变化，这里只声明本模块用到的三个字段，其余一律按结构容错读取，
 * 这样引擎与安装器可以共用一份形状而不用把宿主类型搬进 client。
 */
export interface SessionSummary {
  /** 会话 id。 */
  id: string
  /** 父会话 id；主会话没有。 */
  parentId?: string
  /** 是否正在跑。 */
  running?: boolean
}

/** `ctx.sessions.list.getSnapshot()` 投影后通知侧用到的子集（`byId` 按 id 索引）。 */
export interface SessionListSnapshot {
  /** 按 id 索引的会话摘要。 */
  byId?: Record<string, SessionSummary>
  /** 宿主按会话缓存的状态投影；`values` 下有 goal / 排队输入等深字段，只能显式 any。 */
  projectionsBySession?: Record<string, any>
}

/**
 * 把「距现在多久」格式化成人类可读的一小段。
 * @param timestamp - 毫秒时间戳。
 * @param now - 当前时间（测试可注入）。
 * @param t - 文案函数。
 */
export function relativeTime(timestamp, now, t) {
  const seconds = Math.max(0, Math.floor(((Number(now) || 0) - (Number(timestamp) || 0)) / 1000))
  if (seconds < 60) return t('justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('minutesAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  return t('hoursAgo', { hours })
}
