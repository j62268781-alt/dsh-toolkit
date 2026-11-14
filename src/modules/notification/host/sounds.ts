import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdtemp, open, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { httpFailure } from '../../../host/routes.js'

export const MAX_SOUND_BYTES = 4 * 1024 * 1024
const runFile = promisify(execFileCallback)
const commandOptions = { timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true }
// 走共享的 HttpFailure 通道：路由层据此决定状态码，别再各自挂 statusCode 属性。
const missing = () => httpFailure(404, 'sound-not-found')
const unavailable = () => httpFailure(503, 'sound-unavailable')

/** One playable file the platform actually offers, with the root it must stay under. */
export interface SoundEntry {
  id: string
  label: string
  file: string
  root: string
}

export interface SoundCatalogEntry {
  id: string
  label: string
}

export interface SoundServiceOptions {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  directories?: string[]
  execFile?: typeof runFile
  tempDirectory?: string
}

export interface SoundService {
  getCatalog(): Promise<{ platform: NodeJS.Platform; sounds: SoundCatalogEntry[] }>
  readSound(id: unknown): Promise<{ bytes: Buffer; contentType: string }>
}

function audioResult(bytes: Buffer, extension: string) {
  const wav = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
  const mp3 = bytes.length >= 3 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
  if (extension === '.mp3' ? !mp3 : !wav) throw unavailable()
  return { bytes, contentType: extension === '.mp3' ? 'audio/mpeg' : 'audio/wav' }
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

// Inject only platform boundaries; all file validation also runs against test fixtures.
export function createSoundService({
  platform = process.platform,
  home = homedir(),
  env = process.env,
  directories = platform === 'darwin'
    ? ['/System/Library/Sounds', path.join(home, 'Library', 'Sounds')]
    : platform === 'win32' ? [path.join(env.WINDIR ?? 'C:\\Windows', 'Media')] : [],
  execFile = runFile,
  tempDirectory = tmpdir(),
}: SoundServiceOptions = {}): SoundService {
  const supported = platform === 'darwin' || platform === 'win32'
  const extensions = platform === 'darwin' ? /\.(aiff?|caf|wav|mp3)$/i : /\.(wav|mp3)$/i

  async function catalog(): Promise<SoundEntry[]> {
    if (!supported) return []
    const entries: SoundEntry[] = []
    for (const directory of directories) {
      let root: string, names: string[]
      try {
        root = await realpath(directory)
        names = await readdir(root)
      } catch { continue }
      for (const name of names.sort()) {
        if (!extensions.test(name)) continue
        const file = path.join(root, name)
        try {
          const info = await lstat(file)
          if (!info.isFile() || info.size === 0 || info.size > MAX_SOUND_BYTES) continue
          const canonical = await realpath(file)
          if (!contained(root, canonical)) continue
          entries.push({
            id: createHash('sha256').update(`${platform}\0${file}`).digest('hex').slice(0, 32),
            label: path.basename(name, path.extname(name)),
            file, root,
          })
        } catch { /* A disappearing or unreadable file is not a sound choice. */ }
      }
    }
    return entries
  }

  async function defaultSound(entries: SoundEntry[]): Promise<SoundEntry | undefined> {
    const match = async (file: string): Promise<SoundEntry | undefined> => {
      let canonical: string
      try { canonical = await realpath(file) } catch { return undefined }
      return entries.find((entry) => platform === 'win32'
        ? entry.file.toLowerCase() === canonical.toLowerCase()
        : entry.file === canonical)
    }
    if (platform === 'darwin') {
      try {
        const { stdout } = await execFile('/usr/bin/defaults', ['read', '-g', 'com.apple.sound.beep.sound'], commandOptions)
        const selected = await match(String(stdout).trim())
        if (selected) return selected
      } catch { /* Use a real catalog sound when the preference is absent. */ }
      return entries.find((entry) => path.basename(entry.file).toLowerCase() === 'funk.aiff') ?? entries[0]
    }
    for (const event of ['Notification.Default', '.Default']) {
      try {
        const key = `HKCU\\AppEvents\\Schemes\\Apps\\.Default\\${event}\\.Current`
        const { stdout } = await execFile('reg.exe', ['query', key, '/ve'], commandOptions)
        const value = String(stdout).match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i)?.[1]?.trim()
        if (!value) continue
        const expanded = value.replace(/%([^%]+)%/g, (token: string, name: string) => {
          const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
          return key ? (env[key] ?? token) : token
        }).replace(/^"(.*)"$/, '$1')
        const selected = await match(expanded)
        if (selected) return selected
      } catch { /* Try the older default event, then the standard media file. */ }
    }
    return entries.find((entry) => path.basename(entry.file).toLowerCase() === 'winnotifysystemgeneric.wav')
  }

  async function readBounded(file: string): Promise<Buffer> {
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size === 0 || info.size > MAX_SOUND_BYTES) throw unavailable()
      const bytes = Buffer.alloc(Math.min(info.size + 1, MAX_SOUND_BYTES + 1))
      let length = 0
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length !== info.size) throw unavailable()
      return bytes.subarray(0, length)
    } finally { await handle.close() }
  }

  return {
    async getCatalog() {
      const entries = await catalog()
      return {
        platform,
        sounds: supported ? [{ id: 'system', label: 'System default' }, ...entries.map(({ id, label }) => ({ id, label }))] : [],
      }
    },
    async readSound(id: unknown) {
      if (!supported || typeof id !== 'string' || (id !== 'system' && !/^[a-f0-9]{32}$/.test(id))) throw missing()
      const entries = await catalog()
      const entry = id === 'system' ? await defaultSound(entries) : entries.find((entry) => entry.id === id)
      if (!entry) throw id === 'system' ? unavailable() : missing()
      let temporary: string | undefined
      try {
        const canonical = await realpath(entry.file)
        if (!contained(entry.root, canonical) || canonical !== entry.file) throw unavailable()
        const bytes = await readBounded(entry.file)
        const extension = path.extname(entry.file).toLowerCase()
        if (extension === '.wav' || extension === '.mp3') {
          return audioResult(bytes, extension)
        }
        temporary = await mkdtemp(path.join(tempDirectory, 'dsh-notification-'))
        // Convert a bounded private copy so afconvert never follows a swapped source link.
        const input = path.join(temporary, `source${extension}`)
        const output = path.join(temporary, 'sound.wav')
        await writeFile(input, bytes, { flag: 'wx', mode: 0o600 })
        await execFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', input, output], commandOptions)
        return audioResult(await readBounded(output), '.wav')
      } catch { throw unavailable() }
      finally { if (temporary) await rm(temporary, { recursive: true, force: true }) }
    },
  }
}
