export const WC_NS = 'dsh-toolkit.weixin-clawbot'

/** 面板与入口的全部文案。键名与 UI 一一对应，避免出现裸 key。 */
export const WC_COPY = {
  zh: {
    entry: '微信连接',
    entryTitle: '微信连接',
    title: '微信 ClawBot',
    subtitle: '扫码授权，将你的微信与 ClawBot 绑定',

    stateIdle: '未连接',
    stateRequesting: '正在申请二维码…',
    stateWaiting: '等待扫码',
    stateScanned: '已扫码，请在微信中确认',
    stateNeedCode: '需要输入微信显示的数字',
    stateConnected: '已连接',
    stateReconnecting: '正在重连…',
    stateInvalid: '连接已失效',
    stateFailed: '出现错误',
    stateClosed: '已关闭',
    stateExpired: '二维码已过期',

    connect: '连接微信',
    reconnect: '重新登录',
    refresh: '刷新二维码',
    cancel: '取消',
    disconnect: '断开连接',
    probing: '正在测试…',
    codePlaceholder: '微信里显示的数字',
    codeSubmit: '提交',
    scanHint: '用手机微信扫描二维码，并在微信中确认连接',
    qrExpiredTitle: '二维码已过期',
    qrExpiredAction: '点击刷新',
    qrConnecting: '连接中…',
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
    monitorTraffic: '监听中 · 收 {r} · 回 {s}',
    monitorIdle: '未监听 · 收 {r} · 回 {s}',

    bridgeTitle: '消息桥接',
    bridge: '状态',
    bridgeOff: '未开启',
    bridgeReady: '已就绪',
    bridgeNotReady: '未就绪',
    bridgePolicy: '策略',
    policyOpen: '任何人',
    policyAllowlist: '仅白名单（{n} 人）',
    bridgeCounts: '收发',
    bridgeCountsValue: '收 {r} · 回 {s}',
    bridgeApprovals: '待审批',
    bridgeHint: '开启后，白名单里的微信消息会跑一轮 Agent，并把回复发回微信；/approve、/reject 可直接处理工具审批。',
    bridgeEnable: '开启桥接',
    bridgeDisable: '关闭桥接',
    bridgeEnabledNow: '桥接已开启。',
    bridgeDisabledNow: '桥接已关闭。',
    allowRecent: '允许最近联系人',
    allowRecentDone: '已把最近联系人加入白名单。',
    sendTest: '发送测试消息',
    sendTestDone: '测试消息已发出。',
    useOpen: '改为任何人可用',
    useAllowlist: '改为仅白名单',
    policyDone: '策略已更新。',

    failed: '操作失败：{reason}',
    loading: '正在读取状态…',
    close: '关闭',
    retry: '重试',
  },
  en: {
    entry: 'WeChat',
    entryTitle: 'WeChat connection',
    title: 'WeChat ClawBot',
    subtitle: 'Scan to authorize and bind your WeChat to ClawBot',

    stateIdle: 'Not connected',
    stateRequesting: 'Requesting a QR code…',
    stateWaiting: 'Waiting for scan',
    stateScanned: 'Scanned — confirm in WeChat',
    stateNeedCode: 'Enter the number shown in WeChat',
    stateConnected: 'Connected',
    stateReconnecting: 'Reconnecting…',
    stateInvalid: 'Connection lost',
    stateFailed: 'Something went wrong',
    stateClosed: 'Closed',
    stateExpired: 'QR code expired',

    connect: 'Connect WeChat',
    reconnect: 'Sign in again',
    refresh: 'Refresh QR code',
    cancel: 'Cancel',
    disconnect: 'Disconnect',
    codePlaceholder: 'Number shown in WeChat',
    codeSubmit: 'Submit',
    scanHint: 'Scan with WeChat on your phone, then confirm the connection',
    qrExpiredTitle: 'QR code expired',
    qrExpiredAction: 'Click to refresh',
    qrConnecting: 'Connecting…',
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
    monitorTraffic: 'Listening · {r} in · {s} out',
    monitorIdle: 'Idle · {r} in · {s} out',

    bridgeTitle: 'Message bridge',
    bridge: 'State',
    bridgeOff: 'Off',
    bridgeReady: 'Ready',
    bridgeNotReady: 'Not ready',
    bridgePolicy: 'Policy',
    policyOpen: 'Anyone',
    policyAllowlist: 'Allowlist ({n})',
    bridgeCounts: 'Traffic',
    bridgeCountsValue: '{r} in · {s} out',
    bridgeApprovals: 'Pending approvals',
    bridgeHint: 'When enabled, allowlisted WeChat messages run one agent turn and the reply is sent back; /approve and /reject answer tool approvals.',
    bridgeEnable: 'Enable bridge',
    bridgeDisable: 'Disable bridge',
    bridgeEnabledNow: 'Bridge enabled.',
    bridgeDisabledNow: 'Bridge disabled.',
    allowRecent: 'Allow recent contact',
    allowRecentDone: 'Recent contact added to the allowlist.',
    sendTest: 'Send test message',
    sendTestDone: 'Test message sent.',
    useOpen: 'Allow anyone',
    useAllowlist: 'Allowlist only',
    policyDone: 'Policy updated.',

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
