/**
 * iLink 扫码协议的最小实现（腾讯官方 ClawBot / 微信 ClawBot 通道）。
 *
 * 协议字段来自实测与参考实现的交叉验证：
 *   - get_bot_qrcode   → { ret, qrcode, qrcode_img_content }
 *   - get_qrcode_status→ { ret, status, bot_token?, ilink_bot_id?, baseurl?, ilink_user_id?, redirect_host? }
 *   - getupdates       → { ret|errcode, msgs?, get_updates_buf?, longpolling_timeout_ms? }
 *
 * 明确的不确定项（未实测，均已做防御式解析，缺字段时报可读错误而不是产生假数据）：
 *   - confirmed 分支里 bot_token / ilink_bot_id / baseurl / ilink_user_id 的确切取值形态
 *   - getupdates 返回 msgs[].item_list[].text_item.text 的文本结构
 *
 * 该文件不依赖任何第三方包，也不做任何落盘或日志输出。
 */

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
const BOT_TYPE = '3'
const ILINK_APP_ID = 'bot'
// 与腾讯 openclaw-weixin 2.4.6 对齐的协议兼容级别：2.4.6 → 0x020406。
const ILINK_APP_CLIENT_VERSION = String((2 << 16) | (4 << 8) | 6)
const QR_FETCH_TIMEOUT_MS = 15_000
const QR_POLL_TIMEOUT_MS = 35_000
const UPDATE_TIMEOUT_MS = 40_000
/** iLink 用 -14 表示 token 暂时失效（会话超时），不是永久错误。 */
export const STALE_TOKEN_CODE = -14

/** 未认证请求的公共头。 */
function commonHeaders() {
  return {
    'content-type': 'application/json',
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_APP_CLIENT_VERSION,
  }
}

/** 带 bot token 的请求头。 */
function authHeaders(token, uin) {
  return {
    ...commonHeaders(),
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${token}`,
    'X-WECHAT-UIN': Buffer.from(String(uin)).toString('base64'),
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`
}

/** 只允许 https，并把 baseUrl 规范化成不带尾斜杠的形式。 */
export function normalizeBaseUrl(value, fallback = ILINK_BASE_URL) {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('微信返回的 baseUrl 不是合法 URL')
  }
  if (url.protocol !== 'https:') throw new Error('微信 iLink baseUrl 必须使用 HTTPS')
  return url.toString().replace(/\/+$/, '')
}

async function requestJson(url, { method = 'POST', headers, body, timeoutMs, signal }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`iLink 请求失败：HTTP ${response.status}`)
    if (text.trim() === '') return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('iLink 返回了非 JSON 内容')
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 申请一个登录二维码。
 * @param options.localTokens 本机已有 token 列表（最多取最近 10 个，倒序）——微信据此判断是否已有可用会话。
 * @returns {{ id: string, url: string }} id 用于轮询，url 交给前端渲染二维码。
 */
export async function requestQrCode({ localTokens = [], signal } = {}) {
  const url = `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`
  const payload = await requestJson(url, {
    headers: commonHeaders(),
    body: { local_token_list: localTokens.slice(-10).reverse() },
    timeoutMs: QR_FETCH_TIMEOUT_MS,
    signal,
  })
  const ret = Number(payload?.ret ?? 0)
  if (ret !== 0) throw new Error(`申请微信二维码失败：ret=${ret}`)
  const id = typeof payload?.qrcode === 'string' ? payload.qrcode.trim() : ''
  const qrUrl = typeof payload?.qrcode_img_content === 'string' ? payload.qrcode_img_content.trim() : ''
  if (id === '' || qrUrl === '') throw new Error('微信二维码服务器没有返回有效二维码')
  return { id, url: qrUrl }
}

/**
 * 轮询二维码状态（长轮询，服务端约 30s 才返回）。
 * 注意：这是 GET，且 query 里带 qrcode id；不得把该 URL 写进日志。
 * @param baseUrl 可能因 scaned_but_redirect 而切换到微信分配的节点。
 */
export async function pollQrStatus({ baseUrl, id, verifyCode, timeoutMs, signal }) {
  const query = new URLSearchParams({ qrcode: id })
  if (typeof verifyCode === 'string' && verifyCode !== '') query.set('verify_code', verifyCode)
  const url = `${normalizeBaseUrl(baseUrl)}/ilink/bot/get_qrcode_status?${query.toString()}`
  return requestJson(url, {
    method: 'GET',
    headers: commonHeaders(),
    timeoutMs: Math.min(timeoutMs ?? QR_POLL_TIMEOUT_MS, QR_POLL_TIMEOUT_MS),
    signal,
  })
}

