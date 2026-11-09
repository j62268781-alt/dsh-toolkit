/**
 * iLink 媒体：AES-128-ECB 加解密、CDN 下载/上传地址、图片魔数识别。
 *
 * 协议事实（来自腾讯 openclaw-weixin 与 DSH 版实现的交叉验证）：
 *   · 上行：明文按 AES-128-ECB + PKCS#7 加密，filekey/aeskey 一起提交给
 *     `ilink/bot/getuploadurl`，然后把密文 POST 到 CDN；CDN 在响应头
 *     `x-encrypted-param` 里返回下载用的 encrypted_query_param。
 *   · 下行：优先用 media.full_url，否则拼 `<cdn>/download?encrypted_query_param=…`；
 *     密钥优先 image_item.aeskey（32 位 hex 字符串），其次 media.aes_key（base64）。
 *   · 发出去的 media.aes_key 是「实现里的 hex 字符串再 base64」，与下行的 base64
 *     形式并不对称——这是协议现状，不是笔误。
 *
 * 本文件不访问网络、不依赖宿主，纯函数，便于单测。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** 官方默认 CDN 网关。 */
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

/** getuploadurl 的 media_type 取值。 */
export const MEDIA_TYPE = Object.freeze({ image: 1, video: 2, file: 3, voice: 4 })

const HEX_KEY_PATTERN = /^[0-9a-fA-F]{32}$/

/** 16 字节随机密钥（AES-128）。 */
export function randomKey() {
  return randomBytes(16)
}

/** CDN 上传用的 filekey（16 字节的 hex）。 */
export function randomFileKey() {
  return randomBytes(16).toString('hex')
}

/** AES-128-ECB + PKCS#7 加密。 */
export function encryptAesEcb(data, key) {
  const plaintext = Buffer.from(data)
  if (plaintext.byteLength === 0) throw new Error('微信不允许发送空文件')
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/** AES-128-ECB + PKCS#7 解密。 */
export function decryptAesEcb(data, key) {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(Buffer.from(data)), decipher.final()])
}

/** 把 32 位 hex 字符串解析成 16 字节密钥。 */
export function parseHexKey(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!HEX_KEY_PATTERN.test(text)) throw new Error('微信媒体密钥不是合法的 32 位 hex 字符串')
  return Buffer.from(text, 'hex')
}

/** 把 base64 密钥解析成 16 字节；兼容「base64 里装的是 32 位 hex」的历史写法。 */
export function parseBase64Key(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') throw new Error('微信媒体密钥为空')
  const decoded = Buffer.from(text, 'base64')
  if (decoded.byteLength === 16) return decoded
  if (decoded.byteLength === 32) {
    const ascii = decoded.toString('utf8')
    if (HEX_KEY_PATTERN.test(ascii)) return Buffer.from(ascii, 'hex')
  }
  throw new Error('微信媒体密钥不是合法的 16 字节 base64')
}

/**
 * 取一条入站媒体条目的解密密钥。
 * @param aeskey 图片条目自带的 32 位 hex 密钥（优先）
 * @param media  CDNMedia，可能带 base64 的 aes_key
 * @returns 密钥 Buffer，缺失时返回 undefined（调用方决定是原样使用还是跳过）
 */
export function resolveMediaKey(aeskey, media) {
  const hex = typeof aeskey === 'string' ? aeskey.trim() : ''
  if (hex !== '') return parseHexKey(hex)
  const base64 = typeof media?.aes_key === 'string' ? media.aes_key.trim() : ''
  return base64 === '' ? undefined : parseBase64Key(base64)
}

/** 上行 item 里要回填的 aes_key（协议要求：hex 字符串再 base64）。 */
export function aesKeyForUpload(key) {
  return Buffer.from(key.toString('hex')).toString('base64')
}

/** 下行 URL：full_url 优先，否则用 CDN 网关拼。 */
export function mediaDownloadUrl(media, cdnBaseUrl = DEFAULT_CDN_BASE_URL) {
  const full = typeof media?.full_url === 'string' ? media.full_url.trim() : ''
  if (full !== '') return full
  const param = typeof media?.encrypt_query_param === 'string' ? media.encrypt_query_param.trim() : ''
  if (param === '') throw new Error('微信媒体缺少 CDN 下载地址')
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(param)}`
}

/** 上行 URL：upload_full_url 优先，否则用 upload_param + filekey 拼。 */
export function mediaUploadUrl(upload, filekey, cdnBaseUrl = DEFAULT_CDN_BASE_URL) {
  const full = typeof upload?.upload_full_url === 'string' ? upload.upload_full_url.trim() : ''
  if (full !== '') return full
  const param = typeof upload?.upload_param === 'string' ? upload.upload_param.trim() : ''
  if (param === '') throw new Error('微信没有返回 CDN 上传地址')
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(param)}&filekey=${encodeURIComponent(filekey)}`
}

/** 文件 md5（hex）。 */
export function md5Hex(data) {
  return createHash('md5').update(Buffer.from(data)).digest('hex')
}

/**
 * 从魔数判断图片类型（DSH attachments 只接受 png/jpeg/webp/gif）。
 * @throws 无法识别时抛出可读错误（不猜扩展名）
 */
export function detectImageMediaType(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const startsWith = (prefix) => prefix.every((byte, index) => bytes[index] === byte)
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  throw new Error('微信图片格式不受支持（只接受 png / jpeg / webp / gif）')
}
