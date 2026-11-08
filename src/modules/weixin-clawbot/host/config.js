import s from '@deepseek-ai/schemastery'

/**
 * 微信扫码登录（ClawBot / iLink）的配置。
 *
 * 全部字段 volatile：它们是运行时开关，可以在设置面板里即时改写，
 * 不需要重启宿主。
 */
export const Config = s.object({
  enabled: s.boolean().default(true).volatile(),
  /** 凭据存放位置；独立于官方 deepseek-harness-weixin 的 WEIXIN_ILINK_CREDENTIAL。 */
  credentialRef: s.string().default('WEIXIN_CLAWBOT_CREDENTIAL').volatile(),
  /** 登录成功后是否常驻 getUpdates 监听。 */
  monitorOnConnect: s.boolean().default(true).volatile(),
})

export const DEFAULT_CREDENTIAL_REF = 'WEIXIN_CLAWBOT_CREDENTIAL'

/** 读取并规范化配置（schema 已保证类型，这里只兜底 undefined）。 */
export function readConfig(config = {}) {
  const read = (key) => {
    const field = config?.[key]
    try {
      return typeof field?.get === 'function' ? field.get() : field
    } catch {
      return undefined
    }
  }
  const credentialRef = read('credentialRef')
  return {
    enabled: read('enabled') !== false,
    credentialRef: typeof credentialRef === 'string' && credentialRef.trim() !== ''
      ? credentialRef.trim()
      : DEFAULT_CREDENTIAL_REF,
    monitorOnConnect: read('monitorOnConnect') !== false,
  }
}
