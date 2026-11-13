import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Petdex 是一份公开的像素宠物目录（https://petdex.dev），包格式与 Codex 桌宠一致：
// 一个 pet.json 描述形象，一张 8 列精灵表。这里把它做成「内置安装器」：
// 插件自己下载、校验、落盘，用户不需要另外安装 CLI。
export const PETDEX_BASE = 'https://petdex.dev'
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SHEET_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}\.(?:png|webp)$/
const VERSIONS: Record<number, number> = { 1: 9, 2: 11 }
const CELL = { width: 192, height: 208 }
const MAX_SHEET_BYTES = 8 * 1024 * 1024
const MAX_PET_JSON_BYTES = 256 * 1024
const CATALOG_TTL = 60 * 60 * 1000

/** pet.json 里渲染需要、且能被安全落盘的字段。 */
export interface PetManifest {
  id: string
  displayName: string
  description?: string | undefined
  spritesheetPath: string
  spriteVersionNumber: number
}

export type ValidateResult = { ok: true; manifest: PetManifest } | { ok: false; reason: string }

/** 目录里的一只宠物（还没安装）。 */
export interface CatalogPet {
  slug: string
  displayName: string
  spritesheet: string
  petJson: string
  spriteVersionNumber: number
}

export interface Catalog {
  assetBase: string
  total: number
  pets: CatalogPet[]
}

export interface InstalledPet {
  slug: string
  dir: string
  manifest: PetManifest
  sheetFile: string
}

export interface SkippedPet {
  slug: string
  reason: string
}

export interface InstallProgress {
  slug?: string | undefined
  phase: string
  percent: number
}

export interface InstallOptions {
  slug?: string
  petUrl?: string
  sheetUrl?: string
  root?: string
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
  maxSheetBytes?: number
  onProgress?: (progress: InstallProgress) => void
}

export type InstallResult =
  | { ok: true; slug: string; dir: string; manifest: PetManifest; sheetFile: string }
  | { ok: false; reason: string }

const message = (error: any): string => String(error && error.message || error || 'Unknown error')

/** 显式类型谓词：loose 程序（`strictNullChecks:false`）不会按 `ok` 判别式自动收窄 `!checked.ok`。 */
function failed(result: ValidateResult): result is { ok: false; reason: string } {
  return !result.ok
}

export function isSlug(value: any): boolean {
  return typeof value === 'string' && SLUG_PATTERN.test(value)
}

/** 只读头部就能拿到尺寸：PNG 的 IHDR、WebP 的 VP8/VP8L/VP8X，不需要图像库。 */
export function parseImageSize(bytes: any): { format: string; width: number; height: number } | null {
  if (!bytes || typeof bytes.length !== 'number') return null
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 24 && png.every((byte, index) => bytes[index] === byte) && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    if (chunk === 'VP8 ') {
      if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) return null
      return { format: 'webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    }
    if (chunk === 'VP8L') {
      if (bytes[20] !== 0x2f) return null
      const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24]
      return { format: 'webp', width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) }
    }
    if (chunk === 'VP8X') {
      const read = (offset: number): number => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
      return { format: 'webp', width: 1 + read(24), height: 1 + read(27) }
    }
  }
  return null
}

/** 校验非 https、越界这些「下载器不该被喂进来的东西」。 */
export function resolveAssetUrl(base: any, relative: any): string | null {
  if (typeof relative !== 'string' || !relative || /^[a-z][a-z0-9+.-]*:/i.test(relative)) return null
  if (relative.includes('..') || relative.includes('\\')) return null
  let origin
  try { origin = new URL(base) } catch { return null }
  if (origin.protocol !== 'https:') return null
  let url
  try { url = new URL(relative, origin) } catch { return null }
  if (url.protocol !== 'https:' || url.origin !== origin.origin) return null
  return url.href
}

/** pet.json 只保留渲染需要、且能被安全落盘的字段。 */
export function validatePetJson(value: any, slug: any): ValidateResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'pet.json is not an object' }
  if (!isSlug(slug)) return { ok: false, reason: 'Invalid pet id' }
  // 身份以目录名（清单里的 slug）为准：Petdex 里有一批「同图不同名」的包，pet.json 的 id 仍是原始宠物的 slug。
  // 只要求它本身是个合法 slug，不做相等校验，否则 boba-2 / boba-6 这类永远装不上。
  if (value.id !== undefined && !isSlug(value.id)) return { ok: false, reason: 'pet.json id is invalid' }
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : ''
  if (!displayName || displayName.length > 80) return { ok: false, reason: 'pet.json displayName is invalid' }
  const spritesheetPath = typeof value.spritesheetPath === 'string' ? value.spritesheetPath.trim() : ''
  if (!SHEET_PATTERN.test(spritesheetPath)) return { ok: false, reason: 'pet.json spritesheetPath is invalid' }
  const version = value.spriteVersionNumber == null ? 1 : value.spriteVersionNumber
  if (!Object.hasOwn(VERSIONS, version)) return { ok: false, reason: 'pet.json spriteVersionNumber must be 1 or 2' }
  const description = typeof value.description === 'string' ? value.description.slice(0, 500) : undefined
  return { ok: true, manifest: { id: slug, displayName, description, spritesheetPath, spriteVersionNumber: version } }
}

