import { access, chmod, mkdir, mkdtemp, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { dshHome } from '../../../host/dsh-home.js'

export const ELECTRON_VERSION = '43.3.0'

/** 下载在整条流水线里占的百分比；剩下的留给校验、解压和精简。 */
const DOWNLOAD_SHARE = 88

/**
 * 准备运行时的进度，百分比是**整条流水线**的进度（下载 → 解压 → 精简）。
 *
 * 客户端把它画成一条进度条：一次 138MB 的下载如果只有状态文字，用户看到的就是
 * 「一直在安装」。
 */
export interface RuntimeProgress {
  phase: 'download' | 'unpack' | 'tidy' | 'done'
  percent: number
  /** 已下载字节数，只有 `phase === 'download'` 时有意义。 */
  received?: number
  /** 服务器给出的总字节数；没有 Content-Length 时为 0。 */
  total?: number
}
export type RuntimeProgressListener = (progress: RuntimeProgress) => void

/** 同一个运行时目录只允许一次下载；失败后从表里移除，允许下次重试。 */
const preparing = new Map<string, Promise<string | undefined>>()

/** 解压时的暂存目录前缀；`prepare()` 正常结束会自己删掉，只有进程被强杀才会残留。 */
const STAGING_PREFIX = '.prepare-'

/**
 * 残留暂存目录的清理门槛。
 *
 * 不按「存在就删」处理：另一台/另一进程的宿主机可能正往里面解压，删掉会把一次
 * 正常的准备变成失败。解压 + 精简只需几分钟，一小时前的目录不可能是活跃的。
 */
const STAGING_MAX_AGE = 60 * 60 * 1000

export function executableIn(directory: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(directory, platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron')
}

async function executable(file: string): Promise<boolean> {
  try { if (!(await stat(file)).isFile()) return false; await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true } catch { return false }
}

export function runtimeDirectory(): string {
  return path.join(dshHome(), 'toolkit', 'pet', 'electron', `${ELECTRON_VERSION}-${process.platform}-${process.arch}`)
}

export interface ResolveElectronOptions {
  electronPath?: string
  download?: boolean
  /** 下载/解压进度；宿主转成 `runtime.progress` 推给设置页。 */
  onProgress?: RuntimeProgressListener
}

function scale(received: number, total: number): number {
  if (!total) return 0
  return Math.min(DOWNLOAD_SHARE, Math.round((received / total) * DOWNLOAD_SHARE))
}

/**
 * 给 `@electron/get` 用的自定义下载器：默认的 got 下载器不暴露字节进度，
 * 换成 fetch 流自己写文件，顺便按 Content-Length 报百分比。
 *
 * 其余职责（mirror、校验和、临时目录）仍然留给 `@electron/get`。
 *
 * @param idleMs 多久没有新字节就判定链路断了。不按总时长掐：实测国内直连 GitHub
 *   只有 ~20KB/s，138MB 要一个小时，按总时长会稳定地把能下载的包判死。
 */
export function progressDownloader(report: RuntimeProgressListener, idleMs = 60_000) {
  return {
    async download(url: string, targetFilePath: string, _options: any = {}): Promise<void> {
      const controller = new AbortController()
      let timer: NodeJS.Timeout | undefined
      const arm = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => controller.abort(new Error(`Electron download stalled: no data for ${Math.round(idleMs / 1000)}s`)), idleMs)
        timer.unref?.()
      }
      arm()
      const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
      if (!response.ok || !response.body) {
        if (timer) clearTimeout(timer)
        throw new Error(`Electron download failed: HTTP ${response.status}`)
      }
      const total = Number(response.headers.get('content-length')) || 0
      const file = await open(targetFilePath, 'w')
      let received = 0
      let last = -1
      try {
        const reader = response.body.getReader()
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (!chunk.value?.byteLength) continue
          arm()
          await file.write(chunk.value)
          received += chunk.value.byteLength
          const percent = scale(received, total)
          // 只有整数百分比变化才上报：一次下载约 100 条，SSE 与渲染都扛得住。
          if (percent !== last) { last = percent; report({ phase: 'download', percent, received, total }) }
        }
      } finally {
        if (timer) clearTimeout(timer)
        await file.close()
      }
      if (total && received !== total) throw new Error(`Electron download was truncated (${received} of ${total} bytes)`)
    },
  }
}

/** Chromium 的界面语言包文件名（`en-US.pak`、`zh-CN.pak`、`ja.pak`…）。 */
const LOCALE_PACK = /^(?:[a-z]{2,3}(?:[-_][A-Za-z]{2,4}){0,2})\.pak$/

/**
 * 去掉运行时里用不到的界面语言包。
 *
 * Electron 只发布整包（43.3.0 的 win32-x64 压缩包 137.7MB），没有官方精简版；
 * 真正能省的是 `locales/` 下除 en-US 之外的 .pak —— 它们只装 Chromium 的原生界面文案，
 * 而 helper 没有菜单、没有对话框。缺对应语言的 pak 时 Chromium 回落到 en-US。
 *
 * macOS 的本地化在 `Electron.app` 的 .lproj 里、跟着 Info.plist 走，整套跳过。
 */
