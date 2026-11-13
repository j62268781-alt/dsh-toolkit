import { access, chmod, mkdir, mkdtemp, rename, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const ELECTRON_VERSION = '43.3.0'

/** 同一个运行时目录只允许一次下载；失败后从表里移除，允许下次重试。 */
const preparing = new Map<string, Promise<string | undefined>>()

export function executableIn(directory: string, platform: NodeJS.Platform = process.platform): string {
  return path.join(directory, platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron')
}

async function executable(file: string): Promise<boolean> {
  try { if (!(await stat(file)).isFile()) return false; await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true } catch { return false }
}

export function runtimeDirectory(): string {
  return path.join(process.env.DSH_HOME || path.join(homedir(), '.dsh'), 'toolkit', 'pet', 'electron', `${ELECTRON_VERSION}-${process.platform}-${process.arch}`)
}

export interface ResolveElectronOptions {
  electronPath?: string
  download?: boolean
}

/** Download only on explicit preparation or when a desktop surface is enabled. */
export async function resolveElectron({ electronPath = '', download = false }: ResolveElectronOptions = {}): Promise<string | undefined> {
  const explicit = electronPath || process.env.DSH_TOOLKIT_ELECTRON_PATH
  if (explicit) {
    if (!path.isAbsolute(explicit) || !await executable(explicit)) throw new Error('Electron executable must be an existing absolute executable path')
    return explicit
  }
  const directory = runtimeDirectory()
  const binary = executableIn(directory)
  if (await executable(binary)) return binary
  if (!download) return undefined
  if (!preparing.has(directory)) {
    preparing.set(directory, (async () => {
      const [{ downloadArtifact }, { default: extract }] = await Promise.all([import('@electron/get'), import('extract-zip')])
      const archive = await downloadArtifact({
        version: ELECTRON_VERSION, artifactName: 'electron', platform: process.platform, arch: process.arch,
        downloadOptions: { timeout: { connect: 30_000, response: 60_000, socket: 60_000, request: 600_000 }, retry: { limit: 1 } },
      })
      await mkdir(path.dirname(directory), { recursive: true })
      const staging = await mkdtemp(path.join(path.dirname(directory), '.prepare-'))
      await extract(archive, { dir: staging })
      const stagedBinary = executableIn(staging)
      if (process.platform !== 'win32') await chmod(stagedBinary, 0o755)
      if (!await executable(stagedBinary)) throw new Error('Downloaded Electron archive has no executable')
      try { await rename(staging, directory) } catch (error) {
        if (!await executable(binary)) throw error
      }
      return binary
    })().finally(() => preparing.delete(directory)))
  }
  return preparing.get(directory)
}

export function helperEnvironment(url: string, token: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, DSH_TOOLKIT_PET_URL: url, DSH_TOOLKIT_PET_TOKEN: token, DSH_TOOLKIT_HOST_PID: String(process.pid) }
  delete result.ELECTRON_RUN_AS_NODE
  return result
}