function normalizeEntries(rows: any, fields: any): CatalogPet[] {
  const pets: CatalogPet[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const record = Array.isArray(row) ? Object.fromEntries(fields.map((field: any, index: number) => [field, row[index]])) : row
    if (!record || typeof record !== 'object') continue
    const slug = record.slug
    if (!isSlug(slug)) continue
    const spritesheet = typeof record.spritesheet === 'string' ? record.spritesheet : ''
    const petJson = typeof record.petJson === 'string' ? record.petJson : ''
    if (!spritesheet || !petJson) continue
    const version = record.spriteVersionNumber == null ? 1 : Number(record.spriteVersionNumber)
    pets.push({
      slug,
      displayName: typeof record.displayName === 'string' && record.displayName.trim() ? record.displayName.trim() : slug,
      spritesheet,
      petJson,
      spriteVersionNumber: Object.hasOwn(VERSIONS, version) ? version : 1,
    })
  }
  return pets
}

/** 同时接受 v2（fields + 数组行）与旧版 /api/manifest（对象行）；坏数据只丢那一条。 */
export function parseManifest(value: any): Catalog {
  const assetBase = typeof value?.assetBase === 'string' && value.assetBase ? value.assetBase : `${PETDEX_BASE}/assets`
  const fields = Array.isArray(value?.fields) ? value.fields : ['slug', 'displayName', 'kind', 'submittedBy', 'spritesheet', 'petJson', 'zip', 'spriteVersionNumber']
  const pets = normalizeEntries(value?.pets, fields)
  return { assetBase, total: pets.length, pets }
}

async function requestJson(fetchImpl: typeof globalThis.fetch, url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally { clearTimeout(timer) }
}

interface DownloadOptions {
  timeoutMs: number
  maxBytes: number
  onProgress?: ((loaded: number, total: number) => void) | undefined
}

async function download(fetchImpl: typeof globalThis.fetch, url: string, { timeoutMs, maxBytes, onProgress }: DownloadOptions): Promise<Buffer> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Petdex assets must use https')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(parsed.href, { signal: controller.signal, redirect: 'follow', headers: { accept: '*/*' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Asset is too large')
    const total = Number.isFinite(declared) && declared > 0 ? declared : 0
    // 精灵表约 2.4MB，按块读才能把「下到百分之几」报出去；拿不到 body 的环境（测试的 fetch stub）退回一次性读。
    const stream = response.body
    if (stream && typeof stream.getReader === 'function') {
      const reader = stream.getReader()
      const chunks: Buffer[] = []
      let loaded = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        const bytes = Buffer.from(chunk.value)
        loaded += bytes.length
        if (loaded > maxBytes) { await reader.cancel().catch(() => {}); throw new Error('Asset is too large') }
        chunks.push(bytes)
        onProgress?.(loaded, total)
      }
      return Buffer.concat(chunks)
    }
    if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
      const chunks: Buffer[] = []
      let loaded = 0
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk)
        loaded += bytes.length
        if (loaded > maxBytes) throw new Error('Asset is too large')
        chunks.push(bytes)
        onProgress?.(loaded, total)
      }
      return Buffer.concat(chunks)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('Asset is too large')
    onProgress?.(bytes.length, total || bytes.length)
    return bytes
  } finally { clearTimeout(timer) }
}

export interface CatalogOptions {
  fetchImpl?: typeof globalThis.fetch
  baseUrl?: string
  timeoutMs?: number
  cacheMs?: number
  now?: () => number
}

export interface CatalogListOptions {
  force?: boolean
}

/**
 * 目录缓存：设置页搜索/滚动时不该每次都打网络。`list({ force: true })` 给「刷新」按钮用。
 */
export function createCatalog({ fetchImpl = globalThis.fetch, baseUrl = PETDEX_BASE, timeoutMs = 15000, cacheMs = CATALOG_TTL, now = Date.now }: CatalogOptions = {}): { list(options?: CatalogListOptions): Promise<Catalog> } {
  let cached: Catalog | undefined
  let fetchedAt = 0
  let pending: Promise<Catalog> | undefined
  const load = async (): Promise<Catalog> => {
    for (const path of ['/api/manifest/v2', '/api/manifest']) {
      try {
        const value = await requestJson(fetchImpl, new URL(path, baseUrl).href, timeoutMs)
        const manifest = parseManifest(value)
        if (manifest.pets.length) return manifest
      } catch {}
    }
    throw new Error('Petdex catalog unavailable')
  }
  return {
    async list({ force = false }: CatalogListOptions = {}): Promise<Catalog> {
      if (!force && cached && now() - fetchedAt < cacheMs) return cached
      pending ??= load().then((value) => { cached = value; fetchedAt = now(); return value }).finally(() => { pending = undefined })
      return pending
    },
  }
}

