/**
 * 通知引擎：把「会话在跑 → 跑完」和「出现待交互」这两种边沿，分类成一条通知事件。
 *
 * 引擎是纯逻辑 + 注入端口（通知的端口由 index.jsx 接到真实的 ctx 服务上，测试里用假端口），
 * 所以它可以在没有 DOM、没有宿主服务的 node 测试里完整跑一遍。
 *
 * 判定规则（与参考实现同源，但标题/正文按本模块的约定调整）：
 *   - running 由 false→true 时「开跑」：只记失败基线，不通知；
 *   - running 由 true→false 时「可能结束」：等一个 settle 窗口，再读一次事实快照；
 *     期间新增了 turn-error 或 lastAgentError 变化 → 失败，否则完成；
 *   - 失败永不被推迟；完成在 `main-wait` 范围下要等所有后代子会话跑完（hold）；
 *   - 宿主还会自己续跑（排队输入 / goal 轮次）时，这个空闲边沿只是暂停，不通知；
 *   - 待交互按 `pendingInteraction.key` 变化触发：出现或替换才通知，消失不通知。
 */

/** 一条分类完成的通知事件。 */
/**
 * @typedef {object} NotificationEvent
 * @property {'completed'|'failed'|'question'|'permission'} kind 提醒类型。
 * @property {string} sessionId 会话 id。
 * @property {string} title 通知标题（会话标题）。
 * @property {string} detail 通知正文素材（完成时是本轮最终回复，失败时是错误信息，待交互时是问题/工具）。
 */

/** 引擎依赖的端口。 */
/**
 * @typedef {object} EnginePorts
 * @property {(id: string) => object|undefined} detailOf 读取会话事实（无对话快照时也要返回可判定的对象）。
 * @property {(id: string) => Promise<object|undefined>} [ensureDetail] 物化未打开会话的对话快照，
 *   可返回物化期间读到的事实（best-effort）。
 * @property {(id: string) => string} titleOf 会话标题。
 * @property {() => Promise<void>} settle 结束后的等待窗口。
 * @property {(id: string) => boolean} isSubagent 是否子会话。
 * @property {(id: string) => boolean} hasRunningDescendants 是否还有在跑的后代会话。
 * @property {(id: string) => boolean} [hasUnfinishedWork] 宿主是否会自动续跑。
 * @property {(event: NotificationEvent) => void} emit 交出一条事件。
 */

/** 一轮运行的失败基线。 */
/**
 * @typedef {object} RunState
 * @property {number} baselineErrorSeq 开跑时已物化的最大 turn-error seq。
 * @property {string|null} baselineAgentError 开跑时的 lastAgentError。
 */

export class NotificationEngine {
  /**
   * @param {EnginePorts} ports 注入端口。
   */
  constructor(ports) {
    this.ports = ports
    /** @type {Map<string, boolean>} 上一次观察到的 running。 */
    this.prevRunning = new Map()
    /** @type {Map<string, RunState>} 进行中一轮的基线。 */
    this.runs = new Map()
    /** @type {Set<string>} 正在 settle 的会话，防止并发重入。 */
    this.settling = new Set()
    /** @type {Map<string, string>} 上一次观察到的待交互 key。 */
    this.pendingKeys = new Map()
    /** @type {Map<string, string>} 等后代跑完再发的完成通知。 */
    this.held = new Map()
    /** 通知范围，由配置同步进来。 */
    this.scope = 'main-wait'
  }

  /**
   * 更新通知范围。切到非 all 时清掉子会话跟踪，避免残留边沿；
   * 离开 main-wait 时把 hold 住的完成通知放行。
   * @param {'all'|'main'|'main-wait'} scope 通知范围。
   */
  setScope(scope) {
    const previous = this.scope
    this.scope = scope
    if (scope !== 'all') this.forgetSubagents()
    if (previous === 'main-wait' && scope !== 'main-wait') this.releaseHeld()
  }

  /** 本轮是否已被范围静音（非 all 范围里的子会话）。 */
  silenced(id) {
    return this.scope !== 'all' && this.ports.isSubagent(id)
  }

  /** 完成通知是否需要等后代子会话都跑完。 */
  waitsFor(id) {
    return this.scope === 'main-wait' && this.ports.hasRunningDescendants(id)
  }

  /** 放行所有已 hold 的完成通知（后代都已停或范围不再等待）。 */
  releaseHeld() {
    for (const [id, detail] of [...this.held]) {
      // 宿主会自动续跑的会话没有「结束」可宣布。
      if (this.ports.hasUnfinishedWork?.(id) === true) {
        this.held.delete(id)
        continue
      }
      if (this.waitsFor(id)) continue
      this.held.delete(id)
      this.emit({ kind: 'completed', sessionId: id, title: this.ports.titleOf(id), detail })
    }
  }

  /** 丢掉所有子会话的跟踪状态（切到非 all 范围后不再观察它们）。 */
  forgetSubagents() {
    for (const id of new Set([...this.prevRunning.keys(), ...this.runs.keys(), ...this.pendingKeys.keys()])) {
      if (!this.ports.isSubagent(id)) continue
      this.prevRunning.delete(id)
      this.runs.delete(id)
      this.pendingKeys.delete(id)
      this.held.delete(id)
    }
  }

  /**
   * 首次观察前建立基线：记录当前 running 并为已在跑的会话打失败基线，
   * 但不发任何通知（插件加载前就空闲的会话不该补发）。
   * @param {object} sessions 会话列表快照 `{ byId }`。
   */
  seed(sessions) {
    for (const summary of Object.values(sessions?.byId ?? {})) {
      const id = summary?.id
      if (typeof id !== 'string' || this.silenced(id)) continue
      this.prevRunning.set(id, summary.running === true)
      if (summary.running === true) this.armRun(id)
    }
  }

