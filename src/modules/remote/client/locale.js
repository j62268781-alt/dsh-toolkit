import { MOBILE_COPY } from './mobile/locale.js'
import { WECHAT_COPY } from './wechat/locale.js'

export const WC_NS = 'dsh-toolkit.remote'

/**
 * 外壳文案：标题栏、tab 条、关闭/取消这类两个 tab 都要用的词。
 * 功能自己的文案跟着各自的目录走（wechat/locale.js、mobile/locale.js），
 * 这里只负责合并成一个命名空间——宿主按命名空间注册一次，不能拆成两份。
 */
const SHELL_COPY = {
  zh: {
    entry: '远程连接',
    entryTitle: '远程连接',
    title: '远程连接',
    subtitle: '手机扫码连接本机 DSH，或绑定微信 ClawBot',

    refresh: '刷新二维码',
    cancel: '取消',

    tabsLabel: '连接方式',
    tabPair: '手机连接',
    tabClaw: 'ClawBot',

    failed: '操作失败：{reason}',
    loading: '正在读取状态…',
    close: '关闭',
    retry: '重试',
  },
  en: {
    entry: 'Remote',
    entryTitle: 'Remote connection',
    title: 'Remote connection',
    subtitle: 'Scan to connect your phone to this DSH, or bind WeChat ClawBot',

    refresh: 'Refresh QR code',
    cancel: 'Cancel',

    tabsLabel: 'Connection',
    tabPair: 'Phone',
    tabClaw: 'ClawBot',

    failed: 'Action failed: {reason}',
    loading: 'Reading state…',
    close: 'Close',
    retry: 'Retry',
  },
}

/** 面板与入口的全部文案。键名与 UI 一一对应，避免出现裸 key。 */
export const WC_COPY = {
  zh: { ...SHELL_COPY.zh, ...WECHAT_COPY.zh, ...MOBILE_COPY.zh },
  en: { ...SHELL_COPY.en, ...WECHAT_COPY.en, ...MOBILE_COPY.en },
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
