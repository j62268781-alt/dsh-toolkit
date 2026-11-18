import { fetchJson } from "../../../client/http.js";
import { SOUND_PATH, SOUNDS_PATH } from "../host/constants.js";
import { SoundPlayer, SOUND_IDS, audioSupported, clampVolume } from "./sounds.js";

export const SOUND_CATALOG_URL = SOUNDS_PATH;
export const SOUND_AUDIO_URL = SOUND_PATH;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function loadSystemSounds() {
  const response = await fetchJson(SOUND_CATALOG_URL);
  if (!response.ok) throw new Error(`Sound catalog HTTP ${response.status}`);
  const catalog = await response.json();
  return {
    platform: catalog.platform,
    sounds: (Array.isArray(catalog.sounds) ? catalog.sounds : []).filter((entry) => (
      typeof entry?.id === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(entry.id) && typeof entry.label === "string"
    )),
  };
}

/** Authenticated system files play in this window and use the application's volume. */
export class SystemSoundPlayer extends SoundPlayer {
  /** 已解码的音效文件，按 id 缓存（上限 8 条，见 playFile）。 */
  buffers: Map<string, AudioBuffer>;

  /** 正在播放的节点，卸载时要逐个 stop。 */
  sources: Set<AudioBufferSourceNode>;

  /** 在途的下载请求，卸载时要 abort。 */
  requests: Set<AbortController>;

  /**
   * 缓存代数：空闲关闭时自增。在途的 fetch/decode 回来后代数对不上，
   * 就不会把「旧上下文解码出来的 PCM」又塞回已经清空的缓存里。
   */
  cacheGeneration: number;

  constructor(volumeOf, idleMs?) {
    super(volumeOf, idleMs);
    this.buffers = new Map();
    this.sources = new Set();
    this.requests = new Set();
    this.cacheGeneration = 0;
  }

  override play(id, volume) {
    if (SOUND_IDS.includes(id)) return super.play(id, volume);
    const level = clampVolume(volume === undefined ? this.volumeOf() : volume);
    if (this.disposed || id === "none" || level <= 0 || !audioSupported() || !/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) return false;
    // Dispatch is synchronous: true means the asynchronous playback was accepted.
    void this.playFile(id, level).catch(() => false);
    return true;
  }

  async preview(id, volume) {
    if (SOUND_IDS.includes(id)) return super.play(id, volume);
    try { return await this.playFile(id, clampVolume(volume === undefined ? this.volumeOf() : volume)) } catch { return false }
  }

  async playFile(id, level) {
    if (this.disposed || level <= 0 || !/^[a-zA-Z0-9:_-]{1,128}$/.test(id)) return false;
    // 先记下代数：空闲关闭若发生在下面的 resume / await 期间，这一轮必须放弃。
    const generation = this.cacheGeneration;
    const context = this.contextOf();
    if (context === null) return false;
    // Resume before the first await so a Preview click retains its user gesture.
    if (context.state === "suspended") await context.resume();
    let buffer = id === "system" ? undefined : this.buffers.get(id);
    if (!buffer) {
      const controller = new AbortController();
      this.requests.add(controller);
      try {
        const response = await fetch(`${SOUND_AUDIO_URL}?id=${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok || Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) return false;
        const bytes = await response.arrayBuffer();
        if (this.disposed || bytes.byteLength > MAX_AUDIO_BYTES || bytes.byteLength === 0) return false;
        buffer = await context.decodeAudioData(bytes);
        if (!buffer || buffer.duration > 30 || this.disposed || generation !== this.cacheGeneration) return false;
        if (id !== "system") {
          if (this.buffers.size >= 8) this.buffers.delete(this.buffers.keys().next().value);
          this.buffers.set(id, buffer);
        }
      } finally { this.requests.delete(controller) }
    }
    // 空闲关闭可能发生在等待 I/O 期间：旧上下文已经关掉，这一轮就当播放失败。
    if (this.disposed || generation !== this.cacheGeneration) return false;
    if (context.state === "suspended") await context.resume();
    if (this.disposed || context.state === "suspended") return false;
    if (this.suspendTimer !== null) { clearTimeout(this.suspendTimer); this.suspendTimer = null }
    // 真正开始播放前取消空闲关闭：否则它可能在声音放完之前关掉上下文。
    this.cancelIdleClose();
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = level;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect(); gain.disconnect();
      if (!this.disposed && this.sources.size === 0) this.scheduleSuspend(0.15);
    };
    source.start();
    return true;
  }

  /**
   * 空闲关闭时由基类调用：丢掉解码后的 PCM（这是最大的一块常驻内存），
   * 并终止在途请求与播放。之后再次播放会重新 fetch + decode。
   */
  override releaseCachedAudio() {
    this.cacheGeneration += 1;
    this.buffers.clear();
    for (const request of this.requests) {
      try { request.abort() } catch { /* Already settled. */ }
    }
    this.requests.clear();
    for (const source of this.sources) {
      try { source.stop() } catch { /* Already ended. */ }
    }
    this.sources.clear();
  }

  override dispose() {
    this.releaseCachedAudio();
    super.dispose();
  }
}