/** 调用一个已认证的 iLink 接口。 */
export async function postAuthed({ baseUrl, token, endpoint, body, timeoutMs, signal }) {
  const url = new URL(endpoint, ensureTrailingSlash(normalizeBaseUrl(baseUrl))).toString()
  return requestJson(url, {
    headers: authHeaders(token, Math.floor(Math.random() * 0xffffffff)),
    body: { ...body, base_info: { channel_version: '1.0.0', bot_agent: 'dsh-toolkit-remote' } },
    timeoutMs,
    signal,
  })
}

/**
 * iLink 的业务错误约定：`errcode` 优先，其次 `ret`；两者都缺省视为成功。
 * @throws 非 0 时抛出可读错误（调用方决定是否重试）
 */
export function assertSuccess(payload, label) {
  const code = Number(payload?.errcode ?? payload?.ret ?? 0)
  if (!Number.isFinite(code) || code === 0) return payload ?? {}
  const message = typeof payload?.errmsg === 'string' ? payload.errmsg.trim() : ''
  throw new Error(`${label}失败：iLink 返回 ${code}${message === '' ? '' : `（${message}）`}`)
}


/**
 * 长轮询收消息。
 * @param cursor 上一轮的 get_updates_buf；首轮传空串。
 * @returns iLink 原始响应，含 msgs / get_updates_buf / longpolling_timeout_ms。
 */
export async function getUpdates({ baseUrl, token, cursor = '', timeoutMs = UPDATE_TIMEOUT_MS, signal }) {
  const payload = await postAuthed({
    baseUrl, token, endpoint: 'ilink/bot/getupdates',
    body: { get_updates_buf: cursor },
    timeoutMs,
    signal,
  })
  return payload ?? {}
}

/** 从一条 iLink 消息里取出纯文本（结构未实测，逐层防御）。 */
export function extractMessageText(message) {
  const items = Array.isArray(message?.item_list) ? message.item_list : []
  const parts = []
  for (const item of items) {
    const text = item?.text_item?.text
    if (typeof text === 'string' && text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/** 把 iLink 消息压缩成前端可用的脱敏摘要（不含 token、不含 sender 全量 id）。 */
export function summarizeMessage(message) {
  const text = extractMessageText(message)
  const sender = typeof message?.from_user_id === 'string' ? message.from_user_id : ''
  return {
    receivedAt: Date.now(),
    from: maskId(sender),
    text: text.length > 200 ? `${text.slice(0, 200)}…` : text,
    ...(text === '' ? { note: '收到一条非文本消息' } : {}),
  }
}

/**
 * 脱敏一个标识符：保留首尾各 4 位。
 * 长度不足时整体打码，避免「脱敏后仍是原文」。
 */
export function maskId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return ''
  if (text.length <= 10) return '*'.repeat(text.length)
  return `${text.slice(0, 4)}${'*'.repeat(Math.min(6, text.length - 8))}${text.slice(-4)}`
}

/** 从二维码状态响应里解析出凭据；字段缺失时抛出可读错误（不编造）。 */
export function readCredential(status) {
  const token = typeof status?.bot_token === 'string' ? status.bot_token.trim() : ''
  const accountId = typeof status?.ilink_bot_id === 'string' ? status.ilink_bot_id.trim() : ''
  if (token === '' || accountId === '') {
    throw new Error('微信已确认授权，但服务器没有返回完整凭据（bot_token / ilink_bot_id）')
  }
  const userId = typeof status?.ilink_user_id === 'string' ? status.ilink_user_id.trim() : ''
  return {
    token,
    accountId,
    baseUrl: normalizeBaseUrl(status?.baseurl),
    ...(userId === '' ? {} : { userId }),
  }
}

/** redirect_host 只接受主机名（可带端口），绝不允许带协议或路径。 */
export function redirectBaseUrl(host) {
  const value = typeof host === 'string' ? host.trim() : ''
  if (value === '') throw new Error('微信要求切换节点，但没有返回 redirect_host')
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(value)) throw new Error('微信返回的 redirect_host 格式无效')
  return normalizeBaseUrl(`https://${value}`)
}
