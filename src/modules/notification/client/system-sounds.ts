import { fetchJson } from '../../../client/http.js'
import { SOUND_PATH, SOUNDS_PATH } from '../host/constants.js'
import { SoundPlayer, SOUND_IDS, audioSupported, clampVolume } from './sounds.js'

export const SOUND_CATALOG_URL = SOUNDS_PATH
export const SOUND_AUDIO_URL = SOUND_PATH
const MAX_AUDIO_BYTES = 8 * 1024 * 1024

export async function loadSystemSounds() {
  const response = await fetchJson(SOUND_CATALOG_URL)
  if (!response.ok) throw new Error(`Sound catalog HTTP ${response.status}`)
  const catalog = await response.json()
  return {
    platform: catalog.platform,
    sounds: (Array.isArray(catalog.sounds) ? catalog.sounds : []).filter((entry) => (
      typeof entry?.id === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(entry.id) && typeof entry.label === 'string'
    )),
  }
}

/** Authenticated system files play in this window and use the application's volume. */
export class SystemSoundPlayer extends SoundPlayer {
  /** 已解码的音效文件，按 id 缓存（上限 8 条，见 playFile）。 */
  buffers: Map<string, AudioBuffer>

  /** 正在播放的节点，卸载时要逐个 stop。 */
  sources: Set<AudioBufferSourceNode>

  /** 在途的下载请求，卸载时要 abort。 */
  requests: Set<AbortController>

  constructor(volumeOf) {
    super(volumeOf)
    this.buffers = new Map()
    this.sources = new Set()
    this.requests = new Set()
  }

  override play(id, volume) {
    if (SOUND_IDS.includes(id)) return super.play(id, volume)
    const level = clampVolume(volume === undefined ? this.volumeOf() : volume)
    if (this.disposed || id === 'none' || level <= 0 || !audioSupported() || !/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) return false
    // Dispatch is synchronous: true means the asynchronous playback was accepted.
    void this.playFile(id, level).catch(() => false)
    return true
  }

  async preview(id, volume) {
    if (SOUND_IDS.includes(id)) return super.play(id, volume)
    try { return await this.playFile(id, clampVolume(volume === undefined ? this.volumeOf() : volume)) } catch { return false }
  }

  async playFile(id, level) {
    if (this.disposed || level <= 0 || !/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) return false
    const context = this.contextOf()
    if (context === null) return false
    // Resume before the first await so a Preview click retains its user gesture.
    if (context.state === 'suspended') await context.resume()
    let buffer = id === 'system' ? undefined : this.buffers.get(id)
    if (!buffer) {
      const controller = new AbortController()
      this.requests.add(controller)
      try {
        const response = await fetch(`${SOUND_AUDIO_URL}?id=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) return false
        const bytes = await response.arrayBuffer()
        if (this.disposed || bytes.byteLength > MAX_AUDIO_BYTES || bytes.byteLength === 0) return false
        buffer = await context.decodeAudioData(bytes)
        if (!buffer || buffer.duration > 30 || this.disposed) return false
        if (id !== 'system') {
          if (this.buffers.size >= 8) this.buffers.delete(this.buffers.keys().next().value)
          this.buffers.set(id, buffer)
        }
      } finally { this.requests.delete(controller) }
    }
    if (this.disposed) return false
    if (context.state === 'suspended') await context.resume()
    if (this.disposed || context.state === 'suspended') return false
    if (this.suspendTimer !== null) { clearTimeout(this.suspendTimer); this.suspendTimer = null }
    const source = context.createBufferSource()
    const gain = context.createGain()
    gain.gain.value = level
    source.buffer = buffer
    source.connect(gain)
    gain.connect(context.destination)
    this.sources.add(source)
    source.onended = () => {
      this.sources.delete(source)
      source.disconnect(); gain.disconnect()
      if (!this.disposed && this.sources.size === 0) this.scheduleSuspend(0.15)
    }
    source.start()
    return true
  }

  override dispose() {
    for (const request of this.requests) request.abort()
    this.requests.clear()
    for (const source of this.sources) { try { source.stop() } catch { /* Already ended. */ } }
    this.sources.clear()
    this.buffers.clear()
    super.dispose()
  }
}
