/**
 * iLink 出站与媒体客户端。
 *
 * 职责边界：
 *   · 只负责「把一条已经决定要发的消息发出去」，不做队列、不做重试编排、不碰会话；
 *   · 凭据与 baseUrl 由调用方传入（凭据只存在 credentials 里，这里不落盘、不写日志）；
 *   · 所有请求都走 ilink.js 的 postAuthed，保证请求头/base_info 与登录链路一致。
 *
 * 协议要点（与腾讯 openclaw-weixin 一致）：
 *   · sendmessage：msg.message_type=2（Bot）、message_state=2（完成），回复必须回传 context_token；
 *   · 媒体先 getuploadurl 拿 CDN 地址，密文上传后拿响应头 x-encrypted-param 当下载参数。
 */

import { randomUUID } from 'node:crypto'

import { assertSuccess, getUpdates, postAuthed } from './ilink.js'
import {
  DEFAULT_CDN_BASE_URL,
  MEDIA_TYPE,
  aesKeyForUpload,
  decryptAesEcb,
  detectImageMediaType,
  encryptAesEcb,
  md5Hex,
  mediaDownloadUrl,
  mediaUploadUrl,
  randomFileKey,
  randomKey,
  resolveMediaKey,
} from './media.js'

/** 消息类型：1 = 用户发来的，2 = Bot 发出的。 */
export const MESSAGE_TYPE = Object.freeze({ user: 1, bot: 2 })
/** 消息状态：0 新增 / 1 生成中 / 2 完成。 */
export const MESSAGE_STATE = Object.freeze({ fresh: 0, generating: 1, done: 2 })

const DEFAULT_TIMEOUT_MS = 20_000
const UPLOAD_RETRY_DELAY_MS = 250