  /**
   * 处理一次会话列表快照（列表每次变化都会调用）。
   * @param {object} sessions 会话列表快照 `{ byId }`。
   */
  observe(sessions) {
    const seen = new Set()
    for (const summary of Object.values(sessions?.byId ?? {})) {
      const id = summary?.id
      if (typeof id !== 'string') continue
      seen.add(id)
      if (this.silenced(id)) {
        this.prevRunning.delete(id)
        this.runs.delete(id)
        this.pendingKeys.delete(id)
        this.held.delete(id)
        continue
      }
      const running = summary.running === true
      const previous = this.prevRunning.get(id) ?? false
      if (previous && !running) void this.settleRun(id)
      else if (!previous && running) this.armRun(id)
      this.prevRunning.set(id, running)
    }
    // 会话消失了就清干净，避免同一 id 复用时的陈旧基线。
    for (const id of [...this.prevRunning.keys()]) {
      if (seen.has(id)) continue
      this.prevRunning.delete(id)
      this.runs.delete(id)
      this.pendingKeys.delete(id)
      this.held.delete(id)
    }
    // 刚好有后代停下来的，放行等待中的完成通知。
    this.releaseHeld()
  }

  /**
   * 建立待交互基线：只记录当前已存在的交互 key，不发通知。
   * 插件加载前就在等回答的会话不该补发一条提醒（和空闲会话同理）。
   * @param {ReadonlyMap<string, {key: string}>} pending 当前待交互。
   */
  seedPending(pending) {
    for (const [id, facts] of pending ?? []) {
      if (this.silenced(id)) continue
      if (typeof facts?.key === 'string') this.pendingKeys.set(id, facts.key)
    }
  }

  /**
   * 处理一次待交互快照。
   * @param {ReadonlyMap<string, {key: string, kind: 'question'|'permission', detail: string}>} pending 每个会话当前待交互。
   */
  observePending(pending) {
    for (const [id, facts] of pending ?? []) {
      if (this.silenced(id)) {
        this.pendingKeys.delete(id)
        continue
      }
      const previous = this.pendingKeys.get(id)
      if (previous === undefined || previous !== facts.key) {
        this.emit({ kind: facts.kind, sessionId: id, title: this.ports.titleOf(id), detail: facts.detail })
      }
      this.pendingKeys.set(id, facts.key)
    }
    for (const id of [...this.pendingKeys.keys()]) {
      if (!pending || !pending.has(id)) this.pendingKeys.delete(id)
    }
  }

  /** 开跑：记下失败基线；新一轮会作废上一轮还 hold 着的完成通知。 */
  armRun(id) {
    this.held.delete(id)
    const detail = this.safeDetailOf(id)
    this.runs.set(id, {
      baselineErrorSeq: Number(detail?.maxTurnErrorSeq) || 0,
      baselineAgentError: typeof detail?.lastAgentError === 'string' ? detail.lastAgentError : null,
    })
  }

  /** 读事实快照，读失败降级为 undefined（不能让一次失败读丢掉整条通知）。 */
  safeDetailOf(id) {
    try {
      return this.ports.detailOf(id)
    } catch {
      return undefined
    }
  }

  /**
   * 分类一个刚刚结束的会话。
   * @param {string} id 会话 id。
   */
  async settleRun(id) {
    const run = this.runs.get(id)
    if (run === undefined || this.settling.has(id)) return
    this.runs.delete(id)
    this.settling.add(id)
    try {
      await this.ports.settle()
      // settle 期间又开了新一轮：旧的一轮没有可宣布的结束。
      if (this.runs.has(id)) return
      if (this.silenced(id)) {
        this.prevRunning.delete(id)
        return
      }
      // 从未打开过的会话没有对话快照：先物化一次再读（best-effort）。
      // 端口可以把物化期间读到的事实直接返回，省掉一次「物化后快照已被释放」的竞态。
      let detail = this.safeDetailOf(id)
      try {
        const ensured = await this.ports.ensureDetail?.(id)
        if (ensured !== undefined) detail = ensured
        else if (this.ports.ensureDetail !== undefined) detail = this.safeDetailOf(id)
      } catch {
        // 读不到就按现有信息分类：失败判据里 lastAgentError 仍然可用。
      }
      const failed = detail !== undefined && (
        (Number(detail.maxTurnErrorSeq) || 0) > run.baselineErrorSeq
        || (typeof detail.lastAgentError === 'string' && detail.lastAgentError !== run.baselineAgentError)
      )
      if (failed) {
        // 失败需要立刻处理，不等子会话。
        this.held.delete(id)
        this.emit({
          kind: 'failed',
          sessionId: id,
          title: this.ports.titleOf(id),
          detail: detail.failureMessage ?? detail.lastAgentError ?? '',
        })
        return
      }
      // 宿主会自己续跑（排队输入 / goal 轮次）：这是暂停，不是结束。
      if (this.ports.hasUnfinishedWork?.(id) === true) return
      const finalText = typeof detail?.finalText === 'string' ? detail.finalText : ''
      if (this.waitsFor(id)) {
        this.held.set(id, finalText)
        return
      }
      this.emit({ kind: 'completed', sessionId: id, title: this.ports.titleOf(id), detail: finalText })
    } finally {
      this.settling.delete(id)
    }
  }

  /** 交出一条事件（统一入口，便于测试统计）。 */
  emit(event) {
    try {
      this.ports.emit(event)
    } catch {
      // 分发链路的问题不能反过来打断会话观察。
    }
  }
}
