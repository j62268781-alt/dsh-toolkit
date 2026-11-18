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
 * AudioContext 是共享且懒创建的：播放结束就 suspend，避免闲置时一直占着系统音频流；
 * suspend 之后再过 `IDLE_CLOSE_MS` 没有任何播放，就 close 掉上下文并丢弃缓存，
 * 下次播放时懒重建。DSH 桌面端常驻约 2GB，提示音可能几小时才响一次 ——
 * 没理由让一个 AudioContext（以及子类解码后的 PCM）一直活到进程结束。
 *
 * 任何一步失败（无 AudioContext、自动播放策略、权限）都静默降级——提示音不该影响通知本身。
 */

/** 音效定义：每段是 { 频率, 起始秒, 时长秒, 波形, 增益 }。 */
export const SOUND_IDS = ["chime", "fault", "pop", "alert"];

/** 挂起之后再空闲这么久，就彻底关闭音频上下文（并让子类丢掉解码缓存）。 */
export const IDLE_CLOSE_MS = 10 * 60 * 1000;

/** 每个音效的合成参数。 */
export const SOUND_RECIPES = Object.freeze({
  chime: [
    { freq: 880, at: 0, dur: 0.12, type: "sine", gain: 0.7 },
    { freq: 1320, at: 0.1, dur: 0.18, type: "sine", gain: 0.6 },
  ],
  fault: [
    { freq: 300, at: 0, dur: 0.14, type: "sawtooth", gain: 0.35 },
    { freq: 190, at: 0.12, dur: 0.24, type: "sawtooth", gain: 0.3 },
  ],
  pop: [
    { freq: 620, at: 0, dur: 0.08, type: "sine", gain: 0.55 },
  ],
  alert: [
    { freq: 1040, at: 0, dur: 0.1, type: "square", gain: 0.22 },
    { freq: 780, at: 0.12, dur: 0.14, type: "square", gain: 0.22 },
  ],
});

/** 音效的总时长（秒），用于决定何时 suspend 音频上下文。 */
export function recipeDuration(recipe) {
  let end = 0;
  for (const segment of recipe ?? []) end = Math.max(end, (Number(segment.at) || 0) + (Number(segment.dur) || 0));
  return end;
}

/** 是否支持 Web Audio。 */
export function audioSupported() {
  try {
    return typeof globalThis.AudioContext === "function" || typeof globalThis.webkitAudioContext === "function";
  } catch {
    return false;
  }
}

/**
 * 提示音播放器。
 *
 * 音量在播放时读取（`volumeOf()`），所以拖音量滑块不需要重建播放器。
 */
export class SoundPlayer {
  /** 读取当前音量（0..1）的注入函数；每次播放都重新求值。 */
  volumeOf: () => number;

  /** 共享的音频上下文，首次播放时懒创建。 */
  context: AudioContext | null;

  /** 卸载标记：置位后不再创建上下文，空闲关闭也不再排程。 */
  disposed: boolean;

  /** 播放结束后挂起上下文的定时器。 */
  suspendTimer: ReturnType<typeof setTimeout> | null;

  /** 空闲多久彻底关闭上下文；可被测试注入更短的值，缺省 `IDLE_CLOSE_MS`。 */
  idleMs: number;

  /** 挂起之后排下的空闲关闭定时器（到期 close 上下文并清缓存）。 */
  idleTimer: ReturnType<typeof setTimeout> | null;

  /**
   * @param {() => number} volumeOf 读取当前音量（0..1）。
   * @param {number} [idleMs] 挂起后空闲多久彻底关闭上下文，缺省 `IDLE_CLOSE_MS`。
   */
  constructor(volumeOf, idleMs = IDLE_CLOSE_MS) {
    this.volumeOf = typeof volumeOf === "function" ? volumeOf : () => 0.6;
    this.context = null;
    this.disposed = false;
    this.suspendTimer = null;
    // 测试可以传更短的值；非法输入退回默认，避免 idleTimer 变成「永不触发」。
    this.idleMs = Number.isFinite(idleMs) && idleMs > 0 ? idleMs : IDLE_CLOSE_MS;
    this.idleTimer = null;
  }

  /** 懒创建 AudioContext；失败返回 null（静默降级）。 */
  contextOf() {
    if (this.disposed) return null;
    if (this.context !== null) return this.context;
    try {
      const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (typeof Ctor !== "function") return null;
      this.context = new Ctor();
      return this.context;
    } catch {
      return null;
    }
  }