/** 宠物库的「全部 / 已安装 / 未安装」筛选：纯函数，服务端按它切 matched 与分页。 */
export function filterCatalog(pets: CatalogPet[], installed: any, filter: any = 'all'): CatalogPet[] {
  const mode = ['all', 'installed', 'missing'].includes(filter) ? filter : 'all'
  if (mode === 'all' || !(installed instanceof Set)) return pets
  return pets.filter((pet) => installed.has(pet.slug) === (mode === 'installed'))
}

/** 安装一只宠物：先下到临时目录、校验通过后再原子替换目标目录。 */
export async function installPet({ slug, petUrl, sheetUrl, root, fetchImpl = globalThis.fetch, timeoutMs = 30000, maxSheetBytes = MAX_SHEET_BYTES, onProgress }: InstallOptions = {}): Promise<InstallResult> {
  if (!isSlug(slug)) return { ok: false, reason: 'Invalid pet id' }
  // 进度按「解析 8% / 下载精灵表 82% / 校验 4% / 落盘 6%」分配；回调异常不影响安装本身。
  const report = (phase: string, percent: number): void => {
    try { onProgress?.({ slug, phase, percent: Math.max(0, Math.min(100, Math.round(percent))) }) } catch {}
  }
  if (typeof root !== 'string' || !root) return { ok: false, reason: 'Missing install root' }
  const target = join(root, slug as string)
  const temp = join(root, `.tmp-${slug}-${randomUUID().slice(0, 8)}`)
  try {
    await mkdir(temp, { recursive: true })
    report('manifest', 2)
    // 调用方（受认证路由 / 安装器）总会给出两个 https 地址；缺了就是 new URL 抛错 → 走下面的 catch。
    const petBytes = await download(fetchImpl, petUrl as string, { timeoutMs, maxBytes: MAX_PET_JSON_BYTES, onProgress: (loaded, total) => report('manifest', total ? 2 + 6 * loaded / total : 5) })
    report('manifest', 8)
    let raw
    try { raw = JSON.parse(petBytes.toString('utf8')) } catch { throw new Error('pet.json is not valid JSON') }
    const checked = validatePetJson(raw, slug)
    if (failed(checked)) throw new Error(checked.reason)
    report('download', 10)
    const sheetBytes = await download(fetchImpl, sheetUrl as string, { timeoutMs, maxBytes: maxSheetBytes, onProgress: (loaded, total) => report('download', total ? 10 + 80 * loaded / total : 10) })
    report('download', 90)
    const size = parseImageSize(sheetBytes)
    if (!size) throw new Error('spritesheet is not a PNG or WebP image')
    const rows = VERSIONS[checked.manifest.spriteVersionNumber]
    if (size.width % 8 !== 0 || size.width / 8 !== CELL.width || size.height !== CELL.height * rows) throw new Error(`spritesheet is ${size.width}x${size.height}; expected ${CELL.width * 8}x${CELL.height * rows}`)
    report('install', 94)
    const sheetFile = checked.manifest.spritesheetPath
    await writeFile(join(temp, 'pet.json'), petBytes)
    await writeFile(join(temp, sheetFile), sheetBytes)
    await rm(target, { recursive: true, force: true })
    await rename(temp, target)
    report('done', 100)
    return { ok: true, slug: slug as string, dir: target, manifest: checked.manifest, sheetFile }
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    return { ok: false, reason: message(error) }
  }
}

/** 列出已安装的宠物；读不动的目录进 skipped，交给设置页提示。 */
export async function listInstalled(root: string): Promise<{ pets: InstalledPet[]; skipped: SkippedPet[] }> {
  if (typeof root !== 'string' || !root) return { pets: [], skipped: [] }
  let entries: Dirent[]
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return { pets: [], skipped: [] } }
  const pets: InstalledPet[] = []
  const skipped: SkippedPet[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSlug(entry.name)) continue
    const dir = join(root, entry.name)
    try {
      const checked = validatePetJson(JSON.parse(await readFile(join(dir, 'pet.json'), 'utf8')), entry.name)
      if (failed(checked)) throw new Error(checked.reason)
      const sheetFile = checked.manifest.spritesheetPath
      const info = await stat(join(dir, sheetFile))
      if (!info.isFile() || info.size > MAX_SHEET_BYTES) throw new Error('spritesheet is missing or too large')
      pets.push({ slug: entry.name, dir, manifest: checked.manifest, sheetFile })
    } catch (error) {
      skipped.push({ slug: entry.name, reason: message(error) })
    }
  }
  return { pets, skipped }
}

export async function removePet(root: string, slug: any): Promise<boolean> {
  if (typeof root !== 'string' || !root || !isSlug(slug)) return false
  const target = join(root, slug)
  try {
    const info = await stat(target)
    if (!info.isDirectory()) return false
    await rm(target, { recursive: true, force: true })
    return true
  } catch { return false }
}