function delay(ms: any) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 带超时的 fetch：连读响应体一起纳入超时保护（上传/下载都是小体量，够用）。 */
async function fetchBytes(url: any, { method = 'GET', headers, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal }: any = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    return { ok: response.ok, status: response.status, headers: response.headers, bytes }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 创建一个绑定了单个 bot 账号的 iLink 客户端。
 * @param options.baseUrl 凭据里的 baseUrl（不同账号可能落在不同节点）
 * @param options.token   bot_token
 * @param options.timeoutMs 普通接口超时
 * @param options.sendRetries CDN 上传失败重试次数
 */
export function createIlinkApi({
  baseUrl,
  token,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sendRetries = 2,
}: any = {}) {
  if (typeof token !== 'string' || token.trim() === '') throw new Error('iLink 客户端需要 bot token')
  const endpoint = (name: any) => `ilink/bot/${name}`

  async function post(name: any, body: any, label: any, signal?: any) {
    const payload = await postAuthed({
      baseUrl,
      token,
      endpoint: endpoint(name),
      body,
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })
    return assertSuccess(payload, label)
  }

  async function sendItem(to: any, item: any, contextToken: any) {
    const payload = await post('sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: randomUUID(),
        message_type: MESSAGE_TYPE.bot,
        message_state: MESSAGE_STATE.done,
        item_list: [item],
        ...(typeof contextToken === 'string' && contextToken !== '' ? { context_token: contextToken } : {}),
      },
    }, '发送微信消息', undefined)
    return payload
  }

  /** 加密上传一份媒体，返回可直接放进 message_item 的 media 描述。 */
  async function uploadMedia(to: any, plaintext: any, mediaType: any) {
    const key = randomKey()
    const filekey = randomFileKey()
    const encrypted = encryptAesEcb(plaintext, key)
    const upload = await post('getuploadurl', {
      filekey,
      media_type: mediaType,
      to_user_id: to,
      rawsize: plaintext.byteLength,
      rawfilemd5: md5Hex(plaintext),
      filesize: encrypted.byteLength,
      no_need_thumb: true,
      aeskey: key.toString('hex'),
    }, '申请媒体上传地址')
    const url = mediaUploadUrl(upload, filekey, cdnBaseUrl)
    let lastError
    for (let attempt = 0; attempt <= sendRetries; attempt += 1) {
      try {
        const response = await fetchBytes(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(encrypted),
          timeoutMs,
        })
        if (!response.ok) {
          const error = new Error(`微信 CDN 上传失败：HTTP ${response.status}`)
          // 4xx 是确定性拒绝（参数/权限问题），重试没有意义
          if (response.status >= 400 && response.status < 500) throw Object.assign(error, { fatal: true })
          throw error
        }
        const param = response.headers.get('x-encrypted-param')
        if (typeof param !== 'string' || param.trim() === '') throw new Error('微信 CDN 上传响应缺少 x-encrypted-param')
        return {
          media: {
            encrypt_query_param: param.trim(),
            aes_key: aesKeyForUpload(key),
            encrypt_type: 1,
          },
          encryptedBytes: encrypted.byteLength,
        }
      } catch (error: any) {
        lastError = error
        if (error?.fatal === true || attempt === sendRetries) break
        await delay(UPLOAD_RETRY_DELAY_MS * (attempt + 1))
      }
    }
    throw lastError
  }

  return {
    /** 发一条纯文本。 */
    async sendText(to: any, text: any, contextToken: any) {
      const value = typeof text === 'string' ? text : ''
      if (value === '') throw new Error('微信不允许发送空文本')
      return sendItem(to, { type: 1, text_item: { text: value } }, contextToken)
    },

    /** 发一张图片（png/jpeg/webp/gif）。 */
    async sendImage(to: any, data: any, contextToken: any) {
      const plaintext = Buffer.from(data)
      if (plaintext.byteLength === 0) throw new Error('微信不允许发送空图片')
      // 先校验格式，避免传完 CDN 才被对方客户端拒收
      detectImageMediaType(plaintext)
      const uploaded = await uploadMedia(to, plaintext, MEDIA_TYPE.image)
      return sendItem(to, {
        type: 2,
        image_item: {
          media: uploaded.media,
          mid_size: uploaded.encryptedBytes,
        },
      }, contextToken)
    },

    /** 发一个文件。 */
    async sendFile(to: any, data: any, name: any, contextToken: any) {
      const plaintext = Buffer.from(data)
      if (plaintext.byteLength === 0) throw new Error('微信不允许发送空文件')
      const uploaded = await uploadMedia(to, plaintext, MEDIA_TYPE.file)
      return sendItem(to, {
        type: 4,
        file_item: {
          media: uploaded.media,
          file_name: String(name ?? 'file'),
          len: String(plaintext.byteLength),
        },
      }, contextToken)
    },

    /** 渠道启动/停止通知（微信侧据此展示 bot 在线状态）。 */
    notifyStart(signal: any) {
      return post('msg/notifystart', {}, '通知微信渠道启动', signal)
    },

    notifyStop(signal: any) {
      return post('msg/notifystop', {}, '通知微信渠道停止', signal)
    },

    /** 取「输入中」票据；每个用户单独取，拿到后应缓存。 */
    async getTypingTicket(userId: any, contextToken: any, signal: any) {
      const payload = await post('getconfig', {
        ilink_user_id: userId,
        ...(typeof contextToken === 'string' && contextToken !== '' ? { context_token: contextToken } : {}),
      }, '获取输入状态票据', signal)
      const ticket = typeof payload?.typing_ticket === 'string' ? payload.typing_ticket.trim() : ''
      if (ticket === '') throw new Error('微信没有返回输入状态票据')
      return ticket
    },

    /** 输入中（1）/ 取消（2）。失败不重要，调用方可忽略异常。 */
    sendTyping(userId: any, ticket: any, status: any, signal: any) {
      return post('sendtyping', {
        ilink_user_id: userId,
        typing_ticket: ticket,
        status,
      }, '发送输入状态', signal)
    },

    /** 下载一条入站图片。 */
    async downloadImage(image: any, signal: any) {
      const media = image?.media
      if (media === undefined || media === null) throw new Error('微信图片缺少 CDN 引用')
      const url = mediaDownloadUrl(media, cdnBaseUrl)
      const response = await fetchBytes(url, { timeoutMs, ...(signal === undefined ? {} : { signal }) })
      if (!response.ok) throw new Error(`微信 CDN 下载失败：HTTP ${response.status}`)
      const key = resolveMediaKey(image?.aeskey, media)
      return key === undefined ? response.bytes : decryptAesEcb(response.bytes, key)
    },

    /** 下载一条入站文件。 */
    async downloadFile(file: any, signal: any) {
      const media = file?.media
      if (media === undefined || media === null) throw new Error('微信文件缺少 CDN 引用')
      const url = mediaDownloadUrl(media, cdnBaseUrl)
      const response = await fetchBytes(url, { timeoutMs, ...(signal === undefined ? {} : { signal }) })
      if (!response.ok) throw new Error(`微信 CDN 下载失败：HTTP ${response.status}`)
      const key = resolveMediaKey(undefined, media)
      return key === undefined ? response.bytes : decryptAesEcb(response.bytes, key)
    },

    /** 长轮询收消息（透传 ilink.getUpdates，方便一处注入 token/baseUrl）。 */
    getUpdates(cursor: any, timeout: any, signal: any) {
      return getUpdates({ baseUrl, token, cursor, timeoutMs: timeout, signal })
    },
  }
}