  /**
   * 播放一个内置音效。
   * @param {string} id 音效 id（`none` 静音）。
   * @param {number} [volume] 本次音量；缺省读 `volumeOf()`。
   * @returns {boolean} 是否真的开始播放。
   */
  play(id, volume) {
    if (id === "none" || !SOUND_IDS.includes(id)) return false;
    // 新的一次播放必须让空闲关闭让位：否则它可能在声音放完之前就把上下文关掉。
    this.cancelIdleClose();
    const context = this.contextOf();
    if (context === null) return false;
    try {
      if (context.state === "suspended" && typeof context.resume === "function") void context.resume();
    } catch {
      // 继续尝试排程；有的实现 resume 本身就是异步的。
    }
    const level = clampVolume(volume === undefined ? this.volumeOf() : volume);
    if (level <= 0) {
      // 静音播放不会排 suspend，也就没人再排空闲关闭；这里补上，别让上下文永不回收。
      this.armIdleClose();
      return false;
    }
    const recipe = SOUND_RECIPES[id];
    try {
      const start = context.currentTime + 0.01;
      // 固定响度增益：内置音都偏轻，乘一个常数后整体更清楚，同时靠软限幅避免削顶。
      const master = context.createGain();
      master.gain.value = level * 0.5;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      master.connect(limiter);
      limiter.connect(context.destination);
      for (const segment of recipe) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = segment.type;
        oscillator.frequency.value = segment.freq;
        envelope.gain.setValueAtTime(0.0001, start + segment.at);
        envelope.gain.exponentialRampToValueAtTime(segment.gain, start + segment.at + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + segment.at + segment.dur);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(start + segment.at);
        oscillator.stop(start + segment.at + segment.dur + 0.02);
      }
      this.scheduleSuspend(recipeDuration(recipe) + 0.35);
      return true;
    } catch {
      // 排程失败时上下文已经建出来了，同样要有人回收。
      this.armIdleClose();
      return false;
    }
  }

  /** 一次播放结束后挂起音频上下文，别让闲置通知一直占着系统音频流。 */
  scheduleSuspend(delaySeconds) {
    if (typeof setTimeout !== "function") return;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    // 新的播放会重排 suspend，原来的空闲关闭必须作废。
    this.cancelIdleClose();
    const delay = Math.max(50, Math.round(delaySeconds * 1000));
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      try {
        if (this.context !== null && this.context.state === "running") void this.context.suspend();
      } catch {
        // 忽略。
      }
      // 挂起只是让出音频流，上下文与解码缓存仍然常驻；再空一个窗口就彻底关掉。
      this.armIdleClose();
    }, delay);
  }

  /**
   * 挂起之后排一个空闲关闭定时器。
   * 上下文已经没了的（空闲关闭过 / 卸载过）不需要，也不会再建。
   */
  armIdleClose() {
    if (this.disposed || this.context === null || typeof setTimeout !== "function") return;
    this.cancelIdleClose();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.closeIdle();
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  /** 取消空闲关闭；新播放、dispose 都要先走这一步。 */
  cancelIdleClose() {
    if (this.idleTimer === null) return;
    try {
      clearTimeout(this.idleTimer);
    } catch {
      // 忽略。
    }
    this.idleTimer = null;
  }

  /**
   * 空闲到期：关闭上下文并让子类丢掉缓存。
   * 已经关闭过的、非 running 状态的、close 抛错的都按正常路径处理 ——
   * 这里只是回收一次内存，失败不该冒泡到任何调用方。
   */
  closeIdle() {
    if (this.disposed) return;
    const context = this.context;
    this.context = null;
    try {
      this.releaseCachedAudio();
    } catch {
      // 缓存清理失败不影响上下文释放。
    }
    closeQuietly(context);
  }

  /**
   * 丢弃解码后的音频缓存。基类没有缓存（内置音是实时合成的），子类覆盖。
   * 在空闲关闭时由基类调用，必须能在播放中途/请求在途时安全失败。
   */
  releaseCachedAudio(): void {}

  /** 插件卸载：停掉所有定时器并丢弃上下文，释放系统音频流。 */
  dispose() {
    this.disposed = true;
    if (this.suspendTimer !== null) {
      try {
        clearTimeout(this.suspendTimer);
      } catch {
        // 忽略。
      }
      this.suspendTimer = null;
    }
    this.cancelIdleClose();
    const context = this.context;
    this.context = null;
    closeQuietly(context);
  }
}

/** 关闭 AudioContext：已关闭的、实现返回 rejected promise 的，都不往上抛。 */
function closeQuietly(context: AudioContext | null) {
  if (context === null || typeof context.close !== "function") return;
  try {
    // 对已经 closed 的上下文再 close 会抛/拒绝；回收过一次就够了。
    if (context.state === "closed") return;
    const closing = context.close();
    if (closing && typeof closing.catch === "function") closing.catch(() => {});
  } catch {
    // 关闭失败只意味着这轮回收没成功；下次播放会重新懒创建。
  }
}

/** 把任意音量收窄到 0..1。 */
export function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}
