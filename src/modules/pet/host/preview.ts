/** Petdex 画廊的宠物预览图：每只一条 1152x208 的 webp（idle 前 6 帧横排）。
 *
 *  设置页要直接显示宠物样式，但精灵表本体动辄 2–8MB，一页几十个结果显然不能每行都拉。
 *  这里只取官方那张几十 KB 的预览条，按 slug 落盘到 `$DSH_HOME/toolkit/pet/cache/previews/`，
 *  再由插件的受认证路由原样回给页面 —— 页面不直连外网，离线时仍能用已缓存的图。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSlug } from './petdex.js'

export const PETDEX_ASSETS = 'https://assets.petdex.dev'
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_CACHED = 240

function isWebp(bytes: Buffer): boolean {
  return bytes.length > 12
    && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
}

export function previewPath(root: string, slug: string): string {
  return join(root, 'cache', 'previews', `${slug}.webp`)
}

export interface PreviewOptions {
  root: string
  fetchImpl?: typeof globalThis.fetch
  baseUrl?: string
  timeoutMs?: number
  maxBytes?: number
}

/** 一个 slug 一张图：内存命中 → 磁盘命中 → 下载。失败一律返回 null，不抛。
 *
 *  `root` 是唯一必填项，但保留 `= {}` 默认值：历史上允许无参调用，
 *  那种情况下每次 `get()` 都会在 `previewPath()` 里抛错并被就地吞成 null。
 */
export function createPreviewStore({ root, fetchImpl = globalThis.fetch, baseUrl = PETDEX_ASSETS, timeoutMs = 15000, maxBytes = MAX_PREVIEW_BYTES }: PreviewOptions = {} as PreviewOptions) {
  const memory = new Map<string, Buffer>()
  const remember = (slug: string, bytes: Buffer): Buffer => {
    memory.delete(slug)
    memory.set(slug, bytes)
    // 有界内存缓存：画廊一次能翻几十只，别无限涨。
    while (memory.size > MAX_CACHED) memory.delete(memory.keys().next().value as string)
    return bytes
  }
  const readCache = async (slug: string): Promise<Buffer | null> => {
    try {
      const bytes = await readFile(previewPath(root, slug))
      return isWebp(bytes) ? remember(slug, bytes) : null
    } catch {
      return null
    }
  }
  return {
    async get(slug: string): Promise<Buffer | null> {
      if (!isSlug(slug)) return null
      if (memory.has(slug)) return memory.get(slug) ?? null
      const cached = await readCache(slug)
      if (cached) return cached
      try {
        const response = await fetchImpl(`${baseUrl}/pets/${slug}/preview.webp`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'image/webp,image/*;q=0.8' },
        })
        if (!response?.ok) return null
        const length = Number(response.headers?.get?.('content-length'))
        if (Number.isFinite(length) && length > maxBytes) return null
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!bytes.length || bytes.length > maxBytes || !isWebp(bytes)) return null
        await mkdir(join(root, 'cache', 'previews'), { recursive: true })
        const temp = `${previewPath(root, slug)}.${process.pid}.tmp`
        await writeFile(temp, bytes)
        await rename(temp, previewPath(root, slug))
        return remember(slug, bytes)
      } catch {
        return null
      }
    },
  }
}