export async function trimRuntime(directory: string, platform: NodeJS.Platform = process.platform): Promise<number> {
  if (platform === 'darwin') return 0
  const locales = path.join(directory, 'locales')
  let entries: string[]
  try { entries = await readdir(locales) } catch { return 0 }
  let freed = 0
  for (const name of entries) {
    // 只删语言包：`resources.pak` / `chrome_100_percent.pak` 是 Chromium 必需的资源包，删了起不来。
    if (name === 'en-US.pak' || !LOCALE_PACK.test(name)) continue
    const file = path.join(locales, name)
    try { freed += (await stat(file)).size; await rm(file) } catch { /* 少删一个不影响启动。 */ }
  }
  return freed
}

/**
 * 删掉 `prepare()` 遗留的暂存目录，返回删除的个数。
 *
 * 暂存目录是 `mkdtemp` 建的，宿主机被强制退出（升级、崩溃、系统关机）时 `finally`
 * 跑不到，就会把几百 KB 的半成品留在运行时目录旁边。只在运行时已就绪时清理：
 * 那时不会再有活跃的解压，删除不会打乱正在进行的准备。
 */
export async function cleanStaleStaging(parent: string, now = Date.now()): Promise<number> {
  let entries: string[]
  try { entries = await readdir(parent) } catch { return 0 }
  let removed = 0
  for (const name of entries) {
    if (!name.startsWith(STAGING_PREFIX)) continue
    const target = path.join(parent, name)
    try {
      const info = await stat(target)
      if (!info.isDirectory() || now - info.mtimeMs < STAGING_MAX_AGE) continue
      await rm(target, { recursive: true, force: true })
      removed += 1
    } catch { /* 单个目录删不掉（权限、竞态）不影响其他目录。 */ }
  }
  return removed
}

/** Download only on explicit preparation or when a desktop surface is enabled. */
export async function resolveElectron({ electronPath = '', download = false, onProgress }: ResolveElectronOptions = {}): Promise<string | undefined> {
  const explicit = electronPath || process.env.DSH_TOOLKIT_ELECTRON_PATH
  if (explicit) {
    if (!path.isAbsolute(explicit) || !await executable(explicit)) throw new Error('Electron executable must be an existing absolute executable path')
    return explicit
  }
  const directory = runtimeDirectory()
  const binary = executableIn(directory)
  if (await executable(binary)) {
    // 运行时已就绪：顺手收掉宿主被强杀时留下的 `.prepare-*` 暂存目录（几百 KB 一处，
    // 不影响功能，但会一直堆在用户目录里）。
    await cleanStaleStaging(path.dirname(directory))
    return binary
  }
  if (!download) return undefined
  if (!preparing.has(directory)) {
    // 同一个运行时目录只跑一次流水线（宿主是单例，进度经 state 广播给每个打开的设置页）。
    preparing.set(directory, (async () => {
      const report: RuntimeProgressListener = (progress) => { try { onProgress?.(progress) } catch { /* 回调异常不能影响下载。 */ } }
      report({ phase: 'download', percent: 0, received: 0, total: 0 })
      const [{ downloadArtifact, ElectronDownloadCacheMode }, { default: extract }] = await Promise.all([import('@electron/get'), import('extract-zip')])
      // 不用 `ReadWrite` 缓存：它会把 138MB 的压缩包再复制一份常驻 `%LOCALAPPDATA%\electron\Cache`。
      // 运行时目录本身已经是缓存，`Bypass` 之下临时 zip 归我们管，解压完立刻删。
      const archive = await downloadArtifact({
        version: ELECTRON_VERSION, artifactName: 'electron', platform: process.platform, arch: process.arch,
        cacheMode: ElectronDownloadCacheMode.Bypass,
        downloader: progressDownloader(report),
      })
      try {
        await mkdir(path.dirname(directory), { recursive: true })
        const staging = await mkdtemp(path.join(path.dirname(directory), '.prepare-'))
        try {
          report({ phase: 'unpack', percent: DOWNLOAD_SHARE })
          await extract(archive, { dir: staging })
          const stagedBinary = executableIn(staging)
          if (process.platform !== 'win32') await chmod(stagedBinary, 0o755)
          if (!await executable(stagedBinary)) throw new Error('Downloaded Electron archive has no executable')
          report({ phase: 'tidy', percent: 97 })
          await trimRuntime(staging)
          try { await rename(staging, directory) } catch (error) {
            if (!await executable(binary)) throw error
          }
        } finally {
          // 失败时别把半解压的运行时留在磁盘上（几百 MB）。
          await rm(staging, { recursive: true, force: true }).catch(() => {})
        }
        report({ phase: 'done', percent: 100 })
        return binary
      } finally {
        await rm(path.dirname(archive), { recursive: true, force: true }).catch(() => {})
      }
    })().finally(() => preparing.delete(directory)))
  }
  return preparing.get(directory)
}

export function helperEnvironment(url: string, token: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, DSH_TOOLKIT_PET_URL: url, DSH_TOOLKIT_PET_TOKEN: token, DSH_TOOLKIT_HOST_PID: String(process.pid) }
  delete result.ELECTRON_RUN_AS_NODE
  return result
}
