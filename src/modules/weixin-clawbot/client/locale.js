export const WC_NS = 'dsh-toolkit.weixin-clawbot'

/** 面板与入口的全部文案。键名与 UI 一一对应，避免出现裸 key。 */
export const WC_COPY = {
  zh: {
    entry: '微信连接',
    entryTitle: '微信连接',
    title: '微信扫码登录',
    subtitle: '在浏览器里完成登录，不需要敲命令',

    stateIdle: '未连接',
    stateRequesting: '正在申请二维码…',
    stateWaiting: '等待扫码',
    stateScanned: '已扫码，请在微信中确认',
    stateNeedCode: '需要输入微信显示的数字',
    stateConnected: '已连接',
    stateFailed: '出现错误',
    stateClosed: '已关闭',

    connect: '连接微信',
    reconnect: '重新登录',
    refresh: '刷新二维码',
    cancel: '取消',
    disconnect: '断开连接',
    probe: '测试通道',
    probing: '正在测试…',
    codePlaceholder: '微信里显示的数字',
    codeSubmit: '提交',
    scanHint: '用手机微信扫描二维码，并在微信中确认连接',
    qrExpired: '二维码已过期，请重新连接',
    qrCountdown: '{s} 秒后过期',
    account: '账号',
    endpoint: '节点',
    credentialRef: '凭据位置',
    monitor: '消息监听',
    monitorOn: '常驻监听中',
    monitorOff: '未监听',
    monitorToggle: '登录后常驻监听',
    monitorHint: '开启后本插件会持续收取该账号的微信消息；同一账号同一时间只能有一个消费者。',
    lastMessage: '最近一条消息',
    noneYet: '尚未收到消息',
    keepOpen: '鼠标离开后保持展开',
    received: '已收到 {n} 条',

    probeOk: '通道正常，本次没有新消息',
    probeMessages: '通道正常，收到 {n} 条新消息',
    probeFailed: '通道测试失败：{reason}',
    failed: '操作失败：{reason}',
    loading: '正在读取状态…',
    close: '关闭',
    retry: '重试',
  },
  en: {
    entry: 'WeChat',
    entryTitle: 'WeChat connection',
    title: 'WeChat sign-in',
    subtitle: 'Sign in from the browser — no commands needed',

    stateIdle: 'Not connected',
    stateRequesting: 'Requesting a QR code…',
    stateWaiting: 'Waiting for scan',
    stateScanned: 'Scanned — confirm in WeChat',
    stateNeedCode: 'Enter the number shown in WeChat',
    stateConnected: 'Connected',
    stateFailed: 'Something went wrong',
    stateClosed: 'Closed',

    connect: 'Connect WeChat',
    reconnect: 'Sign in again',
    refresh: 'Refresh QR code',
    cancel: 'Cancel',
    disconnect: 'Disconnect',
    probe: 'Test channel',
    probing: 'Testing…',
    codePlaceholder: 'Number shown in WeChat',
    codeSubmit: 'Submit',
    scanHint: 'Scan with WeChat on your phone, then confirm the connection',
    qrExpired: 'The QR code expired — connect again to get a new one',
    qrCountdown: 'Expires in {s}s',
    account: 'Account',
    endpoint: 'Endpoint',
    credentialRef: 'Credential slot',
    monitor: 'Message listener',
    monitorOn: 'Listening',
    monitorOff: 'Idle',
    monitorToggle: 'Keep listening after sign-in',
    monitorHint: 'While enabled this plugin keeps consuming this account\'s WeChat messages; only one consumer may poll an account at a time.',
    lastMessage: 'Latest message',
    noneYet: 'No messages yet',
    keepOpen: 'Keep this panel open after the pointer leaves',
    received: '{n} received',

    probeOk: 'Channel is healthy, no new messages',
    probeMessages: 'Channel is healthy, {n} new messages',
    probeFailed: 'Channel test failed: {reason}',
    failed: 'Action failed: {reason}',
    loading: 'Reading state…',
    close: 'Close',
    retry: 'Retry',
  },
}

export function createTranslator(ctx) {
  let bound
  try {
    bound = ctx.locale?.bind?.(WC_NS)
  } catch {
    bound = undefined
  }
  return (key, params = {}) => {
    let language
    try {
      language = ctx.locale?.language ?? ctx.locale?.getLanguage?.() ?? ctx.locale?.lang
    } catch {
      language = undefined
    }
    const dict = WC_COPY[String(language ?? 'zh').startsWith('en') ? 'en' : 'zh']
    let value
    try {
      value = bound?.(key)
    } catch {
      value = undefined
    }
    if (typeof value !== 'string' || value === '' || value === key) value = dict[key] ?? key
    return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] == null ? match : String(params[name])))
  }
}
