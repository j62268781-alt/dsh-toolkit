/**
 * 「通知」模块的文案表。
 *
 * 命名空间固定为 `dsh-toolkit.notification`；页面通过 `ctx.locale.bind(NS)` 取文案，
 * 拿不到 locale 服务时回退到内置中文表（设置页在降级宿主里也必须能显示中文，
 * 而不是显示 key）。
 */
export const NOTIFICATION_NS = 'dsh-toolkit.notification'

export const NOTIFICATION_COPY = {
  zh: {
    nav: '通知',
    title: '通知',
    intro: '会话跑完、出错、想问你问题或需要授权时提醒你。通知标题是会话标题，正文是本次的最终回复。',

    enabledTitle: '通知提醒',
    enabledDesc: '会话结束时提醒你：弹出系统通知，并按下面的设置播放提示音。首次打开需要向浏览器/系统授予通知权限。',
    soundTitle: '提示音',
    soundDesc: '在弹出系统通知的同时播放提示音（Web Audio 实时合成，不附带音频文件）。',
    volumeTitle: '音量',
    volumeDesc: '提示音的响度，0 为静音。',
    volumeValue: '{percent}%',

    currentTitle: '当前会话提醒时机',
    currentDesc: '你正在读的那个会话，什么时候也提醒你。',
    currentHidden: '仅后台或最小化时',
    currentUnfocused: '切到其他应用时也提醒',
    currentAlways: '始终提醒',

    scopeTitle: '通知范围',
    scopeDesc: '哪些会话结束时提醒，以及主会话要不要等它的子会话跑完。',
    scopeAll: '全部会话（含子会话）',
    scopeMain: '只主会话',
    scopeMainWait: '主会话，等子会话跑完',

    typesHeading: '提醒类型',
    typesHint: '每种类型可以单独开关，并选择提示音。',
    typeCompletedTitle: '会话完成',
    typeCompletedDesc: '一轮会话正常结束。',
    typeFailedTitle: '会话失败',
    typeFailedDesc: '一轮会话出错中断，或宿主上报了 agent 错误。',
    typeQuestionTitle: '等待回答',
    typeQuestionDesc: 'Agent 正在等你回答问题，或请求你审阅计划。',
    typePermissionTitle: '需要授权',
    typePermissionDesc: 'Agent 请求执行需要你授权的操作。',
    soundLabel: '提示音',
    soundChime: '叮咚',
    soundFault: '低鸣',
    soundPop: '轻响',
    soundAlert: '警示',
    soundNone: '静音',

    testTitle: '测试通知',
    testDesc: '验证系统通知通道是否可用；打开开关时也会申请权限。',
    testButton: '发送测试通知',
    testSent: '已发送一条测试通知。',
    testFailed: '系统通知没有发出来：{reason}',
    testUnsupported: '当前环境不支持系统通知（需要浏览器或桌面外壳）。',
    permissionGranted: '通知权限：已授予',
    permissionDenied: '通知权限：已被拒绝，需在系统设置里重新允许。',
    permissionDefault: '通知权限：尚未授予',
    permissionUnsupported: '通知权限：当前环境不支持',
    grantButton: '授权',
    grantedJustNow: '已获得通知权限。',
    deniedHint: '浏览器已拒绝通知权限；请到浏览器的站点设置里允许后再试。',

    recentTitle: '最近通知',
    recentHint: '这里显示本次运行里已经发过的通知，点击可以直接打开对应会话。',
    recentEmpty: '还没有发过通知。',
    openSession: '打开会话',
    justNow: '刚刚',
    minutesAgo: '{minutes} 分钟前',
    hoursAgo: '{hours} 小时前',
    untitled: '无标题会话',
    noReply: '（本轮没有文本回复）',

    readOnly: '宿主没有提供可写的配置表单，这里的开关只能查看，无法保存。',
    saveFailed: '保存失败：{reason}',
    saved: '已保存。',
    footerNote: '通知开关保存在 DSH 的用户配置里，跨窗口与重启后保持一致。',
  },
  en: {
    nav: 'Notifications',
    title: 'Notifications',
    intro: 'Get alerted when a session finishes, fails, asks you a question, or needs approval. The title is the session title and the body is this run\'s final reply.',

    enabledTitle: 'Notifications',
    enabledDesc: 'Alert you when a session finishes: show a system notification and play the cue below. The first time, the browser/OS asks for permission.',
    soundTitle: 'Alert sound',
    soundDesc: 'Play a synthesized cue alongside the system notification (Web Audio, no audio files).',
    volumeTitle: 'Volume',
    volumeDesc: 'Loudness of the cue; 0 is silent.',
    volumeValue: '{percent}%',

    currentTitle: 'When the current session alerts',
    currentDesc: 'When the session you are reading also alerts you.',
    currentHidden: 'Only when hidden or minimized',
    currentUnfocused: 'Also when another app is in front',
    currentAlways: 'Always alert',

    scopeTitle: 'Notification scope',
    scopeDesc: 'Which sessions alert, and whether the main session waits for its subagents.',
    scopeAll: 'All sessions (including subagents)',
    scopeMain: 'Main session only',
    scopeMainWait: 'Main session, after subagents',

    typesHeading: 'Alert kinds',
    typesHint: 'Each kind can be toggled and given its own sound.',
    typeCompletedTitle: 'Session completed',
    typeCompletedDesc: 'A run finished normally.',
    typeFailedTitle: 'Session failed',
    typeFailedDesc: 'A run was interrupted by an error, or the host reported an agent error.',
    typeQuestionTitle: 'Waiting for an answer',
    typeQuestionDesc: 'The agent is waiting for your answer, or wants you to review a plan.',
    typePermissionTitle: 'Approval needed',
    typePermissionDesc: 'The agent requests an action that needs your approval.',
    soundLabel: 'Sound',
    soundChime: 'Chime',
    soundFault: 'Fault',
    soundPop: 'Pop',
    soundAlert: 'Alert',
    soundNone: 'Silent',

    testTitle: 'Test notification',
    testDesc: 'Check the system notification channel; turning the switch on also asks for permission.',
    testButton: 'Send test notification',
    testSent: 'A test notification was sent.',
    testFailed: 'The system notification was not shown: {reason}',
    testUnsupported: 'System notifications are not available in this environment.',
    permissionGranted: 'Permission: granted',
    permissionDenied: 'Permission: denied — allow it again in the system settings.',
    permissionDefault: 'Permission: not granted yet',
    permissionUnsupported: 'Permission: unsupported here',
    grantButton: 'Grant',
    grantedJustNow: 'Notification permission granted.',
    deniedHint: 'The browser denied notifications; allow them in the site settings and try again.',

    recentTitle: 'Recent notifications',
    recentHint: 'Notifications sent in this run. Click one to open its session.',
    recentEmpty: 'No notifications yet.',
    openSession: 'Open session',
    justNow: 'just now',
    minutesAgo: '{minutes} min ago',
    hoursAgo: '{hours} h ago',
    untitled: 'Untitled session',
    noReply: '(no text reply in this run)',

    readOnly: 'The host exposes no writable configuration form, so these switches are read-only.',
    saveFailed: 'Save failed: {reason}',
    saved: 'Saved.',
    footerNote: 'Preferences live in the DSH user configuration, shared across windows and restarts.',
  },
}

/** `{name}` 占位符替换；缺参保持原样，避免显示 undefined。 */
export function interpolate(template, params) {
  if (typeof template !== 'string') return ''
  if (params === null || typeof params !== 'object') return template
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    params[key] === undefined || params[key] === null ? match : String(params[key])
  ))
}

/**
 * 生成 `t(key, params)`。
 *
 * `ctx.locale` 缺失、`register` 还没生效或 `bind` 抛错时逐级回退到内置表：
 * 设置页在降级宿主里也必须能显示中文文案，而不是显示 key。
 */
export function createTranslator(ctx, language) {
  const dict = NOTIFICATION_COPY[language] ?? NOTIFICATION_COPY.zh
  let bind
  try {
    if (typeof ctx?.locale?.bind === 'function') bind = ctx.locale.bind(NOTIFICATION_NS)
  } catch {
    bind = undefined
  }
  return function translate(key, params) {
    let text
    if (typeof bind === 'function') {
      try {
        text = bind(key)
      } catch {
        text = undefined
      }
    }
    if (typeof text !== 'string' || text === '' || text === key) text = dict[key] ?? NOTIFICATION_COPY.zh[key] ?? key
    return interpolate(text, params)
  }
}
