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
  /** 登录成功后是否常驻 getUpdates 监听（也是桥接的前置条件）。 */
  monitorOnConnect: s.boolean().default(true).volatile(),

  /** ── 下面是「微信 ↔ DSH」双向桥的配置 ── */

  /** 是否把微信消息送进 Agent 并回复。默认开启：连接成功即可用，且默认只对自己开放。 */
  bridgeEnabled: s.boolean().default(true).volatile(),
  /** 谁能用：allowlist=只允许下列用户 id（默认，即「本人」）；open=任何人（仅在配置文件里显式设置才生效）。 */
  bridgeAccessPolicy: s.union([s.const('open'), s.const('allowlist')]).default('allowlist').volatile(),
  /** 白名单用户 id（iLink 的 from_user_id）；面板里可改，运行时以桥状态文件优先。 */
  bridgeAllowFrom: s.array(s.string()).default([]).volatile(),
  /** 跑微信消息用的 agent preset；空字符串表示用宿主默认。 */
  bridgeAgentPreset: s.string().default('').volatile(),
  /** 沙箱/审批预设；空字符串表示用宿主默认（通常是 workspace-write）。 */
  bridgePermissionPreset: s.string().default('').volatile(),
  /** 会话工作目录；空字符串表示用户主目录。 */
  bridgeWorkspace: s.string().default('').volatile(),
  /** 是否把微信图片作为 image 块送进模型。 */
  bridgeIncludeImages: s.boolean().default(true).volatile(),
  /** iLink HTTP 请求超时（毫秒）。 */
  bridgeRequestTimeoutMs: s.number().min(1_000).max(120_000).default(20_000).volatile(),
  /** 工具审批等待微信回答的时长（毫秒）。 */
  bridgeApprovalTimeoutMs: s.number().min(10_000).max(600_000).default(120_000).volatile(),
})

export const DEFAULT_CREDENTIAL_REF = 'WEIXIN_CLAWBOT_CREDENTIAL'

/** 读取并规范化配置（schema 已保证类型，这里只兜底 undefined）。 */
export function readConfig(config: any = {}) {
  const read = (key: any) => {
    const field = config?.[key]
    try {
      return typeof field?.get === 'function' ? field.get() : field
    } catch {
      return undefined
    }
  }
  const credentialRef = read('credentialRef')
  const policy = read('bridgeAccessPolicy')
  const allowFrom = read('bridgeAllowFrom')
  const timeout = Number(read('bridgeRequestTimeoutMs'))
  const approvalTimeout = Number(read('bridgeApprovalTimeoutMs'))
  const workspace = read('bridgeWorkspace')
  return {
    enabled: read('enabled') !== false,
    credentialRef: typeof credentialRef === 'string' && credentialRef.trim() !== ''
      ? credentialRef.trim()
      : DEFAULT_CREDENTIAL_REF,
    monitorOnConnect: read('monitorOnConnect') !== false,

    bridgeEnabled: read('bridgeEnabled') !== false,
    bridgeAccessPolicy: policy === 'open' ? 'open' : 'allowlist',
    bridgeAllowFrom: Array.isArray(allowFrom)
      ? allowFrom.map((id) => String(id).trim()).filter((id) => id !== '')
      : [],
    bridgeAgentPreset: typeof read('bridgeAgentPreset') === 'string' ? read('bridgeAgentPreset').trim() : '',
    bridgePermissionPreset: typeof read('bridgePermissionPreset') === 'string' ? read('bridgePermissionPreset').trim() : '',
    bridgeWorkspace: typeof workspace === 'string' ? workspace.trim() : '',
    bridgeIncludeImages: read('bridgeIncludeImages') !== false,
    bridgeRequestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20_000,
    bridgeApprovalTimeoutMs: Number.isFinite(approvalTimeout) && approvalTimeout > 0 ? approvalTimeout : 120_000,
  }
}
