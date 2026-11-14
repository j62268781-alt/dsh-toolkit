/**
 * 提示音：用 Web Audio 实时合成的四个短音，不携带任何音频文件。
 *
 * 这样做的好处是插件体积与授权都不需要为音频再开一道口子（没有素材版权、没有打包资产），
 * 代价是每次播放要自己搭一小段振荡器包络。四个音分别是：
 *   chime  完成：两个上行的正弦音，偏「叮咚」；
 *   fault  失败：一声下行的锯齿低鸣；
 *   pop    待回答：一个极短的轻响；
 *   alert  授权：两声方波警示。
 *
 * AudioContext 是共享且懒创建的：播放结束就 suspend，避免闲置时一直占着系统音频流。
 * 任何一步失败（无 AudioContext、自动播放策略、权限）都静默降级——提示音不该影响通知本身。
 */

/** 音效定义：每段是 { 频率, 起始秒, 时长秒, 波形, 增益 }。 */
export const SOUND_IDS = ['chime', 'fault', 'pop', 'alert']

/** 每个音效的合成参数。 */
export const SOUND_RECIPES = Object.freeze({
  chime: [
    { freq: 880, at: 0, dur: 0.12, type: 'sine', gain: 0.7 },
    { freq: 1320, at: 0.1, dur: 0.18, type: 'sine', gain: 0.6 },
  ],
  fault: [
    { freq: 300, at: 0, dur: 0.14, type: 'sawtooth', gain: 0.35 },
    { freq: 190, at: 0.12, dur: 0.24, type: 'sawtooth', gain: 0.3 },
  ],
  pop: [
    { freq: 620, at: 0, dur: 0.08, type: 'sine', gain: 0.55 },
  ],
  alert: [
    { freq: 1040, at: 0, dur: 0.1, type: 'square', gain: 0.22 },
    { freq: 780, at: 0.12, dur: 0.14, type: 'square', gain: 0.22 },
  ],
})

/** 音效的总时长（秒），用于决定何时 suspend 音频上下文。 */
export function recipeDuration(recipe) {
  let end = 0
  for (const segment of recipe ?? []) end = Math.max(end, (Number(segment.at) || 0) + (Number(segment.dur) || 0))
  return end
}

/** 是否支持 Web Audio。 */
export function audioSupported() {
  try {
    return typeof globalThis.AudioContext === 'function' || typeof globalThis.webkitAudioContext === 'function'
  } catch {
    return false
  }
}

/**
 * 提示音播放器。
 *
 * 音量在播放时读取（`volumeOf()`），所以拖音量滑块不需要重建播放器。
 */
export class SoundPlayer {
  /** 读取当前音量（0..1）的注入函数；每次播放都重新求值。 */
  volumeOf: () => number

  /** 共享的音频上下文，首次播放时懒创建。 */
  context: AudioContext | null

  /** 卸载标记：置位后不再创建上下文。 */
  disposed: boolean

  /** 播放结束后挂起上下文的定时器。 */
  suspendTimer: ReturnType<typeof setTimeout> | null

  /**
   * @param {() => number} volumeOf 读取当前音量（0..1）。
   */
  constructor(volumeOf) {
    this.volumeOf = typeof volumeOf === 'function' ? volumeOf : () => 0.6
    this.context = null
    this.disposed = false
    this.suspendTimer = null
  }

  /** 懒创建 AudioContext；失败返回 null（静默降级）。 */
  contextOf() {
    if (this.disposed) return null
    if (this.context !== null) return this.context
    try {
      const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext
      if (typeof Ctor !== 'function') return null
      this.context = new Ctor()
      return this.context
    } catch {
      return null
    }
  }

  /**
   * 播放一个内置音效。
   * @param {string} id 音效 id（`none` 静音）。
   * @param {number} [volume] 本次音量；缺省读 `volumeOf()`。
   * @returns {boolean} 是否真的开始播放。
   */
  play(id, volume) {
    if (id === 'none' || !SOUND_IDS.includes(id)) return false
    const context = this.contextOf()
    if (context === null) return false
    try {
      if (context.state === 'suspended' && typeof context.resume === 'function') void context.resume()
    } catch {
      // 继续尝试排程；有的实现 resume 本身就是异步的。
    }
    const level = clampVolume(volume === undefined ? this.volumeOf() : volume)
    if (level <= 0) return false
    const recipe = SOUND_RECIPES[id]
    try {
      const start = context.currentTime + 0.01
      // 固定响度增益：内置音都偏轻，乘一个常数后整体更清楚，同时靠软限幅避免削顶。
      const master = context.createGain()
      master.gain.value = level * 0.5
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -8
      limiter.knee.value = 6
      limiter.ratio.value = 12
      master.connect(limiter)
      limiter.connect(context.destination)
      for (const segment of recipe) {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        oscillator.type = segment.type
        oscillator.frequency.value = segment.freq
        envelope.gain.setValueAtTime(0.0001, start + segment.at)
        envelope.gain.exponentialRampToValueAtTime(segment.gain, start + segment.at + 0.012)
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + segment.at + segment.dur)
        oscillator.connect(envelope)
        envelope.connect(master)
        oscillator.start(start + segment.at)
        oscillator.stop(start + segment.at + segment.dur + 0.02)
      }
      this.scheduleSuspend(recipeDuration(recipe) + 0.35)
      return true
    } catch {
      return false
    }
  }

  /** 一次播放结束后挂起音频上下文，别让闲置通知一直占着系统音频流。 */
  scheduleSuspend(delaySeconds) {
    if (typeof setTimeout !== 'function') return
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer)
    const delay = Math.max(50, Math.round(delaySeconds * 1000))
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null
      try {
        if (this.context !== null && this.context.state === 'running') void this.context.suspend()
      } catch {
        // 忽略。
      }
    }, delay)
  }

  /** 插件卸载：挂起并丢弃上下文，释放系统音频流。 */
  dispose() {
    this.disposed = true
    if (this.suspendTimer !== null) {
      try {
        clearTimeout(this.suspendTimer)
      } catch {
        // 忽略。
      }
      this.suspendTimer = null
    }
    const context = this.context
    this.context = null
    try {
      if (context !== null && typeof context.close === 'function') void context.close()
    } catch {
      // 忽略。
    }
  }
}

/** 把任意音量收窄到 0..1。 */
export function clampVolume(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(1, Math.max(0, number))
}
