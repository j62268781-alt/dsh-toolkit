# 参考实现拆解：dsh-session-notification 0.2.7（会话通知）

> 本文是**实现级规格**：我们（dsh-toolkit）要在自己的插件代码库里复刻同一套「会话状态通知」功能。
> 文中每一条结论都来自对参考仓库源码与行为测试的逐行阅读，不是从 README 转述。
>
> - 参考仓库：`D:\项目\dsh-session-notification-main`（npm 包 `@dingyi222666/dsh-session-notification`，version **0.2.7**，license **BSD-3-Clause**；`@deepseek-ai/dsh-*` 以 devDependencies `^0.2.1-rc.2` 声明，README 要求 dsh **>= 0.2.1-rc.2**；React 18 + TypeScript + tsdown + CSS Modules）
> - 目标仓库：`D:\项目\dsh-toolkit`（0.2.0，MIT，纯 JS/JSX + esbuild + React 19 + 普通 CSS + 自研多模块 client bundle）
> - 行号约定：文中 `src/...:123` 一律相对参考仓库根目录。本笔记只写 `docs/notification/reference-notes.md` 一个文件，未修改参考仓库，也未改动 `src/`、`tests/`、`lib/`、`scripts/`、`package.json`。

阅读顺序建议：**§2（事件模型）→ §3（回复文本抽取）→ §4（门控）→ §9（设置栏挂载/UI）→ §10（我们该怎么改）**；§5–§8 是实现细节库，需要时查表。

---

## 0. 一句话总览

浏览器半区是一个**纯客户端观察者**：

1. **引擎**（`NotificationEngine`）订阅两张快照——会话列表 `ctx.sessions.list`（`running` 位、标题、`origin`、`parentId`）和会话状态 `ctx.uiSession.sessionStatus`（待交互 `pendingInteraction`）——把「运行边沿」与「待交互边沿」翻译成 4 种事件（completed / failed / question / permission）；
2. 运行结束时有 250 ms **settle 窗口**等尾帧，然后读该会话的**对话快照节点**判定 completed 还是 failed（`turn-error` 序号 / 宿主 `lastAgentError` 是否比开跑时新），并把**最后一条 assistant 回复文本**作为 completed 的 detail；
3. **分发器**（`NotificationDispatcher`）按持久化偏好做门控（种类开关 → 当前会话提醒时机 → 声音选择 → 浏览器通知），交出去；
4. 系统通知走 `window.Notification`，点击回调里 `window.focus()` + 打开对应会话；
5. 多标签页用 `BroadcastChannel` 仲裁，只让一个标签页发一次；
6. 偏好存在 **localStorage**（不经宿主设置命名空间），跨标签页用 `storage` 事件同步。

没有任何宿主改动、没有任何轮询、没有新 wire 通道：全部是对已有客户端快照的边沿推断。

```
 ctx.sessions.list ──(running true→false)──┐
                                           ├─► NotificationEngine ──event──► NotificationDispatcher
 ctx.uiSession.sessionStatus ─(pending)────┘        ▲   │                          │
                                                    │   │ settle 250ms              ├─► SoundPlayer (WebAudio)
                      ctx.sessions.binding(id)      │   ▼                          └─► showBrowserNotification
                      ctx.uiConversation             │ detailOf(id)  ──► system Notification ──click──► focus + openSession
                        .binding(binding)            │
                        .activate('chat')            │
                        .target('chat').getSnapshot()┘
```

---

## 1. 架构总览与文件职责

### 1.1 三块

| 块 | 文件 | 职责 |
| --- | --- | --- |
| 宿主半区 | `src/index.ts` | **完全惰性**：`export function apply(_ctx){ }`（L25）。dsh 0.1.7 之后插件配置表单由 Loader 条目派生，本插件的偏好又是浏览器本地，所以宿主侧不 reserve 设置命名空间。只 re-export 常量/类型/`NotificationSettingsSchema`，留给未来宿主配置用。 |
| 共享常量（无依赖） | `src/settings.ts` | 命名空间、4 种 kind、3 种 current-session 模式、3 种通知范围模式、4+2 种音效 id、默认值、`resolveNotificationSettings()`（唯一解码器）、4 个 narrow 函数。**刻意不 import schemastery**，这样浏览器半区和 node 测试都能直接 import。 |
| 宿主 wire schema | `src/schema.ts` | `z.object({...})` 持久化形状（`sound` 不持久化 `custom`）；浏览器半区从不 import 它。 |
| 浏览器半区接线 | `src/client/index.ts`（346 行） | DI 装配：`inject` 服务表、locale 注册、local scope、store、SoundPlayer、TabCoordinator、Dispatcher、Engine、`settings.section` 注册、`inject` 工厂（权限申请 / 试听 / 上传自定义音频 / 测试通知）。**唯一碰 DOM 的文件之一**。 |
| 引擎 + 分发器 | `src/client/notification-service.ts`（490 行） | 纯逻辑、DOM-free：边沿检测、分类、分发门控、`sessionDetailOf`、`truncateTitle/Detail`。全部依赖注入。 |
| 偏好持久化 | `src/client/local-settings.ts`（162 行） | 用 localStorage 实现官方客户端设置契约 `ConfigForm`（`getSnapshot/subscribe/mutate/set/unset`）。 |
| 设置栏 store | `src/client/settings-store.ts`（100 行） | `defineStore` 的镜像 store，暴露 `adopt` + 各 setter，供 slot 的 `store` 契约使用。 |
| 设置栏 UI | `src/client/NotificationsSection.tsx`（455 行）+ `.module.css`（246 行） | 9 行设置项：5 个 master 行 + 4 个 kind 行；自绘 Switch / VolumeSlider，官方 `Menu` 做下拉。 |
| 系统通知 | `src/client/browser-notify.ts`（173 行） | `Notification` 包装：权限、图标解析、tag/renotify、点击 activate、desktop silent、失败重试。 |
| 声音 | `src/client/sounds.ts`（275 行） | Web Audio 合成 4 个音效 + 自定义音频播放 + 空闲挂起（省电/释放音频流）。 |
| 自定义音频存储 | `src/client/custom-audio.ts`（72 行） | 每 kind 一个 dataURL 存 localStorage，1 MiB 上限。 |
| 多标签仲裁 | `src/client/tab-coordinator.ts`（160 行） | `BroadcastChannel` 声明/胜出/去重 + 可见标签页优先。 |
| 文案 | `src/client/locales.ts`（117 行） | `zh` 为 key 全集（source of truth），`en` 用 `satisfies Record<NotificationsKey,string>` 强制对称。 |
| 行为测试 | `tests/*.spec.ts(x)`（8 个 spec + 1 个 primitives stub） | 引擎树、分发矩阵、浏览器通知、标签仲裁、声音、本地设置、设置栏渲染。 |

### 1.2 依赖注入端口（实现时可原样照搬的形状）

`NotificationEnginePorts`（`notification-service.ts:83-108`）：

| 端口 | 必填 | 接线（`client/index.ts`） |
| --- | --- | --- |
| `detailOf(id): SessionDetail \| undefined` | 是 | L155-181：`binding` → `uiConversation.binding()` → `activate('chat')` → `target('chat').getSnapshot()` → `sessionDetailOf()`；**try/catch 吞掉 generation 失效**。 |
| `ensureDetail?(id): Promise<void>` | 否 | L184-193：三处门控后 `ctx.sessions.using(id,{source:'sessionNotification'},async()=>{})`。 |
| `titleOf(id): string` | 是 | L194：`list.getSnapshot().byId[id]?.displayTitle ?? id`。 |
| `settle(): Promise<void>` | 是 | L211：`setTimeout(250)`（常量 `SETTLE_MS` L82）。 |
| `isSubagent(id): boolean` | 是 | L214-215：`byId[id]?.origin === 'subagent'`。 |
| `hasRunningDescendants(id): boolean` | 是 | L218-232：按 `parentId` 做 BFS。 |
| `hasUnfinishedWork?(id): boolean` | 否 | L199-210：`projectionsBySession[id].values.inbox/goal`。 |
| `emit(event): void` | 是 | L233-240：先 `coordinator.claim(\`${sessionId}:${kind}\`)`，赢了才 `dispatcher.dispatch`。 |

`NotificationDispatcherDeps`（`notification-service.ts:410-437`）：`settings()`、`t(key)`、`playSound(sound, customUrl?)`、`customSoundOf(kind)`、`showBrowser(title, body, tag, sessionId)`、`isCurrent(id)`、`isHidden()`、`hasFocus?()`。

> 设计要点：**引擎与分发器里没有 `window`/`document`/`localStorage`/`Notification`**。所有浏览器触点集中在 `client/index.ts`、`browser-notify.ts`、`local-settings.ts`、`sounds.ts`、`custom-audio.ts`、`tab-coordinator.ts`。这让我们能把这些逻辑放进 node 测试（参考仓库 `vitest.config.ts` 默认 `environment: 'node'`，只有 3 个 spec 用 `// @vitest-environment jsdom`）。

---

## 2. 事件模型（核心）

### 2.1 四种 kind：触发边沿、数据源、正文

常量与类型在 `src/settings.ts`：

```ts
// src/settings.ts:12
export const NOTIFICATION_TYPES = ['completed', 'failed', 'question', 'permission'] as const
```

```ts
// src/client/notification-service.ts:73-80
export interface NotificationEvent {
  kind: NotificationType
  sessionId: SessionId
  /** Human display title of the session. */
  title: string
  /** Kind-specific detail (error message, question text, tool name). */
  detail: string
}
```

| kind | 精确触发边沿 | 读取源 | `detail` 内容 | 默认音效 | 默认开关 |
| --- | --- | --- | --- | --- | --- |
| `completed` | 会话列表里同 id 的 `running` **true→false**，且 settle 后**未判失败**、`hasUnfinishedWork !== true`、`main-wait` 下无运行中后代（否则先 hold） | `sessions.list.byId[id].running` | `SessionDetail.finalText`（最后一条 assistant 回复） | `chime` | 开 |
| `failed` | 同上边沿，但 settle 后判失败（见 §2.3） | 同上 + 对话快照 `turn-error` + `session.lastAgentError` | `failureMessage ?? lastAgentError ?? ''` | `fault` | 开 |
| `question` | `uiSession.sessionStatus` 里该会话的 `pendingInteraction` **出现**（或 `key` 变化），且 `interaction.kind ∈ {'question','plan-review'}` | `ctx.uiSession.sessionStatus` | `questions[0].question`，否则 `''` | `pop` | 开 |
| `permission` | 同上，`interaction.kind === 'approval'` | 同上 | `interaction.toolName ?? ''` | `alert` | 开 |

关键点：**没有**「开始运行」通知、**没有**「交互消失/回答完毕」通知。只有「结束」和「来问你」两类。

`PendingFacts` 与 kind 折叠（`notification-service.ts:49-56`、`327-336`）：

```ts
/** One pending interaction's notification facts (from uiSession). */
export interface PendingFacts {
  /** Interaction identity; a replacement interaction carries a new key. */
  key: string
  /** Plugin notification kind: question covers 'question'/'plan-review'. */
  kind: 'question' | 'approval'
  /** Interaction detail text (question text / tool name). */
  detail: string
}
```

```ts
// src/client/notification-service.ts:327-336
private raise(kind: PendingFacts['kind'], id: SessionId, detail: string): void {
  this.ports.emit({
    // The plugin's four kinds fold the alpha 'approval' interaction into
    // the 'permission' kind (and 'question'/'plan-review' into 'question').
    kind: kind === 'approval' ? 'permission' : 'question',
    sessionId: id,
    title: this.ports.titleOf(id),
    detail,
  })
}
```

### 2.2 「running」到底怎么读

读的是**会话列表快照的 summary 位**，不是事件流：

```ts
// 形状（测试里 summary() 构造的最小字段集，tests/notification-engine.spec.ts:16-18）
{ id, displayTitle, running: boolean, blank, updatedAt }
```

接线（`client/index.ts:248-253`）：

```ts
ctx.effect(() => {
  const unsubscribe = ctx.sessions.list.subscribe(() => engine.observe(ctx.sessions.list.getSnapshot()))
  // Establish the baseline so pre-existing state raises nothing.
  engine.seed(ctx.sessions.list.getSnapshot())
  return unsubscribe
}, 'dsh-session-notification: session watch')
```

引擎内部的边沿判定（`notification-service.ts:185-216`，**逐字**）：

```ts
observe(sessions: SessionListState): void {
  const seen = new Set<SessionId>()
  for (const summary of Object.values(sessions.byId)) {
    const id = summary.id
    seen.add(id)
    if (this.silenced(id)) {
      // Never track a silenced subagent; drop any state left from when the
      // filter was off so no stale edge fires.
      this.prevRunning.delete(id)
      this.runs.delete(id)
      this.pendingKeys.delete(id)
      continue
    }
    const prevRunning = this.prevRunning.get(id) ?? false
    if (prevRunning && !summary.running) {
      void this.settleRun(id)
    } else if (!prevRunning && summary.running) {
      this.armRun(id)
    }
    this.prevRunning.set(id, summary.running)
  }
  for (const id of this.prevRunning.keys()) {
    if (!seen.has(id)) {
      this.prevRunning.delete(id)
      this.runs.delete(id)
      this.pendingKeys.delete(id)
      this.heldCompletions.delete(id)
    }
  }
  // A descendant may have just settled: release any completion waiting on it.
  this.releaseHeld()
}
```

要点：

- `prevRunning` 默认 `false`：**第一次看到某会话时，若它已在跑，`armRun` 会被调用（建立失败基线），但不会发完成通知**——因为 `armRun` 不 emit，只有真的 `true→false` 边沿才 `settleRun`。
- `seed()`（`notification-service.ts:224-231`）在首次订阅时执行：只记录 `prevRunning` 并对 running 的会话 `armRun`，**不 emit**。所以「插件加载前已在跑的会话」在它结束时**会**通知（基线是加载那一刻），「加载前已空闲」的会话**永远不**通知。
- 边沿检测是**基于快照差**，不是队列：同一 tick 里两次 observe 之间开始的运行若已经结束，理论上漏报（README 已知限制，宿主每个边沿都会下发状态帧，实际不发生）。
- 会话从列表消失：清 `prevRunning/runs/pendingKeys/heldCompletions`；重新出现时 `prev` 从 `false` 开始（测试 `forgets sessions that leave the list`，`tests/notification-engine.spec.ts:209-219`）。
- 遍历顺序是 `Object.values(byId)`，与 `ids` 数组顺序无关；**不要**依赖遍历顺序做任何事。

### 2.3 完成 vs 失败：基线 + settle + 双判据

#### 2.3.1 开跑时打基线（`armRun`，`notification-service.ts:256-265`）

```ts
/** Capture the pre-run failure baseline when a run starts. */
private armRun(id: SessionId): void {
  // A new run supersedes any completion still waiting on descendants.
  this.heldCompletions.delete(id)
  const detail = this.ports.detailOf(id)
  this.runs.set(id, {
    baselineErrorSeq: detail?.maxTurnErrorSeq ?? 0,
    baselineAgentError: detail?.lastAgentError ?? null,
  })
}
```

- `RunState`（`:110-114`）：`{ baselineErrorSeq: number; baselineAgentError: string | null }`。
- 基线读的是**当下**的 `maxTurnErrorSeq`（对话快照里所有 `turn-error` 节点的最大 seq）与 `lastAgentError`（宿主上报的 agent 错误）。
- 新 run 会**丢弃**该会话还挂着的 held completion。
- 注意：`detailOf` 可能返回 `undefined`（会话没 binding / 没打开），这时基线退化为 `0` / `null`。

#### 2.3.2 结束后分类（`settleRun`，`notification-service.ts:267-318`，**逐字**）

```ts
/** Classify a finished run after the settle window (completed vs failed). */
private async settleRun(id: SessionId): Promise<void> {
  const run = this.runs.get(id)
  if (run === undefined || this.settling.has(id)) return
  this.runs.delete(id)
  this.settling.add(id)
  try {
    await this.ports.settle()
    // A newer run armed while settling will classify itself; skip the stale one.
    if (this.runs.has(id)) return
    // The filter may have changed while settling (e.g. main-only re-enabled):
    // never emit for a session that is now silenced.
    if (this.silenced(id)) {
      this.prevRunning.delete(id)
      return
    }
    // A session the user never opened has no loaded history, so its chat
    // view holds no nodes yet; materialize it best-effort before reading.
    try {
      await this.ports.ensureDetail?.(id)
    } catch {
      // Best effort only: classify from whatever snapshot reads exist.
    }
    const detail = this.ports.detailOf(id)
    const failed = detail !== undefined && (
      detail.maxTurnErrorSeq > run.baselineErrorSeq ||
      (detail.lastAgentError !== null && detail.lastAgentError !== run.baselineAgentError)
    )
    const message = failed
      ? (detail?.failureMessage ?? detail?.lastAgentError ?? '')
      : (detail?.finalText ?? '')
    if (failed) {
      // A failure is actionable now: never hold it behind subagents.
      this.heldCompletions.delete(id)
      this.ports.emit({ kind: 'failed', sessionId: id, title: this.label(id, detail), detail: message })
      return
    }
    // The host resumes the session by itself: this idle edge is a pause, and
    // the continuation's own end classifies instead. Never hold the notice —
    // a superseded run has nothing left to announce.
    if (this.ports.hasUnfinishedWork?.(id) === true) return
    // Hold the completion while descendants still run: the session only
    // paused between subagent waves, so alert when the whole fan-out ends.
    if (this.waitsFor(id)) {
      this.heldCompletions.set(id, message)
      return
    }
    this.ports.emit({ kind: 'completed', sessionId: id, title: this.label(id, detail), detail: message })
  } finally {
    this.settling.delete(id)
  }
}
```

判据精确语义：

1. **settle 窗口 250 ms**（`SETTLE_MS`，`client/index.ts:82`）：等宿主把 `turn/end`、最后的 assistant 节点、可能的 `agent-error` 帧都送到，再读快照。窗口内**新的 run 已经开始**（`this.runs.has(id)`）则直接放弃本次分类——由新 run 自己分类，绝不产生「中途 pause 的假完成」。
2. **failed 需要 `detail !== undefined`**。没有对话快照就没有 `turn-error`，只能靠 `lastAgentError`；如果连 binding 都没有（`detailOf` 返回 `undefined`），一律按 completed（已知限制）。
3. **turn-error 判据是「比基线新」**：`maxTurnErrorSeq > baselineErrorSeq`。不是「存在任意 turn-error」——历史里早已失败的会话不会再判失败。
4. **agent-error 判据是「值变了且非 null」**：`lastAgentError !== null && lastAgentError !== baselineAgentError`。字符串比较；同一句话重复出现不会再次判失败（值相同）。
5. `failureMessage` 来自 `maxTurnErrorSeq` 最大的那个 `turn-error` 节点的 `message`（`sessionDetailOf` 里同步更新，见 §3.3）。
6. **失败永不被 hold、永不被「未完成工作」推迟**（测试 `never holds a failure behind subagents` `tests/notification-engine.spec.ts:291-303`、`never defers a failure behind incoming host work` `:390-402`）。
7. `settling` 集合防重入：同 id 不可能并发两次 settle（`settleRun` 入口先查）。
8. settle 期间被静音（用户把模式切到 main-only 而这是子会话）→ 删 `prevRunning` 并直接返回，不发通知。

#### 2.3.3 事件标题（`label`，`notification-service.ts:320-324`）

```ts
/** The run's latest user message, else the first-prompt session title. */
private label(id: SessionId, detail: SessionDetail | undefined): string {
  const text = truncateTitle(detail?.lastUserText ?? '')
  return text.length > 0 ? text : this.ports.titleOf(id)
}
```

即参考实现的 `title` **优先是「本轮最后一条人类用户消息」**（最多 60 字），没有才回落到会话标题。原因见测试注释（`tests/notification-engine.spec.ts:351-363`）：dsh 的会话标题由第一句 prompt 生成后不再更新，早就不代表当前话题。

> ⚠️ 这正是我们要改的地方之一（用户要求 title = 会话标题，回复文本作副标题），见 §10。
> ⚠️ 另外注意 **`releaseHeld()` 走的是 `titleOf(id)`**（`notification-service.ts:157`），不是 `label()`——held 释放出来的 completed 事件标题是会话标题，和即时 emit 的 `label()` 不一致。这是参考实现的内部不一致点；若我们把标题统一成会话标题，这个不一致自动消失。

### 2.4 `hasUnfinishedWork`：把「暂停」和「结束」区分开

宿主在空闲之后**会自己再开一轮**的两种情况：

- **inbox 里有排队项**：用户排队发送的后续输入（`next-turn`）或会在下一步注入的内容（`next-step`）；
- **goal 还有欠账轮次**：`goal.phase === 'active'` 且 `roundsStarted < maxGoalRounds`（到达轮次上限的 goal 被驱动挡下，不会自动续跑）。

接线（`client/index.ts:196-210`，**逐字**，含注释）：

```ts
// The host will resume this session by itself: a queued follow-up is
// claimed as the next turn, and a goal round is queued once the driver sees
// idle. The running bit is false in both gaps, so that idle edge is a
// pause, not an end. Read from the list snapshot to cover unopened sessions.
hasUnfinishedWork: (id) => {
  // Structural: the `inbox` and `goal` projection wire values, no host imports.
  const values = ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values as {
    inbox?: { 'next-turn'?: readonly unknown[], 'next-step'?: readonly unknown[] }
    goal?: { goal: { phase: string, maxGoalRounds: number }, roundsStarted: number } | null
  } | undefined
  const inbox = values?.inbox
  if ((inbox?.['next-turn']?.length ?? 0) > 0 || (inbox?.['next-step']?.length ?? 0) > 0) return true
  const goal = values?.goal
  // A goal that reached its round cap is blocked by the driver, not continued.
  return goal?.goal.phase === 'active' && goal.roundsStarted < goal.goal.maxGoalRounds
},
```

语义：

- 命中时**不 emit、也不 hold**——这次空闲边沿只是暂停，等续跑自己结束后再通知（测试 `stays silent when the host will start another turn by itself`，`tests/notification-engine.spec.ts:365-388`：清掉 unfinished work 后**也不会**补发晚到的完成通知；只有下一轮真正的 run 结束才响）。
- 对**失败**不生效（判失败在前面直接 return）。
- `releaseHeld()` 里也检查它（`notification-service.ts:150-154`）：排队的工作会让已 hold 的完成**被丢弃**，而不是等会。
- 读的是**列表快照的 projections**（`projectionsBySession[id].values`），所以未打开的会话也能读到。
- 这是**结构性读取**（`as` 断言 + 可选链），不 import 宿主类型；字段名是 wire 形状。**若我们目标 DSH 版本的 projection 键名不同，这里必须先用运行时打印确认。**

### 2.5 子会话与后代：静音、遗忘、等待

| 概念 | 实现 | 位置 |
| --- | --- | --- |
| 是不是子会话 | `byId[id]?.origin === 'subagent'` | `client/index.ts:214-215` |
| 静音（当前模式下子会话不提醒） | `mode !== 'all' && isSubagent(id)` | `notification-service.ts:161-164` |
| 模式变更时遗忘子会话状态 | `setNotificationMode(mode !== 'all') → forgetSubagents()`：删 `prevRunning/runs/pendingKeys` | `:137-145`、`:171-179` |
| 子会话是否会拖住父会话 | `waitsFor(id) = mode === 'main-wait' && hasRunningDescendants(id)` | `:166-169` |
| 后代是否在跑 | 按 `parentId` BFS，遇到任一 `running` 立刻 true | `client/index.ts:218-232` |

```ts
// src/client/index.ts:216-232
// Walk the parentId chain so a nested subagent keeps its root's completion
// held too (a subagent may itself fan out).
hasRunningDescendants: (id: SessionId) => {
  const byId = ctx.sessions.list.getSnapshot().byId
  const seen = new Set<SessionId>([id])
  const queue: SessionId[] = [id]
  while (queue.length > 0) {
    const parent = queue.shift() as SessionId
    for (const summary of Object.values(byId)) {
      if (summary.parentId !== parent || seen.has(summary.id)) continue
      seen.add(summary.id)
      if (summary.running) return true
      queue.push(summary.id)
    }
  }
  return false
},
```

三种范围模式（`NOTIFICATION_MODES`，`settings.ts:35`）的行为：

| 模式 | 子会话自己通知？ | 父会话完成何时响？ |
| --- | --- | --- |
| `all` | 是 | 立即（不等后代） |
| `main` | 否（且被遗忘跟踪） | 立即（不等后代） |
| `main-wait`（**默认**） | 否 | 等所有后代（含嵌套）都不 running 后再响一次；中间的空档 hold 住 |

「hold」不能无限：`observe()` 每次末尾 `releaseHeld()`，只要某一帧后代都不 running 就放。若会话又有新 run，`armRun` 丢弃 held。

静音的严格程度：**静音会话根本不进状态表**（`observe` 里 `continue` 前删掉 `prevRunning/runs/pendingKeys`）。所以「先 all 跑起来、中途切 main」不会留下陈旧边沿误报（测试 `forgets tracked subagents when main-only is re-enabled mid-run`，`:257-271`）。

### 2.6 held completions 生命周期（易错点）

```ts
// src/client/notification-service.ts:128-129
/** Completions held back until every descendant subagent has finished. */
private readonly heldCompletions = new Map<SessionId, string>()
```

值就是**完成文案**（`finalText`，分类时算好的），不是事件对象；释放时才补 `title`。

| 时机 | 动作 | 位置 |
| --- | --- | --- |
| `settleRun` 判定 completed 且 `waitsFor(id)` | `set(id, message)` | `:310-313` |
| `observe()` 每帧末尾 | `releaseHeld()` 尝试释放 | `:214-215` |
| `setNotificationMode` 离开 `main-wait` | `releaseHeld()` 立刻放（用户明确不想等了） | `:144` |
| `releaseHeld()` 中 `hasUnfinishedWork === true` | `delete` 并跳过（续跑会接管） | `:150-154` |
| `releaseHeld()` 中 `waitsFor(id)` 仍为真 | 保留，`continue` | `:155` |
| `releaseHeld()` 否则 | `delete` + `emit({kind:'completed', title: titleOf(id), detail})` | `:156-157` |
| `armRun`（新 run 开始） | `delete`（旧的完成被新 run 取代） | `:259` |
| 判 failed | `delete`（失败立即响） | `:300` |
| `settleRun` 遇 `hasUnfinishedWork` | 不 hold、直接 return（现在删除键也无害） | `:307` |
| 会话从列表消失 | `delete` | `:211` |

```ts
// src/client/notification-service.ts:147-159
/** Emit every held completion whose descendants have all settled. */
private releaseHeld(): void {
  for (const [id, detail] of [...this.heldCompletions]) {
    // Work that will continue the session has no end to announce yet.
    if (this.ports.hasUnfinishedWork?.(id) === true) {
      this.heldCompletions.delete(id)
      continue
    }
    if (this.waitsFor(id)) continue
    this.heldCompletions.delete(id)
    this.ports.emit({ kind: 'completed', sessionId: id, title: this.ports.titleOf(id), detail })
  }
}
```

测试锚点：`holds a main completion while subagents still run, then alerts once`（`:273-289`）、`releases a held completion when the wait is turned off`（`:318-330`）、`drops a held completion when a newer run starts`（`:332-349`）、`drops a subagent-held completion when the session will continue instead`（`:404-421`）。

### 2.7 待交互边沿（question / permission）

引擎侧（`notification-service.ts:238-254`，**逐字**）：

```ts
observePending(pending: ReadonlyMap<SessionId, PendingFacts>): void {
  for (const [id, facts] of pending) {
    if (this.silenced(id)) {
      this.pendingKeys.delete(id)
      continue
    }
    const prevKey = this.pendingKeys.get(id)
    if (prevKey === undefined || prevKey !== facts.key) {
      this.raise(facts.kind, id, facts.detail)
    }
    this.pendingKeys.set(id, facts.key)
  }
  for (const id of this.pendingKeys.keys()) {
    if (!pending.has(id)) this.pendingKeys.delete(id)
  }
}
```

接线侧把 `uiSession.sessionStatus` 投影成 `Map<SessionId, PendingFacts>`（`client/index.ts:259-279`，**逐字**）：

```ts
const pendingFactsOf = (statuses: SessionStatusSnapshot): Map<SessionId, PendingFacts> => {
  const out = new Map<SessionId, PendingFacts>()
  for (const [id, status] of statuses) {
    const interaction = status.pendingInteraction
    if (interaction === undefined) continue
    const kind = interaction.kind === 'approval'
      ? 'approval' as const
      : (interaction.kind === 'question' || interaction.kind === 'plan-review')
        ? 'question' as const
        : undefined
    if (kind === undefined) continue
    const questions = (interaction as unknown as { questions?: readonly { question?: string }[] }).questions
    const tool = (interaction as unknown as { toolName?: string }).toolName
    const detail = questions?.[0]?.question ?? tool ?? ''
    out.set(id, { key: interaction.key, kind, detail })
  }
  return out
}
ctx.effect(() => ctx.uiSession.sessionStatus.subscribe(() => {
  engine.observePending(pendingFactsOf(ctx.uiSession.sessionStatus.getSnapshot()))
}), 'dsh-session-notification: pending watch')
```

语义要点：

- 判定依据是 **`interaction.key` 变了**（出现、或替换成另一个交互），而不是「布尔出现/消失」。同一交互持续存在不会重复响（每次 sessionStatus 快照都会重新调用 `observePending`，但 key 不变就静默）。
- **交互消失不发通知**（用户已经答完）。
- `kind === 'approval'` → permission；`question` / `plan-review` → question；其它 kind（若有）忽略。
- detail 只有**第一个问题文本**（`questions[0].question`），否则 `toolName`，否则 `''`。README 说「工具名+原因」，**代码里没有 reason**。
- `seed` 不处理 pending：`sessionStatus` 的订阅只在登记后触发，首次快照若已有 pending 交互，会因为 `pendingKeys` 为空而**响一次**（`prevKey === undefined`）。README 声称「加载时已在等待交互的会话不会触发」，但**代码与 README 不完全一致**——若我们要严格对齐 README，需要给 `pendingKeys` 做一次 seed（用当前快照填充 key 而不 emit）。这是待确认的行为差异，建议实现时按「seed 静默」处理（更符合用户预期），并在测试里固定。
- `SessionStatusSnapshot` 里还有 `running` / `completionUnread` 字段，参考实现**没有用**（引擎的 running 读列表，未读数不参与通知）。

### 2.8 状态机（单会话视角）

```
                 (首次 snapshot / seed)
  ┌─────────────┐   running=false    ┌──────────┐
  │ UNTRACKED   │───────────────────►│  IDLE    │
  └─────────────┘                    └──────────┘
        │ running=true                    ▲
        ▼                                 │ settle 后非 failed / 非 hold / 非 unfinished
  ┌─────────────┐   running→false   ┌──────────┐
  │  RUNNING    │──────────────────►│ SETTLING │──failed──► emit(failed)
  │ (armed:     │     settleRun     │ (250ms)  │
  │  baseline)  │                   └──────────┘──waitForDesc──► HELD ──(后代停)──► emit(completed)
  └─────────────┘                                 │
                                                  └─hasUnfinishedWork─► 静默（等续跑）
```

### 2.9 观察到但容易踩的细节

1. `observe()` 里 `this.runs` 的清理只在「新 run arm」与「settle 消费」时发生；**没 settle 的静默会话会留一条 run 记录**——无害（只是内存），但如果我们实现时用对象池要注意。
2. settle 里 `if (this.runs.has(id)) return` 依赖 `armRun` 在 `observe` 同帧同步执行；因为 settle 是 async，下一帧的 arm 可能先于 `await settle()` 返回，这个判断是必须的。
3. `detailOf` 在 `armRun` 里被调用一次、在 settle 后又调用一次；**两次读的都是「此刻」的对话快照**，所以 `ensureDetail` 必须发生在第二次读之前（顺序由代码保证，测试 `materializes the detail before the settle read` 断言 `['ensure','detail']`，`:166-180`）。
4. settle 后 `silenced(id)` 再次检查，并删 `prevRunning`（不删的话切回 all 时会被误判边沿）。
5. `truncateTitle`（`:397-401`）：折叠所有空白为单空格 + trim，超 60 截断并加 `…`（**总长 60**，不是 61）。`truncateDetail`（`:404-407`）：**不折叠空白**，超 160 截断加 `…`（总长 160）。CJK/emoji 都按 UTF-16 code unit 切，可能切断代理对——我们的实现可以考虑 `Array.from` 按码点切。
6. 事件对象只有 `{kind, sessionId, title, detail}`；**没有时间戳、没有 workspace/project、没有 run id**。要「按会话折叠」需要自己在 tag 里拼 sessionId。
7. 引擎不区分「主会话」与「普通会话」——只有 `isSubagent` 一个维度。主会话判定不存在。
8. 会话标题取 `displayTitle ?? id`（`client/index.ts:194`）——**没有** `title` 字段兜底（toolkit 的 archived 模块则先 `summary.title` 再 `displayTitle`，见 §10.2）。

---

## 3. 最终 assistant 回复文本的抽取（第二核心）

### 3.1 用到的结构类型（全部 structural，不 import 具体节点类型）

```ts
// src/client/notification-service.ts:32-46
/** Minimal structural view of the alpha chat target snapshot (ui-chat ChatSnapshot). */
export interface ChatViewNode {
  kind: string
  data: unknown
}

/** Minimal structural view of the chat node store. */
export interface ChatNodeStoreLike {
  values(): IterableIterator<ChatViewNode>
}

/** Minimal structural view of the chat snapshot the engine classifies on. */
export interface ChatSnapshotLike {
  nodes: ChatNodeStoreLike
}
```

`AssistantBlock` / `TurnErrorNode` 只是 **import type**（`notification-service.ts:23-25`，来自 `@deepseek-ai/dsh-client-ui-conversation/client`），运行时零依赖：

```ts
import type { AssistantBlock, TurnErrorNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
```

所以真正运行时只依赖三个事实：`chat.nodes.values()` 可迭代、每个节点有 `kind: string`、`data` 是具体 payload。

### 3.2 取对话快照的精确代码路径（`client/index.ts:155-181`，**逐字**）

```ts
detailOf: (id: SessionId) => {
  const binding = ctx.sessions.binding(id)
  if (binding === undefined) return undefined
  // The session snapshot carries no chat view: the conversation nodes
  // live in the uiConversation chat target, materialized only for opened
  // sessions. Absent it, classification still has lastAgentError.
  // (The chat target key and the session snapshot shape are surfaced
  // through their owning packages' type merges; the structural casts keep
  // this plugin independent of those augmentation orders.) A generation
  // that ends between the running edge and this read makes the binding
  // calls throw in 0.1.7, so a failed read degrades to "no detail".
  try {
    const conversation = ctx.uiConversation.binding(binding) as unknown as {
      activate(target: string): void
      target(key: string): { getSnapshot(): unknown }
    }
    // Reading a target source does not activate it in 0.1.7+; without
    // activation the chat nodes this classification needs stay absent for
    // every session the shell has not selected.
    conversation.activate('chat')
    const chat = conversation.target('chat').getSnapshot() as ChatSnapshotLike | undefined
    const session = binding.session.getSnapshot() as unknown as SessionSnapshot
    return sessionDetailOf(session, chat)
  } catch {
    return undefined
  }
},
```

链路五步，缺一不可：

1. `ctx.sessions.binding(sessionId)` → `SessionBinding | undefined`（会话已关/切代就 undefined）；
2. `ctx.uiConversation.binding(binding)` → 会话的 conversation 句柄；
3. **`conversation.activate('chat')`** —— 0.1.7+ 起**只读 target 不会激活它**；不 activate，未在 shell 里选中的会话 chat 节点永远是空的，`finalText` 永远 `''`。这是最容易漏的一步。
4. `conversation.target('chat').getSnapshot()` → `ChatSnapshotLike`（`{ nodes: { values() } }`）；
5. `binding.session.getSnapshot()` → `SessionSnapshot`，取 `lastAgentError`；然后 `sessionDetailOf(session, chat)`。

整个块被 `try/catch` 包住：generation 在「running 边沿」和「读快照」之间结束的话，0.1.7 的 binding 调用会**抛错**，降级为 `undefined`（按「无 detail」分类）。`typescript` 上是靠结构性 `as unknown as` 断言，避免依赖两个包的 Context 类型增强顺序。

### 3.3 `sessionDetailOf` 全文（`notification-service.ts:352-394`，**逐字**）

```ts
export function sessionDetailOf(
  session: SessionSnapshot,
  chat: ChatSnapshotLike | undefined,
): SessionDetail {
  let maxTurnErrorSeq = 0
  let failureMessage: string | null = null
  let finalText = ''
  let lastUserText = ''
  if (chat !== undefined) {
    for (const node of chat.nodes.values()) {
      if (node.kind === 'turn-error') {
        const data = node.data as TurnErrorNode
        if (data.seq > maxTurnErrorSeq) {
          maxTurnErrorSeq = data.seq
          failureMessage = data.message
        }
      } else if (node.kind === 'assistant-step') {
        const data = node.data as { blocks: readonly AssistantBlock[] }
        const text = data.blocks
          .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block.kind === 'text')
          .map(block => block.text)
          .join('')
        if (text.length > 0) finalText = text
      } else if (node.kind === 'user') {
        // Human messages only: goal rounds and other host prompts share the role.
        const data = node.data as { content: readonly { type: string, text?: string }[], source?: { kind?: string } }
        if (data.source?.kind === 'user') {
          lastUserText = data.content
            .filter(block => block.type === 'text' && block.text !== undefined)
            .map(block => block.text)
            .join('')
        }
      }
    }
  }
  return {
    maxTurnErrorSeq,
    failureMessage,
    lastAgentError: session.lastAgentError,
    finalText,
    lastUserText,
  }
}
```

### 3.4 `SessionDetail` 形状与语义

```ts
// src/client/notification-service.ts:58-70
export interface SessionDetail {
  /** Max seq of materialized turn-error nodes (unretried failures only). */
  maxTurnErrorSeq: number
  /** Most recent failure message, when one is visible. */
  failureMessage: string | null
  /** Host agent-error text, null when none. */
  lastAgentError: string | null
  /** Text of the last assistant message (the final completion text); '' when none. */
  finalText: string
  /** Text of the latest human user message (the run's subject), when known. */
  lastUserText?: string
}
```

| 字段 | 来源 | 缺省 | 我们复用时要注意 |
| --- | --- | --- | --- |
| `maxTurnErrorSeq` | 遍历 `turn-error` 节点，取最大 `data.seq` | `0` | 只增不减地扫描全量节点，O(n)；每次分类扫一遍 |
| `failureMessage` | 最大 seq 那个节点的 `data.message` | `null` | seq 相等时保留先遇到的 |
| `lastAgentError` | `session.lastAgentError`（**不看对话**） | `null` | 宿主上报字段；未打开会话也能读到 |
| `finalText` | **最后一个「文本非空」的 `assistant-step` 节点**的文本块拼接 | `''` | 见下方语义细节 |
| `lastUserText` | **最后一个** `source.kind === 'user'` 的 `user` 节点文本块拼接 | `''` | 可选字段；goal/steering 不算 |

抽取语义（逐条，均有测试锚点）：

1. **`assistant-step`**：只看 `blocks` 里 `kind === 'text'` 的块，`join('')`（块间**不加换行/空格**）；只看「最后一个文本非空的 step」，空 step 不覆盖已有值。→ 这就是「本轮最终回复」。
2. **`turn-error`**：不是「任意错误」，而是「seq 最大的错误」；配合基线（§2.3）才能判断「本次 run 期间是否新增了错误」。
3. **`user` 节点**：必须 `data.source?.kind === 'user'`——**goal round、steering（插话）、宿主注入的 prompt 都不算**。测试：`reads the latest human message and ignores host-authored user turns`（`tests/notification-engine.spec.ts:433-443`），输入里有 `user(1,'修复登录超时')`、`user(2,'再加个单元测试')`、`user(3,'<goal_round round="2">','goal')`、`{kind:'steering',...}`、一个 assistant-step，期望 `lastUserText='再加个单元测试'`、`finalText='已补上 3 个用例'`。
4. **节点遍历顺序** = `chat.nodes.values()` 的迭代顺序（实际即时间序）。代码假设「后出现的覆盖先出现的」，所以**顺序错了结论就错**；不要自行排序。
5. **没有 chat 快照**（`chat === undefined`）：`finalText=''`、`lastUserText=''`、`maxTurnErrorSeq=0`、`failureMessage=null`，只有 `lastAgentError` 可用（测试 `reports no user text for a chat view without a human message`，`:445-448`）。
6. `assistant-step` 里的 `thinking`/`tool_use` 等块被过滤掉；只保留纯文本。

### 3.5 `ensureDetail`：把没打开过的会话「物化」一下

```ts
// src/client/index.ts:182-193
// Open a session the UI never opened so its chat view can assemble
// the final assistant text; skipped when no alert could use it.
ensureDetail: async (id) => {
  const settings = currentSettings()
  if (!settings.browserEnabled && !settings.soundEnabled) return
  if (!Object.values(settings.types).some(type => type.enabled)) return
  try {
    await ctx.sessions.using(id, { source: 'sessionNotification' }, async () => {})
  } catch (error) {
    console.warn('[dsh-session-notification] could not load the notification session', id, error)
  }
},
```

- **三处门控**：浏览器通知关 + 声音关 → 没必要；所有 kind 都被关掉 → 没必要。省掉一次会话加载。
- `ctx.sessions.using(id, { source }, fn)` 持有会话引用直到 fn 结束——用空 fn 只是为了「加载到内存」。
- `source` 字面量需要模块增强声明（`client/index.ts:71-76`）：

```ts
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Reference held while one notification classification reads a session. */
    sessionNotification: unknown
  }
}
```

- 失败只 `console.warn`，**不影响分类**（测试 `still classifies when materializing the detail fails`，`:182-192`）。
- 这是「未打开会话也能拿到回复文本」的关键；否则只能退化成「按完成 + 空正文」。

### 3.6 判失败时读取的节点语义（再强调）

- 「被重试挽回的失败」按 **completed** 处理——因为 turn-error 节点会被 materialize 成「已重试」状态（`maxTurnErrorSeq` 注释：「unretried failures only」）。
- `turn-error.seq` 单调递增（宿主 seq），所以「比基线大」=「本次 run 期间新增」。

### 3.7 坑位清单

1. **忘了 `activate('chat')`** → 所有未选中会话 `finalText` 恒空。最隐蔽的 bug。
2. **binding 读取要 try/catch**：generation 切换时 0.1.7 会抛。
3. **`detail !== undefined` 是 failed 的前提**；没有 detail 就永远 completed（README 已知限制）。
4. **不要在引擎里缓存 detail**：settle 后必须重读（`ensureDetail` 之后），缓存会拿到 pre-run 的旧值。
5. `blocks` 里文本块拼接**无分隔符**；多块文本可能直接粘连（如「好的」「我这就改」→「好的我这就改」）。参考实现就这样；我们若想加换行，是**行为变更**，需同步改 §4.3 的 body 拼装。
6. `user.source.kind` 缺失时（`undefined`）**不算人类消息**；只认显式 `'user'`。
7. assistant 文本截断发生在 dispatcher（160 字）而不是抽取阶段——我们要做「副标题」时同样在 dispatcher 截断。

---

## 4. 分发器（Dispatcher）门控逻辑

### 4.1 决策顺序（严格按代码顺序，短路在前的先算）

`NotificationDispatcher.dispatch`（`notification-service.ts:455-489`，**逐字**）：

```ts
dispatch(event: NotificationEvent): void {
  const settings = this.deps.settings()
  const type = settings.types[event.kind]
  if (!type.enabled) return
  const isCurrent = this.deps.isCurrent(event.sessionId)
  const mode = settings.currentNotificationMode
  // "Away" from the session you are reading: a backgrounded window counts
  // for every mode, another application in front only for 'unfocused', and
  // 'always' is never quiet. Focus is read only when the mode needs it.
  const away = this.deps.isHidden() || (mode === 'unfocused' && this.deps.hasFocus?.() === false)
  if (isCurrent && !away && mode !== 'always') return

  const title = this.deps.t(`notify.${event.kind}.title`)
  const template = this.deps.t(`notify.${event.kind}.body`)
  const detail = truncateDetail(event.detail)
  const base = template.replaceAll('{title}', event.title)
  // A completed run's detail is the final assistant text — show it on its
  // own line so long-form content reads naturally; the other kinds embed
  // the detail inline in their templates.
  const body = event.kind === 'completed'
    ? (detail.length > 0 ? `${base}\n${detail}` : base)
    : base.replaceAll('{detail}', detail)
  if (settings.soundEnabled) {
    // The custom audio plays only when the kind's picker selects 自定义;
    // otherwise the selected built-in plays (a dormant custom file is inert).
    if (type.sound === 'custom') {
      const customUrl = this.deps.customSoundOf(event.kind)
      if (customUrl !== undefined) this.deps.playSound('custom', customUrl)
    } else if (type.sound !== 'none') {
      this.deps.playSound(type.sound)
    }
  }
  if (!settings.browserEnabled) return
  this.deps.showBrowser(title, body, `${NOTIFICATION_TAG_PREFIX}:${event.kind}`, event.sessionId)
}
```

顺序表：

| # | 门 | 条件 | 结果 |
| --- | --- | --- | --- |
| 1 | 种类开关 | `settings.types[kind].enabled === false` | 全静音（**声音和系统通知都不发**） |
| 2 | 当前会话 | 见 §4.2 矩阵 | 静音（**整条事件**丢弃） |
| 3 | 文案 | `t('notify.<kind>.title')` / `t('notify.<kind>.body')`，`{title}`/`{detail}` 占位替换 | — |
| 4 | 声音 | `settings.soundEnabled && sound !== 'none'`（`custom` 需真有 dataURL） | `playSound()` |
| 5 | 系统通知 | `settings.browserEnabled` | `showBrowser(title, body, tag, sessionId)` |

细节：

- `settings()` 是**分发时实时读取**，所以改设置立刻生效，不需要重建 dispatcher。
- **当前会话被静音时声音也不响**（不是「声音响、通知不弹」）；反过来，`browserEnabled=false` 时**声音照响**（测试 `keeps sound when browser notifications are disabled`，`tests/dispatcher.spec.ts:134-140`）。
- `hasFocus` 是**可选端口**：缺失时按「有焦点」处理（安静的那一侧）。
- `isHidden` 对当前会话**任何模式**都算 away（隐藏/最小化一定提醒）。
- 注意 `away` 只在 `mode === 'unfocused'` 时才读 `hasFocus`；`hidden` 模式完全不读焦点。
- `mode === 'always'` 时 `if (isCurrent && !away && mode !== 'always')` 永远不成立 → 一律提醒。
- 「非当前会话」的事件**永远提醒**（不受 `currentNotificationMode` 影响）。

### 4.2 当前会话提醒时机矩阵（来自 `tests/dispatcher.spec.ts:98-113`）

`it.each([mode, focused, hidden, alerts])`：

| `currentNotificationMode` | 有焦点 | 隐藏/最小化 | 当前会话是否提醒 | 说明 |
| --- | --- | --- | --- | --- |
| `hidden`（默认） | true | false | ❌ | 正在看，安静 |
| `hidden` | true | **true** | ✅ | 标签页后台/窗口最小化 → 提醒 |
| `hidden` | false | false | ❌ | 切到别的 app 但窗口还在屏上，**hidden 模式不提醒** |
| `unfocused` | false | false | ✅ | 切到其他应用 → 提醒 |
| `unfocused` | true | false | ❌ | 仍在前台 → 安静 |
| `always` | true | false | ✅ | 无条件提醒 |

语义定义（`settings.ts:17-23`）：

```ts
/**
 * When the currently active (viewed) session alerts:
 * - `hidden`: only when the tab is backgrounded or the window minimized (default);
 * - `unfocused`: also alerts when focus switches to another application (even if still on screen);
 * - `always`: always alerts, even while actively viewing the foreground session.
 */
export const CURRENT_NOTIFICATION_MODES = ['hidden', 'unfocused', 'always'] as const
```

`isCurrent` 的接线（`client/index.ts:144-147`）——**不是**列表里的 `current` 字段（0.1.7 已移除），而是主视图持有的引用计数：

```ts
// dsh 0.1.7 dropped the list's `current` selection; the main view owns
// selection through its reference source, so a session is "the one being
// read" while the main-view reference retains it.
isCurrent: (id) => (ctx.sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0,
```

```ts
isHidden: () => (typeof document === 'undefined' ? false : document.visibilityState === 'hidden'),
// `visibilityState` stays visible while another app is in front and this
// window is still on screen; focus is the signal for that case.
hasFocus: () => typeof document === 'undefined' || document.hasFocus(),
```

> 我们在 dsh-toolkit 里要复核 `ctx.sessions.retainInfo(...)` 是否存在（参考实现在 0.1.7 用它）；若不存在，退化方案：`ctx.sessions.list` 的 `current`/`currentAddress`（旧的 `list.current`）或用 `byId[id]` 与主视图 UI 状态比较。这是「当前会话静音」功能的关键依赖，必须先验证。

### 4.3 文案拼装规则

`locales.ts` 里的 4 组模板（`zh`，`locales.ts:51-58`）：

```ts
'notify.completed.title': '会话完成',
'notify.completed.body': '「{title}」已完成',
'notify.failed.title': '会话失败',
'notify.failed.body': '「{title}」运行失败：{detail}',
'notify.question.title': '等待回答',
'notify.question.body': '「{title}」向你提问：{detail}',
'notify.permission.title': '权限请求',
'notify.permission.body': '「{title}」请求权限：{detail}',
```

- `completed` 的 body 是 `base + '\n' + detail`（detail 换行单独一段，不塞进模板）。
- 其余 3 种把 `{detail}` 内联替换进模板。
- **标题是本地化的种类名（"会话完成"），不是会话名**；会话名/本轮用户消息只出现在 body 的 `「」` 里。
- `event.title` 为空时 body 会变成 `「」已完成`；`detail` 为空时 completed body 只有第一行。

测试锚点：`appends the final completion text to a completed notification body`（`tests/dispatcher.spec.ts:60-66`，期望 `'「会话 a」已完成\n这是最终完成文本。'`）；`interpolates the title and detail into the body`（`:183-190`）。

### 4.4 声音选择矩阵（`tests/dispatcher.spec.ts:142-181`）

| `soundEnabled` | `types[kind].enabled` | `types[kind].sound` | 有自定义文件 | 实际播放 |
| --- | --- | --- | --- | --- |
| false | true | 任意 | 任意 | 无 |
| true | false | 任意 | 任意 | 无（种类门在更前面） |
| true | true | `'none'` | 有 | 无 |
| true | true | `'custom'` | 有 | `playSound('custom', dataUrl)` |
| true | true | `'custom'` | 无 | **无**（不回落内置） |
| true | true | `'chime'` 等 | 有（休眠） | 内置 `chime` |

即：**自定义文件只会被播放，绝不会被「自动选中」**；picker 选的是 `custom` 才走自定义。

### 4.5 `showBrowser` 第四参：把 sessionId 一路带到点击回调

`NotificationDispatcherDeps.showBrowser` 的签名把 `sessionId` 显式传出（`notification-service.ts:423-427`）：

```ts
/**
 * Show one system notification under the event kind's collapse tag; the
 * session id lets the click action navigate back to the event's session.
 */
showBrowser: (title: string, body: string, tag: string, sessionId: SessionId) => boolean
```

接线（`client/index.ts:137-143`）：

```ts
showBrowser: (title, body, tag, sessionId) => showBrowserNotification(title, body, tag, () => {
  try {
    ctx.uiWorkspace.openSession(sessionId)
  } catch (error) {
    console.warn('[dsh-session-notification] could not open the notification session', sessionId, error)
  }
}),
```

这就是「点击通知 → 打开会话」的**唯一入口**；`uiWorkspace` 在 `inject` 里注入但客户端注册时是 optional 语义（`client/index.ts:42-44` 注释：「Injected optionally so a composition without it keeps the plugin running」），实际 `inject` 数组里写了它（`:87`）——如果宿主没有该服务，插件不会加载。这是一个接线细节：**要么强依赖，要么 try/catch 降级**，参考实现选了强依赖（列表里必须有）。

---

## 5. 浏览器通知实现（`browser-notify.ts`）

### 5.1 权限模型

```ts
// src/client/browser-notify.ts:6-7
export type BrowserPermission = 'granted' | 'denied' | 'default' | 'unsupported'

// :29-47
export function browserPermission(): BrowserPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  return permission
}
```

- `unsupported` 是本插件自造的第四态（非浏览器环境 / 浏览器没有 Notification API，例如不安全上下文）。
- `requestBrowserPermission` **必须从用户手势调用**（设置栏开关点击 / “授权”按钮），否则 Chrome 会直接拒绝或静默。
- 打开开关的完整流程（`client/index.ts:303-313`）：

```ts
setBrowserEnabled: async (enabled) => {
  if (enabled) {
    let permission = browserPermission()
    if (permission === 'default') {
      permission = await requestBrowserPermission()
      bound?.setPermission(permission)
    }
    if (permission !== 'granted') return   // 没批就不写偏好，开关回弹
  }
  persist('browserEnabled', enabled)
},
```

即：**先要权限，拿不到就不把 `browserEnabled` 存成 true**（避免「开关开着但永远不响」的假状态）。同时 store 里有 `permission` 镜像字段用于 UI 展示。

### 5.2 `new Notification(title, options)` 的选项

```ts
// src/client/browser-notify.ts:9-17
/**
 * Notification options carrying the spec's `renotify`, which the DOM lib
 * typings do not declare yet. With a `tag` set, `renotify: true` re-alerts
 * when a same-tag notification is replaced; without it, Windows/Chromium
 * swap the card in the action centre silently and no banner replays.
 */
interface RenotifyOptions extends NotificationOptions {
  renotify?: boolean
}
```

```ts
// src/client/browser-notify.ts:139-150
const icon = pageIconUrl()
const options: RenotifyOptions = {
  body,
  tag,
  renotify: true,
  // The desktop shell forwards `silent` to the native notification, and its
  // own notifications set it: without it the OS alert sound plays on top of
  // this plugin's Web Audio sound. On the Web the notification sound stays
  // the browser's business, as before.
  ...(isDesktopShell() ? { silent: true } : {}),
  ...(icon === undefined ? {} : { icon }),
}
```

| 选项 | 值 | 为什么 |
| --- | --- | --- |
| `body` | dispatcher 算出的正文 | — |
| `tag` | `${NOTIFICATION_TAG_PREFIX}:${kind}`，前缀常量 `'dsh-session-notification'`（`:20`） | 同 kind 连发时**塌缩成一张卡**；不同 kind 互不覆盖 |
| `renotify` | `true` | 有 tag 时，替换同 tag 通知**重新弹横幅+响铃**；不加的话 Windows/Chromium 只静默换卡 |
| `silent` | 仅在桌面外壳（`'dshDesktop' in globalThis`）为 `true` | Electron 会把 `silent` 透传给原生通知；否则系统提示音会和插件的 Web Audio 提示音**叠加** |
| `icon` | 页面图标（见 §5.3），解析不到就不传 | 桌面外壳用**打包应用图标**兜底 |
| `requireInteraction` | **未设置**（默认 `false`） | 参考实现不强制常驻卡片，会随系统策略自动消失。若我们要求「必须点掉才消失」，可以设 `true`，但 Windows 上会一直堆在操作中心，需评估 |
| `data` / `badge` / `image` / `actions` / `vibrate` | 未使用 | 参考实现没有用 |

### 5.3 图标解析规则（`browser-notify.ts:49-88`）

```ts
/** Schemes a native notification layer can fetch an icon from. */
const ICON_URL_SCHEME = /^(?:https?|blob):/i

/**
 * A `data:` icon is usable only when it carries a raster image: native
 * notification layers decode bitmaps and never rasterize SVG documents.
 */
const RASTER_DATA_ICON = /^data:image\/(?!svg)/i

/** One declared icon link, or undefined when absent or unusable natively. */
function iconUrlOf(link: HTMLLinkElement | null): string | undefined {
  if (link === null || link.href.length === 0) return undefined
  // The desktop shell serves its page from `dsh-app://` and declares SVG
  // favicons; neither is fetchable/decodable by the native notification
  // layer, so skipping them lets Electron fall back to the packaged
  // application icon instead of dropping or retrying the alert.
  if (ICON_URL_SCHEME.test(link.href)) return link.href
  return RASTER_DATA_ICON.test(link.href) ? link.href : undefined
}

function pageIconUrl(): string | undefined {
  if (typeof document === 'undefined') return undefined
  return iconUrlOf(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]'))
    ?? iconUrlOf(document.querySelector<HTMLLinkElement>('link[rel~="icon"]'))
}
```

| 页面声明的图标 | 结果 |
| --- | --- |
| `apple-touch-icon`（任意可接受 URL） | 优先使用（最大尺寸） |
| `rel~="icon"` 的 http/https/blob URL | 使用 |
| `data:image/png|jpeg|webp|gif` 等位图 | 使用 |
| `data:image/svg+xml,...` | **丢弃**（原生层不解码 SVG） |
| `dsh-app://.../favicon.svg` 等自定义 scheme | **丢弃**（原生层抓不到，Electron 自动回落到应用图标） |
| 没有 `<link>` | 不传 `icon`，系统用默认图标 |

测试锚点：`tests/browser-notify.spec.ts:51-146`（favicon、apple-touch-icon 优先、SVG data 丢弃、PNG data 保留、custom scheme 丢弃、无 icon、构造器 reject 后重试）。

### 5.4 点击链路（**核心**，`browser-notify.ts:106-173`）

```ts
export function showBrowserNotification(
  title: string,
  body: string,
  tag: string = NOTIFICATION_TAG_PREFIX,
  onActivate?: () => void,
): boolean {
  if (typeof Notification === 'undefined') {
    console.warn('[dsh-session-notification] browser Notification API is unavailable (insecure context or unsupported browser)')
    return false
  }
  if (Notification.permission !== 'granted') {
    console.warn(`[dsh-session-notification] browser notification suppressed: permission is "${Notification.permission}"`)
    return false
  }
  /** Focus the page, run the caller's navigation, then dismiss the card. */
  const activate = (notification: Notification): void => {
    liveNotifications.add(notification)
    const forget = (): void => { liveNotifications.delete(notification) }
    if (typeof notification.addEventListener === 'function') {
      notification.addEventListener('close', forget, { once: true })
    }
    notification.onclick = () => {
      forget()
      window.focus()
      try {
        onActivate?.()
      } catch (error) {
        // A failed navigation must not leave the card stuck on screen.
        console.warn('[dsh-session-notification] notification click action failed', error)
      }
      notification.close()
    }
  }
  ...
}
```

点击链路的精确顺序（**这四步就是用户要求的「聚焦/唤起 + 跳转」原型**）：

1. `forget()`：从 `liveNotifications` 引用集合移除；
2. **`window.focus()`**：把浏览器标签页/窗口拉到前台（Web 上有效：后台标签、最小化窗口）；
3. `onActivate?.()`：接线注入的回调 → `ctx.uiWorkspace.openSession(sessionId)`；**用 try/catch 包住**，抛错也继续；
4. `notification.close()`：无论回调成败都关掉卡片（否则卡片永久挂在操作中心）。

为什么需要 `liveNotifications`（`:22-27`）：

```ts
/**
 * Live notifications kept referenced until they close: a click handler is a
 * property of the JS wrapper, so letting it be collected can swallow the
 * activation (the platform side only knows the notification id).
 */
const liveNotifications = new Set<Notification>()
```

Chromium 里 `Notification` 是 JS 包装对象，**GC 后 `onclick` 丢失**，点击就没反应（平台只保留 notification id）。所以必须强引用，直到 `close` 事件或点击时释放。这是一个很容易漏、且只在长时间运行后表现为「点通知没反应」的 bug。

### 5.5 tag 塌缩策略（`browser-notify.ts` + dispatcher）

- 默认 tag = `NOTIFICATION_TAG_PREFIX`（`'dsh-session-notification'`），用于测试通知（`client/index.ts:324`：`${PREFIX}:test`）。
- 真实事件 tag = `${PREFIX}:${kind}`（`notification-service.ts:488`）。
- `renotify: true` 让「同 tag 替换」重新提醒，而不是静默换卡。
- 效果：连续两次「会话完成」→ 屏幕上只有一张卡（内容被替换，重新响铃）；「完成」和「失败」两张卡并存。
- 测试锚点：`re-alerts when a same-tag notification is replaced (renotify + tag)`、`collapses per kind through the caller-supplied tag`（`tests/browser-notify.spec.ts:120-132`）。

> ⚠️ 如果我们把 title 改成会话标题（§10），按 kind 塌缩会把**不同会话**的通知互相覆盖——这是要改的点。推荐按会话：`${PREFIX}:${sessionId}`（见 §10.4）。

### 5.6 桌面端（Electron）特性

```ts
// src/client/browser-notify.ts:69-76
/**
 * Whether this page runs inside the dsh desktop (Electron) shell. The official
 * client code detects it the same way (`dshDesktop` comes from the desktop
 * preload); the main frame always carries it.
 */
export function isDesktopShell(): boolean {
  return typeof globalThis !== 'undefined' && 'dshDesktop' in globalThis
}
```

- 桌面外壳里：`silent: true`（避免系统音 + 插件音叠加）；页面图标若是 `dsh-app://`/SVG 会被丢弃 → 原生层回落到**打包应用图标**（测试 `marks desktop notifications silent so the OS sound does not double ours`、`ignores a custom-scheme (desktop dsh-app:) page icon`，`:84-118`）。
- 权限：桌面外壳通常**默认授予**通知权限，不会弹框；代码仍走 `Notification.permission`，逻辑一致。
- 点击：README 声称「经外壳的应用激活恢复并聚焦窗口」——**代码里只有 `window.focus()`**，外壳的窗口恢复依赖 Electron 自己的通知点击行为/外壳实现。**这一点必须实测**：如果桌面端窗口已隐藏/最小化时 `window.focus()` 不生效，我们需要显式调用桌面桥（例如 `globalThis.dshDesktop?.activate?.()` / shell 提供的 API），这是参考实现的潜在缺口。
- 关闭窗口只是隐藏不退出（README），所以「隐藏窗口 + 通知 → 点击」是桌面端最常见路径。

### 5.7 失败路径与降级（`browser-notify.ts:151-172`）

```ts
try {
  const notification = new Notification(title, options)
  activate(notification)
  return true
} catch (error) {
  // A page icon the browser cannot rasterize must not kill the alert:
  // retry once without it, then report.
  if (icon !== undefined) {
    try {
      const bareOptions: RenotifyOptions = { body, tag, renotify: true }
      const notification = new Notification(title, bareOptions)
      activate(notification)
      console.warn('[dsh-session-notification] page icon was rejected; notification shown without it', error)
      return true
    } catch (_secondFailure) {
      console.warn('[dsh-session-notification] Notification constructor failed; check the browser/OS notification settings', _secondFailure)
      return false
    }
  }
  console.warn('[dsh-session-notification] Notification constructor failed; check the browser/OS notification settings', error)
  return false
}
```

降级层次：**无 API → warn + false**；**权限不足 → warn + false**；**带 icon 构造失败 → 去掉 icon 重试一次**；**仍失败 → warn + false**。所有失败都打 `console.warn`（不静默吞），便于诊断「为什么没弹」。

### 5.8 清理

- `liveNotifications` 的条目在 `close` 事件（`{once:true}`）或点击时 `forget()`。
- 没有全局 `dispose()`；通知对象随关闭释放。
- 插件卸载时不需要主动清空通知（系统通知由 OS 管理），但 `sounds.ts`/`tab-coordinator.ts` 有各自的 dispose（§7、§8）。

### 5.9 我们要加的扩展点

| 需求 | 在参考实现上的改动 |
| --- | --- |
| 点击 → 聚焦/唤起 DSH | 已有 `window.focus()`；桌面端可能需要额外桥调用（§5.6 风险） |
| 点击 → 跳到该会话 | 已有：`onActivate` → `ctx.uiWorkspace.openSession(sessionId)` |
| title = 会话标题，body = 最后回复 | 改 dispatcher（§4.3）+ 引擎标题（§2.3.3） |
| 点开后清掉未读/选中项 | 需在 `onActivate` 里追加；参考实现只有 `openSession` |

---

## 6. 持久化（localStorage scope）

### 6.1 键与作用域

| 内容 | localStorage key | 值形状 |
| --- | --- | --- |
| 偏好（整段） | `dsh-session-notification:preferences`（`local-settings.ts:29`：`` `${NOTIFICATIONS_NS}:preferences` ``） | 完整 `NotificationSettings` JSON（**不是 patch**） |
| 每 kind 自定义音频 | `dsh-session-notification.customSounds`（`custom-audio.ts:14`） | `Partial<Record<NotificationType, string>>`（dataURL，空串/缺省=无） |

不写宿主设置文档、不占宿主命名空间——这是「零宿主改动」的核心手段。代价：**不跨浏览器/profile 同步**（README 已知限制）。

### 6.2 用官方 `ConfigForm` 契约包装 localStorage（`local-settings.ts:56-134`）

```ts
export function createLocalSettingsScope(): ConfigForm<NotificationSettings> {
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }

  let value: NotificationSettings = resolveNotificationSettings(
    parseStored(storage()?.getItem(LOCAL_STORAGE_KEY) ?? null),
  )
  let revision = 1

  const snapshot = (): ConfigFormSnapshot<NotificationSettings> => ({
    status: 'ready',
    value,
    base: DEFAULT_NOTIFICATION_SETTINGS,
    user: undefined,
    revision,
    writable: true,
  })

  const commit = (next: NotificationSettings, persist: boolean): void => {
    value = next
    revision += 1
    if (persist) {
      try {
        storage()?.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Quota/access errors keep the in-memory value; nothing else to do.
      }
    }
    notify()
  }
```

`ConfigFormSnapshot` 字段：`status:'ready' | value | base(=默认值) | user(undefined) | revision(单调递增) | writable(true)`。渲染层用它判断「已就绪/可写/是否被用户改过」。

写接口三个：

```ts
// :107-132
async mutate(ops: readonly SettingsPathOpView[], _expectedRevision?: number): Promise<boolean> {
  const next = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  for (const op of ops) {
    if (op.path.length === 0) {
      // The empty path addresses the section root.
      if (op.op === 'set') {
        for (const key of Object.keys(next)) delete next[key]
        Object.assign(next, op.value)
      }
      continue
    }
    if (op.op === 'set') deepSet(next, op.path, op.value)
    else deepUnset(next, op.path)
  }
  commit(resolveNotificationSettings(next), true)
  return true
},
async set(field: string, fieldValue: unknown): Promise<boolean> {
  commit(resolveNotificationSettings({ ...value, [field]: fieldValue }), true)
  return true
},
async unset(field: string): Promise<boolean> {
  const fallback = (DEFAULT_NOTIFICATION_SETTINGS as unknown as Record<string, unknown>)[field]
  commit(resolveNotificationSettings({ ...value, [field]: fallback }), true)
  return true
}
```

- `mutate` 支持 `SettingsPathOpView`（`set`/`unset` + `path[]`），空 path = 整段替换；用 `deepSet/deepUnset`（`:137-161`）折叠多条 op 到**一次** commit + **一次** notify（测试 `mutate folds several ops into one persisted commit and one notification`）。
- **所有写入都过一次 `resolveNotificationSettings`**（含 `set`/`unset`）→ 垃圾值不会落盘，手改 storage 也自动降级默认。
- `unset` 把默认值写回（而不是删 key），因为整段 JSON 存储。
- 读不到 storage（隐私模式/SSR）→ 纯内存 scope，`storage()` 用 try/catch（`:32-39`）。

### 6.3 跨标签页同步（`local-settings.ts:89-96`）

```ts
// Writes from other tabs arrive through the browser storage event, keeping
// the "sync across tabs" behavior the host-document path used to provide.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== LOCAL_STORAGE_KEY) return
    commit(resolveNotificationSettings(parseStored(event.newValue)), false)
  })
}
```

- `storage` 事件**只发给其他标签页**，所以本标签页的写入不会回声。
- 收到后 `persist=false`（不回写，避免循环），但 **revision+1 且 notify** → 所有订阅者（引擎模式、UI 镜像）都会更新。
- 自定义音频**不**跨标签同步（它是另一个 key，没有 storage 监听；UI 里也只在 mount 时读一次）。这是一个已知不对称，我们实现时若在意，给 `customSounds` 加同样的监听即可。

### 6.4 默认值与解码（`settings.ts:75-102`、`147-189`）

```ts
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  // Browser notifications default OFF: showing them requires the user to
  // grant the browser permission first (the settings toggle does that).
  browserEnabled: false,
  // The session you are reading stays quiet by default unless hidden or minimized.
  currentNotificationMode: 'hidden',
  // Main session only, after its subagents: a fan-out of parallel subagents
  // would otherwise alert once per subagent, and a pause between waves is not
  // a finished run.
  notificationMode: 'main-wait',
  soundEnabled: true,
  volume: 0.6,
  types: Object.freeze({
    completed: Object.freeze({ enabled: true, sound: 'chime' }),
    failed: Object.freeze({ enabled: true, sound: 'fault' }),
    question: Object.freeze({ enabled: true, sound: 'pop' }),
    permission: Object.freeze({ enabled: true, sound: 'alert' }),
  }),
})
```

`resolveNotificationSettings(raw)` 的解码规则（**逐条**）：

| 字段 | 规则 |
| --- | --- |
| 非对象/数组/`null` | 整体返回默认 |
| `browserEnabled` | 必须 `typeof === 'boolean'`，否则默认 `false` |
| `soundEnabled` | 同上，默认 `true` |
| `volume` | 有限数字 → `clamp(0,1)`；NaN/字符串 → 默认 `0.6` |
| `currentNotificationMode` | 合法枚举；否则看遗留布尔 `notifyCurrent === true → 'always'`；否则 `'hidden'` |
| `notificationMode` | 合法枚举；否则 `mainOnly === false → 'all'`；`waitForSubagents === false → 'main'`；否则 `'main-wait'` |
| `types.<kind>.enabled` | boolean，否则 `true` |
| `types.<kind>.sound` | 合法 `SoundId`（`SOUND_IDS` + `none` + `custom`），否则该 kind 默认音 |
| 未知字段 | 丢弃（返回对象只含已知字段）→ 测试 `drops unknown fields from stored sections back to the defaults` |

遗留迁移（`:162-173`）是刻意的：旧文档的 `notifyCurrent` / `mainOnly` / `waitForSubagents` 仍能落到新枚举上。**如果我们从零实现，可以不做迁移**，但要保证「坏数据 → 默认」而不是崩溃。

### 6.5 UI 镜像 store（scope → 渲染层）

`settings-store.ts` 的 store 不是第二个真源，而是 **scope 快照的镜像**：

```ts
// src/client/settings-store.ts:52-99
export function createNotificationsStore(): EngineStoreHandle<NotificationsState, NotificationsActions> {
  return defineStore({
    init: (): NotificationsState => ({
      status: 'loading',
      writable: false,
      settings: DEFAULT_NOTIFICATION_SETTINGS,
      permission: browserPermission(),
      customSounds: readCustomSounds(),
    }),
    actions: {
      adopt: (draft, snapshot) => {
        draft.status = snapshot.status
        draft.writable = snapshot.writable
        // Unavailable or still-loading keeps the last accepted settings
        // (defaults initially), so the section never blanks out.
        if (snapshot.status === 'ready' && snapshot.value !== undefined) {
          draft.settings = snapshot.value
        }
      },
      // ... setBrowserEnabled / setCurrentNotificationMode / setNotificationMode /
      //     setSoundEnabled / setVolume / setType / setPermission / setCustomSound
    },
  })
}
```

写路径是**双写**（乐观镜像 + 真源）：

```ts
// src/client/index.ts:281-296
/** Persist one top-level preference through the scope, mirroring optimistically. */
const persist = (field: ..., value: unknown): void => {
  if (field === 'browserEnabled') bound?.setBrowserEnabled(value as boolean)
  else if (field === 'currentNotificationMode') bound?.setCurrentNotificationMode(value as CurrentNotificationMode)
  else if (field === 'notificationMode') bound?.setNotificationMode(value as NotificationMode)
  else if (field === 'soundEnabled') bound?.setSoundEnabled(value as boolean)
  else bound?.setVolume(value as number)
  void scope.set(field, value)
}

/** Persist one per-kind preference (the whole `types` section is one field). */
const persistType = (kind: NotificationType, patch: Partial<{ enabled: boolean; sound: SoundId }>): void => {
  const next = { ...currentSettings().types[kind], ...patch }
  bound?.setType(kind, patch)
  void scope.set('types', { ...currentSettings().types, [kind]: next })
}
```

- 读：dispatcher/engine 用 `currentSettings()`（scope 快照，未 ready 用默认）；组件用 `useStore`（渲染层 store）。
- 写：先乐观改渲染层 store（立即反馈），再 `scope.set`（异步落盘并触发真正订阅者）。
- `types` 是**整段**写入（`scope.set('types', {...})`），因为 `set` 只做顶层字段替换。
- scope 变化 → `bound?.adopt(snapshot)`（`client/index.ts:113`）把服务端/其他标签页的新值推回渲染层。

> 我们在 dsh-toolkit 里若不引入 `defineStore`，可以简化成：`useSyncExternalStore(scope.subscribe, scope.getSnapshot)` + 组件内直接调 `scope.set`（toolkit 现有模块就是「自绘 translator + 本地 state」的风格，见 §10.2）。

---

## 7. 标签页仲裁（Tab Coordinator）

### 7.1 问题

每个打开的 dsh 标签页都跑一份插件、都订阅同一批会话事件；一个完成事件会让 **N 个标签页各响一次**。仲裁目标：**一个事件只让一个标签页发通知**，且优先让「用户正在看的那个标签页」发。

### 7.2 协议与常量

```ts
// src/client/tab-coordinator.ts:19-32
/** Channel name shared by every same-origin dsh tab. */
const CHANNEL_NAME = 'dsh-session-notification'

/** Window in ms during which a rival's claim can beat ours. */
const DEFAULT_ARBITRATION_MS = 50

/** How long a background tab yields the floor to a visible one. */
const DEFAULT_VISIBLE_GRACE_MS = 60

/** Window in ms in which a repeated claim for the same event is a duplicate. */
const DEFAULT_DEDUPE_WINDOW_MS = 1_000

interface ClaimMessage { readonly type: 'claim'; readonly key: string; readonly tabId: string; readonly at: number }
interface WinMessage { readonly type: 'win'; readonly key: string; readonly tabId: string }
```

消息都在 **BroadcastChannel**（同源）上；`key` 是事件身份：接线里传 `` `${event.sessionId}:${event.kind}` ``（`client/index.ts:237`），所以同一会话同一 kind 的并发只响一次。

### 7.3 `claim(key)` 算法（`tab-coordinator.ts:126-154`，**逐字**）

```ts
async claim(key: string): Promise<boolean> {
  const started = now()
  const last = recent.get(key)
  if (last !== undefined && started - last < dedupeWindowMs) return false
  recent.set(key, started)
  if (channel === undefined) return true

  // C: a background tab yields the floor, so a visible tab claims first.
  if (!visible()) {
    await delay(visibleGraceMs)
    if (rivals.has(key)) {
      rivals.delete(key)
      return false
    }
  }
  const mine = { at: now(), tabId }
  channel.postMessage({ type: 'claim', key, ...mine } satisfies ClaimMessage)
  await delay(arbitrationMs)

  if (wins.delete(key)) {
    rivals.delete(key)
    return false
  }
  const rival = rivals.get(key)
  rivals.delete(key)
  if (rival !== undefined && beats(rival, mine)) return false
  channel.postMessage({ type: 'win', key, tabId } satisfies WinMessage)
  return true
},
```

时间线（两个可见标签页同时 claim）：

| 时刻 | A（可见） | B（可见） |
| --- | --- | --- |
| t0 | dedupe 通过，`recent[key]=t0` | 同 |
| t0 | 可见 → 不等待 | 可见 → 不等待 |
| t0 | post `claim{at:t0,tabId:'a'}` | post `claim{at:t0,tabId:'b'}` |
| t0+δ | 收到 B 的 claim → `rivals[key]={at,tabId:'b'}` | 收到 A 的 claim → `rivals[key]={at,tabId:'a'}` |
| t0+50 | `wins` 无 → 比较 rival:`beats({t0,'a'}, {t0,'a'})`=false → **赢**，post `win` | 比较 `beats({t0,'a'},{t0,'b'})`：`at` 相等、`'a' < 'b'` → true → **输** |

`beats`（`:107-108`）：`a.at < b.at || (a.at === b.at && a.tabId < b.tabId)`——**先到先得，同一毫秒用 tabId 字典序打破平局**。

背景标签页（`visible() === false`）：

1. 先等 `visibleGraceMs`（60ms），给可见标签页抢先 claim 的机会；
2. 等待期间若收到任何对手的 claim（`rivals.has(key)`）→ 直接放弃（`false`）；
3. 没对手 → 正常走 claim 广播 + 50ms 仲裁。

`onMessage`（`:110-122`）负责收集对手：校验 `type/key/tabId/at` 字段、忽略自己、`claim` 只保留「更优」的那条、`win` 记入 `wins` 并在 `dedupeWindowMs` 后过期（防止重复 win 抢走同 key 的后续事件）。

### 7.4 降级

```ts
function defaultChannel(): TabChannel | undefined {
  try {
    if (typeof BroadcastChannel === 'undefined') return undefined
    return new BroadcastChannel(CHANNEL_NAME) as unknown as TabChannel
  } catch {
    return undefined
  }
}
```

- 没有 `BroadcastChannel`（或构造抛错）→ `claim` 第一步后直接 `return true`（**每个标签页各发一次** = 协调前的行为），而不是全部静默。
- `options.channel === null` 显式禁用（测试用）。
- `options` 可覆盖 `arbitrationMs/visibleGraceMs/dedupeWindowMs/visible/now`（测试用，见 `tests/tab-coordinator.spec.ts:27` 的 `FAST = { arbitrationMs: 5, visibleGraceMs: 10 }`）。

### 7.5 去重窗口

`recent: Map<key, timestamp>`：同 key 在 1000ms 内重复 `claim` 直接 `false`。作用：同一事件因多路径（例如 hover/重放）重复 dispatch 时只响一次。**注意**：这也意味着「同一会话同一 kind 在 1 秒内第二次真的发生」会被吞掉——实际不可能（run 至少几百 ms + settle 250ms），可接受。

### 7.6 接线与 dispose

```ts
// src/client/index.ts:120-123
// Cross-tab arbiter: one open tab wins each event, so N tabs do not ring N
// times; a visible tab takes the event ahead of a background one.
const coordinator = createTabCoordinator()
ctx.effect(() => () => coordinator.dispose(), 'dsh-session-notification: tab coordinator')
```

```ts
// src/client/index.ts:233-240
emit: (event) => {
  // One tab wins the event (a visible tab ahead of a background one); the
  // others stay silent for it. Without BroadcastChannel every tab claims
  // its own event, i.e. the pre-coordination behavior.
  void coordinator.claim(`${event.sessionId}:${event.kind}`).then((owned) => {
    if (owned) dispatcher.dispatch(event)
  })
},
```

`dispose()`：移除 message 监听 + `channel.close()`。

### 7.7 测试锚点

`tests/tab-coordinator.spec.ts`：

- 无 channel → 恒 true（`:30-33`）；
- dedupe 窗口内 false、窗口外 true（`:35-43`）；
- 两个可见标签页恰好一个赢（`:45-53`）；
- 背景标签页让位给可见标签页（`:54-64`）；
- 全是背景也选出一个（`:66-73`）；
- 不同 key 各自都能赢（`:75-82`）。

---

## 8. 声音引擎（Web Audio 合成）

### 8.1 为什么值得抄概念

- **不带任何音频资源**：4 个音效是 10 行数据 + 一个通用调度器，bundle 零素材；
- 可配置（每种 kind 选任意音效 / none / custom）；
- 信号链统一处理「整体音量 + 响度提升 + 软限幅」，自定义音频走同一条链；
- 修过一个真实的功耗问题（issue #6）：**播放结束立刻 suspend AudioContext**，否则一个活着的 AudioContext 会一直占着系统音频流、macOS 上还会持有 `PreventUserIdleSystemSleep` 断言，让机器不休眠。

### 8.2 四个音效（`sounds.ts:29-58`，逐字数据）

```ts
export const SOUND_PATTERNS: Record<typeof SOUND_IDS[number], SoundPattern> = {
  /** 叮咚 — a pleasant ascending two-note chime (E5 → A5). */
  chime: {
    notes: [
      { at: 0, frequency: 659.25, duration: 0.2, type: 'sine', gain: 0.9 },
      { at: 0.16, frequency: 880, duration: 0.4, type: 'sine', gain: 0.9 },
    ],
  },
  /** 低鸣 — a low descending sawtooth pair (A3 → E3). */
  fault: {
    notes: [
      { at: 0, frequency: 220, duration: 0.24, type: 'sawtooth', gain: 0.45 },
      { at: 0.2, frequency: 164.81, duration: 0.42, type: 'sawtooth', gain: 0.45 },
    ],
  },
  /** 轻响 — one short soft triangle pop (A5). */
  pop: {
    notes: [
      { at: 0, frequency: 880, duration: 0.09, type: 'triangle', gain: 0.8 },
    ],
  },
  /** 警示 — a square-wave double beep plus a higher third hit. */
  alert: {
    notes: [
      { at: 0, frequency: 660, duration: 0.12, type: 'square', gain: 0.35 },
      { at: 0.18, frequency: 660, duration: 0.12, type: 'square', gain: 0.35 },
      { at: 0.36, frequency: 880, duration: 0.24, type: 'square', gain: 0.35 },
    ],
  },
}
```

结构：`SoundNote { at(秒), frequency(Hz), duration(秒), type(波形), gain(峰值增益) }`；`patternDuration()` 求 `max(at+duration)`（用于调度空闲挂起）。测试要求每个 pattern < 1.5s、四者指纹互不相同（`tests/sounds.spec.ts:15-35`）。

### 8.3 信号链与参数（`sounds.ts:69-81`、`162-181`）

```
osc ─► 每音符 Gain(0 → gain, 10ms 起振, 到 duration 指数衰减到 0.001)
        └─► master Gain(音量，播放时读取 settings.volume)
              └─► boost Gain(×2 ≈ +6 dB)
                    └─► DynamicsCompressor(threshold -1dB, knee 3, ratio 20, attack 1ms, release 50ms)
                          └─► destination
```

- `START_LEAD_SECONDS = 0.02`：从 `currentTime+20ms` 开始排，避免「排在过去」的爆音。
- `NOTE_TAIL_SECONDS = 0.05`：释放尾巴。
- `LOUDNESS_BOOST = 2`：音量滑块保持 0–100%，响度由链路固定提升；限幅器只压爆点。
- 空闲挂起：最后一个 oscillator 的 `ended` 事件 → `CUSTOM_IDLE_MARGIN_SECONDS = 0.25` 后 suspend；同时有兜底定时器 `START_LEAD + patternDuration + TAIL + IDLE_SUSPEND_MARGIN(0.55)`。
- 每次 `play()` 前 `ensureContext()`：懒建 + `state === 'suspended'` 时 `resume()`（自动播放策略）。
- 自定义音频（`playCustom`）：`new Audio(dataUrl)` → `createMediaElementSource` 接到同一 master（享受 boost/limiter），`ended`/`error`/autoplay 拒绝时释放 source 并排 suspend；浏览器不支持 MediaElementSource 时退回 element-only 播放（按 master 音量）。
- `dispose()`：清 idle 定时器、断开 custom source、`context.close()`；下次 play 会新建（有测试覆盖）。

### 8.4 复用到我们这里的判断

**建议复用概念 + 自己实现**：

- 音效数据、音符调度、boost/limiter 参数都很短，可原样照抄（也可换波形）；
- **必须保留**的两个点：① 播放结束 suspend AudioContext（否则长期驻留占音频流）；② 每次 play 时 `resume()` + 音量实时读取。
- 自定义音频（上传文件、dataURL、1 MiB 上限、localStorage）属于「锦上添花」，第一版可以不做，保留 `SoundId` 枚举里的 `custom` 但 UI 不暴露（或整个砍掉）。
- **license**：参考包 `package.json` 声明 `"license": "BSD-3-Clause"`（仓库根没有 LICENSE 文件）。若我们直接复制 `sounds.ts` 的参数/结构，按 BSD-3 应保留版权与许可声明；若只借用「Web Audio 合成通知音 + 空闲挂起」这一思路并自己写实现，则不受限。**建议：自己写实现，不复制注释与代码，避免许可与署名负担。**
- React 19 / Node 侧无 `AudioContext`：所有调用点必须 `typeof AudioContext === 'undefined'` 兜底。

---

## 9. 设置栏目 UI 结构（官方 `settings.section` slot）

### 9.1 注册（`client/index.ts:337-345`，逐字）

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'notifications',
  order: 40,
  label: () => t('nav'),
  store,
  locale: NS,
  inject: injected,
}, NotificationsSection))
```

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `name` | `'settings.section'` | slot 名（官方设置面板的栏目 seat） |
| `id` | `'notifications'` | 栏目 id；设置外壳只给自己的已知 id 配导航图标，其它显示默认齿轮（README 提到） |
| `order` | `40` | 排序 |
| `label` | `() => t('nav')` | 侧边栏条目文案（namespace 已注册） |
| `store` | `createNotificationsStore()` 的结果 | 交给 slot 渲染器**持有**（renderer 拥有实例，`useStore` 读它） |
| `locale` | `NS = 'notifications'` | 声明文案命名空间；渲染器给组件注入 `t` |
| `inject` | `injected` 工厂 | **渲染器调用**，传入 `BoundActions<typeof store>`，返回业务回调对象（组件 props 的一部分） |

`ctx.slots.inject(...)` 返回 off 函数；外层 `inject` 再包一层是为了「slot 存在才注册」。

### 9.2 组件 props 三元组

```ts
// src/client/NotificationsSection.tsx:53-58
export type NotificationsSectionProps =
  PropsRuntime<'settings.section'>      // t, close 等运行时
  & PropsStore<ReturnType<typeof createNotificationsStore>>  // useStore
  & PropsLocale<'notifications'>        // t（命名空间绑定）
  & NotificationsSectionInjected        // 业务回调（inject 工厂返回）
```

`inject` 工厂（`client/index.ts:298-335`，逐字节选）：

```ts
const injected = (actions: BoundActions<typeof store>): NotificationsSectionInjected => {
  bound = actions
  // First sync on mount: push the accepted scope value into the renderer's store.
  bound.adopt(scope.getSnapshot())
  return {
    setBrowserEnabled: async (enabled) => {
      if (enabled) {
        let permission = browserPermission()
        if (permission === 'default') {
          permission = await requestBrowserPermission()
          bound?.setPermission(permission)
        }
        if (permission !== 'granted') return
      }
      persist('browserEnabled', enabled)
    },
    setCurrentNotificationMode: (mode) => { persist('currentNotificationMode', mode) },
    setNotificationMode: (mode) => { persist('notificationMode', mode) },
    setSoundEnabled: (enabled) => { persist('soundEnabled', enabled) },
    setVolume: (volume) => { persist('volume', Math.min(1, Math.max(0, volume))) },
    setType: (kind, patch) => { persistType(kind, patch) },
    testSound: (sound, customUrl) => { playEffective(sound, customUrl) },
    requestPermission: async () => {
      bound?.setPermission(await requestBrowserPermission())
    },
    testBrowserNotification: () => {
      showBrowserNotification(t('test.notification.title'), t('test.notification.body'), `${NOTIFICATION_TAG_PREFIX}:test`)
    },
    uploadCustomSound: async (kind, file) => {
      if (file.size > MAX_CUSTOM_AUDIO_BYTES) return
      const dataUrl = await readFileAsDataUrl(file)
      writeCustomSound(kind, dataUrl)
      bound?.setCustomSound(kind, dataUrl)
      // Uploading from the 自定义 picker selection persists the selection too.
      persistType(kind, { sound: 'custom' })
    },
  }
}
```

关键点：

- **`bound` 是渲染器拥有的 store actions**；`inject` 工厂在挂载时被调用并完成**第一次同步**（`adopt`）。插件 apply 阶段不能自己 new 第二个 store。
- `bound?.xxx` 全部可选链：模块卸载/未挂载时安全。
- 权限申请发生在 **inject 回调里**（用户点击开关 → 真用户手势）。

### 9.3 行清单（9 行）

`NotificationsSection` 渲染 `<div.section> <h3.title> <p.intro> <ul.rows>`，`li.row` 依次为：

| # | 行 | 左侧 | 右侧控件 | 文案 key |
| --- | --- | --- | --- | --- |
| 1 | 浏览器通知（master） | `browser.title` / `browser.desc` | 条件按钮（授权/测试通知）+ 状态文字 + Switch | `browser.*`、`permission.*`、`test.send` |
| 2 | 当前会话提醒时机 | `current.title` / `current.desc` | `SelectMenu`（3 选 1） | `current.*`、`current.mode.*` |
| 3 | 通知范围 | `mode.title` / `mode.desc` | `SelectMenu`（3 选 1） | `mode.*` |
| 4 | 提示音（master） | `sound.title` / `sound.desc` | Switch | `sound.*` |
| 5 | 音量 | `volume.title` / `volume.desc` | `VolumeSlider` + `%` | `volume.*` |
| 6 | 会话完成 | icon + `type.completed.*` | 试听按钮 + `SoundMenu` + Switch | `type.completed.*` |
| 7 | 会话失败 | icon + `type.failed.*` | 同上（`custom.replace` 条件出现） | `type.failed.*` |
| 8 | 问问题 | icon + `type.question.*` | 同上 | `type.question.*` |
| 9 | 权限请求 | icon + `type.permission.*` | 同上 | `type.permission.*` |

测试断言：6 个 `role=switch`（browser + sound + 4 kinds，`tests/section.spec.tsx:72-75`）；4 个 kind 行各有一个 sound picker，加上 master 行的 label `提示音` 共 5 个同名 label（`:91-97`）。

### 9.4 每行 DOM 结构（CSS Module 类名）

```jsx
<li className={css.row}>
  {/* kind 行才有 */}
  <Icon className={css.rowIcon} size={iconSize} aria-hidden="true" />
  <div className={css.rowText}>
    <div className={css.rowTitle}>{title}</div>
    <div className={css.desc}>{desc}</div>
  </div>
  <div className={css.rowActions}>
    {/* 条件按钮：更换 / 试听 / 授权 / 测试通知 */}
    <Button variant="outline" size="sm" ...>{label}</Button>
    {/* 下拉：SelectMenu 或 SoundMenu */}
    <button type="button" className={css.selector} aria-haspopup="menu" aria-expanded={open} aria-label={...}>
      {当前值文案}<IconChevronDownOutlineRegular className={css.chevron} />
    </button>
    <Switch on={...} label={...} onChange={...} />
  </div>
  {/* kind 行才有：隐藏的 file input */}
  <input ref={fileRef} className={css.fileInput} type="file" accept="audio/*" aria-label={t('sound.custom')} ... />
</li>
```

CSS 类名全集（`NotificationsSection.module.css`）：`section, title, intro, rows, row, rowIcon, rowText, rowTitle, desc, rowActions, permissionState, selector, chevron, switch, switchTrack, switchThumb, volumeControl, slider, sliderRail, sliderFill, sliderThumb, volumeValue, fileInput`。

设计语言（可直接复用到 toolkit 的 tokens）：18/28 标题、14/22 行名、12/18 说明、行 `padding:16px 0` + `border-bottom:1px solid var(--dsw-alias-border-l2)`、控制簇 `gap:6px`；所有颜色走 `--dsw-alias-label-primary/tertiary`、`--dsw-alias-border-l2/l3`、`--dsw-alias-bg-module-platform`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-state-business-primary`、`--dsw-alias-bg-layer-1`；过渡 `--ds-ease-in-out`；`@media (prefers-reduced-motion: reduce)` 关掉过渡。

### 9.5 三个自绘控件（参考实现没用原生控件）

1. **Switch**（`:89-108`）：`<button role="switch" aria-checked={on} aria-label>` 内嵌 `span.switchTrack[data-on]` + `span.switchThumb`；track 28×16 r8，thumb 12×12，`data-on` 时 `translateX(12px)` 并染 business 色。
2. **VolumeSlider**（`:116-182`）：`div role="slider" aria-valuemin=0 aria-valuemax=100 aria-valuenow=percent tabIndex=0`；指针事件 `setPointerCapture` + `getBoundingClientRect` 算比例；值**量化到 1/20**（5% 步进，`Math.round(r*20)/20`）；键盘 `ArrowRight/Up +0.05`、`ArrowLeft/Down -0.05`、`Home 0`、`End 1`；旁边显示 `NN%`。
3. **SelectMenu / SoundMenu**（`:380-455`）：包官方 `Menu`（`items: [{id,label}]`、`selectedId`、`onSelect`、`align="end"`、`portal`、`anchor=<button.selector>`），anchor 是 h28 r14 胶囊 + chevron。`SoundMenu` 的 items 是 `['chime','fault','pop','alert','custom','none']`。

### 9.6 权限状态的 UI 规则（`NotificationsSection.tsx:194-229`）

| `permission` | `browserEnabled` | 渲染 |
| --- | --- | --- |
| `granted` | true | 显示「测试通知」按钮 |
| `default` | 任意 | 显示「授权」按钮（点击 `requestPermission`） |
| `denied` | 任意 | 显示「已拒绝」状态文字（无按钮） |
| `unsupported` | 任意 | 显示「当前环境不支持浏览器通知」 |
| 任意但 `!== 'granted'` | **true** | 追加「通知已暂停：缺少浏览器权限」 |
| `granted` | false | 什么都不显示（只有开关） |

注意：`permission.granted` 文案存在但**永远不显示**（测试 `shows no status text or request button once granted` 断言它不出现）。

### 9.7 自定义音频的交互流（`TypeRow`，`:302-363`）

- 选中「自定义」但**还没有文件** → 不写偏好，直接 `fileRef.current?.click()` 打开文件选择器；文件选完后 `uploadCustomSound` 会 `writeCustomSound` + 镜像 + **`persistType(kind,{sound:'custom'})`**（选中的动作在文件到位后完成）。
- 已有文件且选中自定义 → 显示「更换」按钮（再次点开文件选择器）。
- 「试听」按钮显示条件：`audible = (customSelected && hasCustom) || (sound !== 'none' && sound !== 'custom')`；点试听时 custom 带 dataURL（`testSound('custom', url)`），否则 `testSound(sound)`。
- `sound === 'none'` → 无试听按钮。
- 文件输入 `accept="audio/*"`、选完 `event.currentTarget.value=''`（允许重复选同一文件）。
- 大小上限 `MAX_CUSTOM_AUDIO_BYTES = 1_048_576`，超限静默忽略（`client/index.ts:327`）。

### 9.8 locale 注册与类型安全

```ts
// src/client/locales.ts:1-8, 61-62
/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = { 'nav': '通知', ... } satisfies Record<string, string>
export type NotificationsKey = keyof typeof zh
/** English dictionary, checked complete against the zh key set. */
export const en = { 'nav': 'Notifications', ... } satisfies Record<NotificationsKey, string>
```

```ts
// src/client/index.ts:64-69, 78-79, 95
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Notifications settings section's copy. */
    'notifications': NotificationsKey
  }
}
const NS = 'notifications'
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-notification: dictionaries')
const t = ctx.locale.bind(NS)
const translate = (key: string): string => t(key as NotificationsKey)
```

- 组件里 `t` 是 slot 注入的命名空间绑定（`PropsLocale<'notifications'>`），dispatcher 里用 `translate`。
- 中英必须 key 对称，否则 `en satisfies Record<NotificationsKey,string>` 编译失败。

### 9.9 CSS Modules 的构建方式（tsdown + lightningcss）

- 组件 `import css from './NotificationsSection.module.css'`；tsdown 插件把 `.module.css` 编译成 `{ hashedClass: 'hash_local' }` 映射，并在工厂执行时注入 `<style data-plugin="dsh-session-notification">`，卸载时由 loader 移除。
- 我们在 dsh-toolkit 里**没有 CSS Modules**：走 `installStylesheet(cssText, id)` + `settings.css` 的命名空间前缀方案（见 §10.2）。

---

## 10. 我们要抄什么、改什么

### 10.1 目标行为（用户要求）

1. 系统通知 **标题 = 会话标题**（session title），**副标题/正文 = 最后一条 assistant 回复文本**（参考实现是「标题=本轮最后一条用户消息」，方向相反）；
2. **点击通知必须聚焦/唤起 DSH，并导航到该会话**（参考实现已有 `window.focus()` + `openSession`，但标题/正文来源要改，且桌面端唤起需实测）。

### 10.2 目标代码库（dsh-toolkit）现状与差异

| 维度 | 参考实现 | dsh-toolkit | 移植决策 |
| --- | --- | --- | --- |
| 语言 | TypeScript（strict） | 纯 JS/JSX（`.js/.jsx`），`tsc --noEmit` 检查 | 引擎/端口用 JSDoc 类型注释；不要引入 `.ts` 构建链 |
| 构建 | tsdown（自建两产物） | esbuild（`scripts/build-client.mjs`），单 `window.__ModuleLoader__.load` 闭包 | 模块加进 `src/client/index.js` 的 `ctx.plugin` 列表即可；`lib/` 是产物，禁止手改 |
| JSX | React 18 + 正常 JSX | 全局工厂 `__dshReact.createElement`；工厂里先 `globalThis.__dshReact = require('react')` | 组件按 usage/mobile 模块的工厂模式写；`.jsx` 文件由 esbuild 全局 `jsxFactory` 处理 |
| React | 18 | 19 | 无 `forwardRef`/`useSyncExternalStore` 兼容问题时可原样；**不要用 `PropsStore/useStore`**（见下） |
| store | `@deepseek-ai/dsh-client-store` 的 `defineStore` + slot `store` 契约 | **全仓库没有 defineStore**，注册 `settings.section` 时也不传 `store/inject` | 方案 A（推荐）：自持 scope + `useSyncExternalStore`；方案 B：若确认 shell 提供 `dsh-client-store`，可照抄 store 契约 |
| 样式 | CSS Modules（lightningcss） | 普通 CSS 文本 + `installStylesheet(css, id)`；共享 `src/client/styles/settings.css` + `settingsStyles(namespace)` | 新建 `styles.css`（用 `nt-`/`notification-` 前缀避免串味），或把行样式加进 `settings.css` 的命名空间列表 |
| locale | `ctx.locale.register(NS,{zh,en})` + `PropsLocale` | 同样 `ctx.locale.register(NS, {zh,en})`，但组件用自建 `createTranslator(ctx)`（见 `usage/client/locale.js`）不依赖 slot 注入 | 用 toolkit 的 translator 模式（带内置中文兜底），`label: () => t('nav')` 照旧 |
| 设置栏注册 | `store/locale/inject` 全用 | `ctx.slots.inject('settings.section', () => ctx.slots.register({name,id,order,label,locale}, Component))`（见 `usage/client/index.jsx:66-72`） | 沿用 toolkit 写法；组件自己管理状态并订阅 scope |
| 测试 | vitest + @testing-library/react | `node --test` + `scripts/jsx-register.mjs`；jsdom 30 可用；**没有 testing-library** | 引擎/分发器/仲裁/通知包装用纯 node 测试（最容易）；UI 用 `react-dom/client` + 手工 DOM 断言（或先不测 UI） |
| 服务可用性 | `ctx.sessions / uiConversation / uiSession / uiWorkspace` 全在 `inject` | 现有 archived 模块已用 `ctx.sessions`；package.json 的 `dsh.client.inject` 未列 ui-conversation/ui-session/api-session-controller/ui-workspace | **必须先运行时探测**（§10.5）；全部读取用可选链 + try/catch 降级 |

### 10.3 建议的模块文件清单（对接 dsh-toolkit 结构）

```
src/modules/notification/
  client/
    index.jsx          // createNotifications(require) 工厂：inject、locale、样式、engine、dispatcher、section 注册
    engine.js          // NotificationEngine（纯逻辑，端口注入）
    detail.js          // sessionDetailOf / truncateTitle / truncateDetail
    dispatcher.js      // NotificationDispatcher
    prefs.js           // 默认值 + resolve + localStorage scope（或复用 configForms？）
    browser-notify.js  // Notification 包装（focus + navigate）
    sounds.js          // Web Audio 合成（可后置）
    tab-coordinator.js // BroadcastChannel 仲裁
    section.jsx        // 设置栏组件
    locale.js          // NS + {zh,en} + createTranslator 兜底
    styles.css         // 行/开关/滑块/下拉样式
```

接入点：

- `src/client/index.js`：`import createNotifications from '../modules/notification/client/index.jsx'`，在 `apply` 里 `ctx.plugin({ ...createNotifications(require) })`；
- `scripts/build-client.mjs`：**不需要**改（共享 bundle 会打进 `lib/client.js`）；只有当你想给该模块出独立测试 bundle 时才加进 `clients` 数组（那是 `scripts/` 的改动，由 Lead 决定）；
- `package.json` 的 `dsh.client.inject`：若要强依赖会话/对话/工作区客户端插件，需追加对应包名（**package.json 不在我的可写范围，留给 Lead**）；
- `scripts/test.mjs` 的测试组列表：新测试目录要加进去（同上）。

### 10.4 通知标题/正文/点击的具体设计（本文最重要的改动）

#### 标题与正文

参考实现 `dispatcher` 的文案模型是「title = 本地化种类名，body = 模板 + 会话/消息」，我们要换成：

| 位置 | 参考实现 | 我们的实现 |
| --- | --- | --- |
| 系统通知 `title` | `t('notify.<kind>.title')`（"会话完成"） | **会话标题**（`titleOf(sessionId)`，即 `byId[id].displayTitle`，空则 `id`） |
| 系统通知 `body` | completed: `「{title}」已完成\n{finalText}`；其它: 模板内联 detail | **最后一条 assistant 回复**（`SessionDetail.finalText`，`truncateDetail` 160 字）；failed 用失败消息；question/permission 用问题/工具名 |
| 声音 | 按 kind | 不变 |
| 点击 | `window.focus()` + `openSession` | 不变（+ 桌面唤起兜底，见下） |

实现落点（最小改动）：

1. **引擎**：`NotificationEvent.title` 改成会话标题（`this.ports.titleOf(id)`），把「本轮用户消息」从主标题里拿掉（可以继续放进 `detail` 之外的附加字段，或直接不用）。这样 `dispatcher` 的 `{title}` 占位符天然就是会话标题。
2. **分发器**：给 completed 的 body 改成「`detail` 优先，空则回落到 `t('notify.completed.title')`」；failed/question/permission 的模板改为「只有 detail（+ 少量前缀）」或干脆 `body = detail`。保留 `notify.*` 文案 key 作兜底，避免空正文。
3. **Web Notification 没有标准 `subtitle` 字段**：`NotificationOptions` 只有 `title/body/icon/badge/tag/data/...`。所以「副标题」必须落在 **body**；若坚持要视觉上的「两行」，只能是 body 内换行（`${sessionTitle}\n${reply}` 但 title 又重复）或 `body = 回复` 单行。建议：
   - `title = 会话标题`（截断 60 字，折叠空白）；
   - `body = 最后回复`（截断 160 字）；
   - 可选：Electron/macOS 下向 options 里附加 `subtitle`（非标准，被忽略无副作用），但**参考实现没有这么做，也不要在 Web 端依赖它**。
4. 标题的「哪条回复」：`finalText` 取的是**最后一个文本非空的 `assistant-step`**，即上一轮 run 的最终回复；对 question/permission 事件，`finalText` 可能是「准备提问前的那句话」，此时用问题文本/工具名更合适（与参考一致）。
5. 如果会话标题为空（`''`/undefined）→ `id`；若还想更好看，可回落到 `lastUserText`（参考实现的主标题）作为 body 前缀，而不是改 title。

#### 点击：聚焦/唤起 + 导航

链路（照抄 + 补强）：

```js
// browser-notify（我们版）
notification.onclick = () => {
  forget()
  window.focus()                 // Web：把标签页/窗口拉到前台
  try {
    onActivate?.()               // 导航：openSession(sessionId)
  } catch (e) { console.warn(...) }
  notification.close()
}
```

`onActivate` 的接线（参考实现 `client/index.ts:137-143`）：

```js
showBrowser: (title, body, tag, sessionId) => showBrowserNotification(title, body, tag, () => {
  try {
    ctx.uiWorkspace.openSession(sessionId)
  } catch (error) {
    console.warn('[dsh-session-notification] could not open the notification session', sessionId, error)
  }
})
```

桌面端（Electron）要实测的三种情况：

1. 窗口**可见但失焦** → `window.focus()` 一般有效；
2. 窗口**最小化** → `window.focus()` 在 Electron 里不保证 restoring window；需要外壳 API（参考实现未显式调用，README 声称由外壳处理）；
3. 窗口**隐藏**（关闭按钮=隐藏）→ 同上。

若实测 2/3 不生效，`onActivate` 里补一次桌面桥调用（例如 `globalThis.dshDesktop?.activate?.()` / `focusWindow?.()`，具体名字要在目标 shell 里确认），用可选链 + try/catch，缺失时静默退回 `window.focus()`。**不要**为此引入宿主改动。

#### tag 策略（要改）

参考实现 `tag = 'dsh-session-notification:<kind>'` → 同 kind 通知互相覆盖。我们把标题改成会话标题后，两个不同会话的 completed 会互相**吃掉**一张卡。建议：

- `tag = 'dsh-toolkit-notification:<sessionId>'`（每会话一张卡，同会话重复事件替换）；
- 若还想区分 kind：`...:<sessionId>:<kind>`（会让同会话的完成/失败并存，数量翻倍）；
- `renotify: true` 保留，让替换重新提醒；
- 去重键（tab coordinator）仍用 `${sessionId}:${kind}`，与 tag 解耦。

#### 其它可选增强（第一版可不做）

- `requireInteraction: true` 让卡片常驻直到点击（Windows 操作中心会堆积，慎用）；
- 通知里带「会话项目/工作区」信息（需要额外投影）；
- 点击后滚动到该会话的最后一条消息（`openSession` 之外还需要 UI API）。

### 10.5 必须先验证的宿主 API（阻塞项）

| 需要 | 参考实现用法 | 在 dsh-toolkit/当前 DSH 中确认方式 |
| --- | --- | --- |
| 会话列表 | `ctx.sessions.list.getSnapshot()` + `.subscribe()` | ✅ toolkit 已有使用（`archived/client/model.js:21`） |
| 单会话 binding | `ctx.sessions.binding(id)` → `binding.session.getSnapshot()` | 运行 `typeof ctx.sessions.binding` / 打印 binding 形状 |
| 对话/聊天节点 | `ctx.uiConversation.binding(binding).activate('chat')` + `.target('chat').getSnapshot()` | 探测 `ctx.uiConversation` 是否存在；`activate`/`target` 方法名是否仍一致 |
| 待交互 | `ctx.uiSession.sessionStatus.getSnapshot()/subscribe` → `pendingInteraction{key,kind,questions,toolName}` | 同上；注意版本可能把它放在别的服务 |
| 当前会话 | `ctx.sessions.retainInfo(id).getSnapshot().retainedBy.mainView` | 若不存在：退化到「不静音当前会话」或自己跟踪 |
| 导航 | `ctx.uiWorkspace.openSession(sessionId)` | 探测 `ctx.uiWorkspace.openSession`；否则寻找 shell 的会话选中 API（可能需 DOM 兜底，不推荐） |
| 会话加载 | `ctx.sessions.using(id, {source}, fn)` | 探测；没有就跳过 `ensureDetail`（未打开会话只能拿 `lastAgentError`） |
| 平台标识 | `'dshDesktop' in globalThis` | 直接可用 |
| projection | `list.getSnapshot().projectionsBySession[id].values.inbox/goal` | 打印一个真实会话的 `values` 键名，确认 `inbox['next-turn']`、`goal.goal.phase` 形状 |

建议做法：写一个一次性探测脚本/临时 console 输出（不落盘），把 `Object.keys(ctx.sessions)`、`Object.keys(ctx)`（客户端根上下文）打印出来，确认后再定端口实现。**所有读取都要可选链 + try/catch，缺失时模块静默降级（不抛、不阻塞其它 toolkit 模块）。**

### 10.6 风险与「不要抄」的清单

**不要抄**：

- 宿主半区（`src/index.ts` / `schema.ts`）：我们的偏好走 localStorage，不需要 schemastery 命名空间；toolkit 的宿主半区结构也不同。
- `defineStore` + slot `store/inject` 契约：toolkit 没这套运行时依赖，硬接会引入 `@deepseek-ai/dsh-client-store` 的可用性风险。
- CSS Modules：toolkit 用普通 CSS。
- 遗留字段迁移（`notifyCurrent/mainOnly/waitForSubagents`）：我们没有历史数据。
- 全部 zh/en 文案原样：部分文案（如「主会话 + 等子会话」）可保留，标题相关 key 要按新语义重写。

**风险点**：

1. `activate('chat')` 若在目标版本不存在/语义变化 → `finalText` 恒空 → 通知 body 为空。需要日志 + 降级（body 用 `t('notify.completed.title')`）。
2. `hasUnfinishedWork` 的 projection 键名若变化 → 「暂停误报完成」回归。先打印真实 projection。
3. 桌面点击唤起不完整（§10.4）。
4. `pageIcon` 在 `dsh-app://` 下被跳过 → 桌面用应用图标（符合预期）。
5. 多标签仲裁的 50/60/1000ms 常量在慢机器上可能导致「两个标签都响」或「都不响」；保持可注入 + 测试。
6. Web Audio 需要用户激活；首次自动响可能被 autoplay 策略拒绝——`playCustom` 已有 `catch`，内置 `play()` 的 `resume()` 失败也应 catch。
7. 未读/点击后清状态：参考实现**没有**；如果用户要求，需要额外的会话 API。
8. localStorage key 与参考插件冲突：参考插件若同时安装，键名 `dsh-session-notification*` 会被两边共用/互相覆盖。**我们用 `dsh-toolkit:notification:preferences` 这类自有前缀**。

### 10.7 建议的实现顺序

1. **探测宿主 API**（§10.5），把 `sessions.list` / `binding` / `uiConversation` / `uiSession` / `uiWorkspace` 的形状打印出来；
2. `prefs.js` + `detail.js` + `engine.js` + `dispatcher.js`（纯逻辑，先写单测，不碰 UI）；
3. `browser-notify.js`（权限、图标、点击、tag）+ 手工验证点击能跳会话；
4. `sounds.js`（可选）+ `tab-coordinator.js`；
5. `section.jsx` + `locale.js` + `styles.css`，注册 `settings.section`；
6. 在 `src/client/index.js` 挂上模块，`pnpm build` + 重启 DSH 实测（注意 toolkit 的 README：Host 半区改动需重启，客户端 bundle 重新 build 即可）。

---

## 11. 最棘手的 6 段代码（速查 + 行号）

已经在前文逐字给出的，这里只列「为什么难 + 抄的时候盯什么 + 定位」，避免重复大段代码：

| # | 代码 | 位置 | 难点 | 抄的时候盯 |
| --- | --- | --- | --- | --- |
| 1 | `settleRun` 分类 | `src/client/notification-service.ts:267-318` | async + 新 run 竞争 + silenced 复查 + `ensureDetail` 顺序 + failed 不参与 hold/unfinished | `if (this.runs.has(id)) return`、`finally settling.delete`、failed 分支在 unfinished 检查之前 |
| 2 | `hasUnfinishedWork` | `src/client/index.ts:196-210` | projection 是 wire 形状的结构性读取；goal 有轮次上限例外 | `next-turn` / `next-step` 都是数组；`roundsStarted < maxGoalRounds`；**键名必须实测** |
| 3 | 对话快照获取 | `src/client/index.ts:155-181` | `binding → uiConversation.binding → activate('chat') → target('chat') → sessionDetailOf`，任何一步失败都降级；`activate` 易漏 | try/catch 包整块、`activate` 必须在 `target` 之前、`chat` 可能是 undefined |
| 4 | 节点扫描 `sessionDetailOf` | `src/client/notification-service.ts:352-394` | 三种 node kind 的 data 形状；user 只认 `source.kind==='user'`；assistant 只认最后一个非空 step；turn-error 取 max seq | `join('')` 无分隔、`if (text.length > 0)` 才覆盖、`data.seq > maxTurnErrorSeq` 严格大于 |
| 5 | 通知点击 + 图标 + silent | `src/client/browser-notify.ts:106-173` | 强引用防 GC、`window.focus()` 顺序、回调异常仍要 close、icon 过滤 + 构造失败重试、desktop silent | `liveNotifications.add`、`{once:true}` 的 close 监听、`try { onActivate } finally close`（参考是 try/catch 后无条件 close） |
| 6 | 跨标签仲裁 `claim` | `src/client/tab-coordinator.ts:126-154` | 去重窗口 + 可见性让位 + 仲裁窗口 + 平局 tabId + 无 channel 降级 | `recent` 先写再判断、背景先等 grace、`wins` 优先、`beats()` 平局规则 |

另外两段也很容易写错，附上行号：

| 代码 | 位置 | 注意 |
| --- | --- | --- |
| `forgetSubagents` | `src/client/notification-service.ts:171-179` | 遍历 `prevRunning/runs/pendingKeys` 的并集；只删子会话 |
| slot `inject` 工厂 + 注册 | `src/client/index.ts:298-345` | 首次 `adopt` 同步、`bound?.` 可选链、权限在回调里申请、`ctx.slots.inject` 包 `register` |

```ts
// src/client/notification-service.ts:171-179（forgetSubagents，逐字）
/** Drop tracking state for every subagent session (subagents were silenced). */
private forgetSubagents(): void {
  for (const id of new Set([...this.prevRunning.keys(), ...this.runs.keys(), ...this.pendingKeys.keys()])) {
    if (!this.ports.isSubagent(id)) continue
    this.prevRunning.delete(id)
    this.runs.delete(id)
    this.pendingKeys.delete(id)
  }
}
```

```ts
// src/client/notification-service.ts:136-145（模式切换，逐字）
setNotificationMode(mode: NotificationMode): void {
  const previous = this.mode
  this.mode = mode
  // Silencing subagents forgets their tracking so a stale running edge can
  // never fire for one after the switch.
  if (mode !== 'all') this.forgetSubagents()
  // Leaving the waiting mode releases anything already held.
  if (previous === 'main-wait' && mode !== 'main-wait') this.releaseHeld()
}
```

---

## 12. 移植后的验收测试清单（建议）

把参考仓库的 `tests/*.spec.ts` 翻译成 toolkit 的 `node --test`（纯逻辑部分不需要 jsdom）：

### 12.1 引擎（对应 `tests/notification-engine.spec.ts`）

| 用例 | 期望 |
| --- | --- |
| seed 时已空闲 | 不 emit |
| seed 时在跑，随后结束 | emit completed（detail = finalText） |
| 观察到 running→false 且无错误 | completed |
| 期间出现 turn-error（seq 增大） | failed，detail = failureMessage |
| 期间 lastAgentError 变为非空/变化 | failed，detail = agentError |
| 预跑就有的旧 agentError | completed（基线，不误判） |
| pending question 出现 | question |
| pending approval 出现 | permission |
| pending key 替换 | 再 emit 一次 |
| pending kind 切换 | 再 emit（不同 kind） |
| pending 消失 | 不 emit |
| ensureDetail 先于 detail 读取 | 顺序断言 |
| ensureDetail 抛错 | 仍按现有 detail 分类 |
| settle 期间新 run armed | 丢弃旧分类 |
| 会话离开列表再回来 | 重新建立边沿 |
| 默认 main-wait 下子会话静音 | 只有主会话 emit |
| 子会话 pending 静音 | 只有主会话 |
| 切到 all 后子会话提醒 | emit |
| 切回 main 中途遗忘子会话 | 不 emit |
| 有后代在跑时 hold，后代停后 emit 一次 | emit 1 次 |
| 失败不 hold | failed 立即 |
| 关闭 wait 后立即放行 | emit |
| 新 run 丢弃 held | 只有第二次 emit |
| 标题=最后用户消息（参考行为；我们改为会话标题后此用例替换） | — |
| 有 unfinished work 时静默；清除后不补发；下一轮结束才 emit | — |
| 失败不受 unfinished 影响 | failed |
| held + unfinished → 丢弃 | 不 emit |

### 12.2 分发器（对应 `tests/dispatcher.spec.ts`）

- 不在当前会话 → 声音 + 通知都发，tag = `prefix:kind`（我们改 per-session）；
- completed 的 body 带回复文本（我们改为「body 就是回复文本」）；
- kind 关闭 → 声音/通知都不发；
- `soundEnabled=false` 或 `sound='none'` → 不响；
- 当前会话矩阵（6 种组合，§4.2）；
- `browserEnabled=false` → 只响声音；
- custom 选中且有文件 → 播放 custom；自定义休眠 → 内置；自定义选中无文件 → 静默；
- `{title}`/`{detail}` 插值。

### 12.3 浏览器通知（对应 `tests/browser-notify.spec.ts`，需 jsdom + 桩 Notification）

页面图标（apple-touch-icon 优先 / SVG data 丢弃 / PNG data 保留 / custom scheme 丢弃 / 无 icon）、点击顺序（focus → 回调 → close）、回调抛错仍 close、desktop silent、renotify+tag、无权限返回 false、无 API 返回 false、带 icon 构造失败重试。

### 12.4 标签仲裁（对应 `tests/tab-coordinator.spec.ts`）

无 channel → true；dedupe 窗口；两个可见标签一个赢；背景让位；全背景也选一个；不同 key 各自赢。

### 12.5 声音（可选，对应 `tests/sounds.spec.ts`）

pattern 合法 + 时长上限 + 四者不同；音量 clamp；播放后 idle suspend；下次 play resume；新播放取消旧 suspend；dispose 关闭 context。

### 12.6 设置栏（可选）

用 `react-dom/server` 渲染片段或 jsdom + `react-dom/client`：行数、switch 数、下拉选择回调、音量键盘事件、权限状态分支、自定义音频流程。toolkit 没有 @testing-library/react，需要手工 `querySelector`。

---

## 13. 参考文件索引（绝对路径）

| 文件 | 行数 | 关键内容 |
| --- | --- | --- |
| [src/index.ts](<D:/项目/dsh-session-notification-main/src/index.ts>) | 25 | 惰性宿主半区、re-export |
| [src/settings.ts](<D:/项目/dsh-session-notification-main/src/settings.ts>) | 189 | 枚举、默认值、`resolveNotificationSettings` |
| [src/schema.ts](<D:/项目/dsh-session-notification-main/src/schema.ts>) | 50 | 宿主 wire schema（我们不抄） |
| [src/client/index.ts](<D:/项目/dsh-session-notification-main/src/client/index.ts>) | 346 | 全部接线：服务端口、dispatcher/engine 装配、section 注册 |
| [src/client/notification-service.ts](<D:/项目/dsh-session-notification-main/src/client/notification-service.ts>) | 490 | 引擎 + 分发器 + `sessionDetailOf` |
| [src/client/browser-notify.ts](<D:/项目/dsh-session-notification-main/src/client/browser-notify.ts>) | 173 | Notification 包装、点击、图标、silent |
| [src/client/tab-coordinator.ts](<D:/项目/dsh-session-notification-main/src/client/tab-coordinator.ts>) | 160 | BroadcastChannel 仲裁 |
| [src/client/sounds.ts](<D:/项目/dsh-session-notification-main/src/client/sounds.ts>) | 275 | Web Audio 合成 + 空闲挂起 |
| [src/client/custom-audio.ts](<D:/项目/dsh-session-notification-main/src/client/custom-audio.ts>) | 72 | 自定义音频 localStorage |
| [src/client/local-settings.ts](<D:/项目/dsh-session-notification-main/src/client/local-settings.ts>) | 162 | ConfigForm over localStorage、跨标签同步 |
| [src/client/settings-store.ts](<D:/项目/dsh-session-notification-main/src/client/settings-store.ts>) | 100 | 设置栏镜像 store |
| [src/client/locales.ts](<D:/项目/dsh-session-notification-main/src/client/locales.ts>) | 117 | zh/en 文案 |
| [src/client/NotificationsSection.tsx](<D:/项目/dsh-session-notification-main/src/client/NotificationsSection.tsx>) | 455 | 设置栏组件（9 行、3 个自绘控件） |
| [src/client/NotificationsSection.module.css](<D:/项目/dsh-session-notification-main/src/client/NotificationsSection.module.css>) | 246 | 行/开关/滑块/胶囊样式 |
| [tests/notification-engine.spec.ts](<D:/项目/dsh-session-notification-main/tests/notification-engine.spec.ts>) | 465 | 引擎全部行为断言 |
| [tests/dispatcher.spec.ts](<D:/项目/dsh-session-notification-main/tests/dispatcher.spec.ts>) | 191 | 门控矩阵 |
| [tests/browser-notify.spec.ts](<D:/项目/dsh-session-notification-main/tests/browser-notify.spec.ts>) | 180 | 通知包装 |
| [tests/tab-coordinator.spec.ts](<D:/项目/dsh-session-notification-main/tests/tab-coordinator.spec.ts>) | 83 | 仲裁 |
| [tests/local-settings.spec.ts](<D:/项目/dsh-session-notification-main/tests/local-settings.spec.ts>) | 115 | 本地 scope |
| [tests/section.spec.tsx](<D:/项目/dsh-session-notification-main/tests/section.spec.tsx>) | 252 | 设置栏渲染 |
| [tests/sounds.spec.ts](<D:/项目/dsh-session-notification-main/tests/sounds.spec.ts>) | 252 | 声音调度 |
| [tests/settings.spec.ts](<D:/项目/dsh-session-notification-main/tests/settings.spec.ts>) | 95 | 偏好解码 |
| [README.md](<D:/项目/dsh-session-notification-main/README.md>) / [README.zh.md](<D:/项目/dsh-session-notification-main/README.zh.md>) | 111 / 111 | 产品行为与已知限制 |
| [package.json](<D:/项目/dsh-session-notification-main/package.json>) | — | BSD-3-Clause、`@deepseek-ai/dsh-*` devDependencies `^0.2.1-rc.2`、`dsh.client.inject` 列表 |
| [tsdown.config.ts](<D:/项目/dsh-session-notification-main/tsdown.config.ts>) | — | 两个产物 + CSS Modules 内联插件 |
| [vitest.config.ts](<D:/项目/dsh-session-notification-main/vitest.config.ts>) | — | node 环境 + primitives stub |

---

## 附录 A：常量速查（字符串级）

| 名称 | 值 | 位置 |
| --- | --- | --- |
| 设置命名空间 | `dsh-session-notification` | `settings.ts:9` |
| locale 命名空间 | `notifications` | `client/index.ts:79` |
| localStorage 偏好键 | `dsh-session-notification:preferences` | `local-settings.ts:29` |
| 自定义音频键 | `dsh-session-notification.customSounds` | `custom-audio.ts:14` |
| 自定义音频上限 | `1_048_576` 字节 | `custom-audio.ts:17` |
| 通知 tag 前缀 | `dsh-session-notification` | `browser-notify.ts:20` |
| 通知 tag（事件） | `dsh-session-notification:<kind>` | `notification-service.ts:488` |
| 通知 tag（测试） | `dsh-session-notification:test` | `client/index.ts:324` |
| BroadcastChannel 名 | `dsh-session-notification` | `tab-coordinator.ts:20` |
| settle 窗口 | `250` ms | `client/index.ts:82` |
| 仲裁窗口 | `50` ms | `tab-coordinator.ts:23` |
| 可见性让位 | `60` ms | `tab-coordinator.ts:26` |
| 去重窗口 | `1000` ms | `tab-coordinator.ts:29` |
| 标题截断 | 60 字（折叠空白） | `notification-service.ts:397` |
| 详情截断 | 160 字（不折叠） | `notification-service.ts:404` |
| 响度提升 | ×2（≈+6 dB） | `sounds.ts:72` |
| 设置栏 order | `40` | `client/index.ts:340` |
| 默认音量 | `0.6` | `settings.ts:87` |

## 附录 B：事件字段与默认值

| 字段 | 类型 | 默认 |
| --- | --- | --- |
| `browserEnabled` | boolean | `false` |
| `currentNotificationMode` | `'hidden' \| 'unfocused' \| 'always'` | `'hidden'` |
| `notificationMode` | `'all' \| 'main' \| 'main-wait'` | `'main-wait'` |
| `soundEnabled` | boolean | `true` |
| `volume` | number [0,1] | `0.6` |
| `types.completed` | `{enabled:true, sound:'chime'}` | — |
| `types.failed` | `{enabled:true, sound:'fault'}` | — |
| `types.question` | `{enabled:true, sound:'pop'}` | — |
| `types.permission` | `{enabled:true, sound:'alert'}` | — |

## 附录 C：与参考实现的行为差异（我们主动要改的点）

| 项 | 参考 | 我们 |
| --- | --- | --- |
| 通知标题 | 本地化 kind 名（"会话完成"） | **会话标题** |
| 通知正文 | `「本轮最后用户消息」已完成\n最终回复` | **最后 assistant 回复文本** |
| completed 标题来源 | `lastUserText` 优先 | 会话 `displayTitle`，空→`id` |
| tag | 按 kind 折叠 | **按 sessionId 折叠**（避免跨会话覆盖） |
| 点击 | `focus` + `openSession` | 同 + 桌面唤起兜底（实测后决定） |
| pending seed | 未 seed（首帧可能补响一次） | seed 静默（与 README 对齐） |
| 持久化键 | `dsh-session-notification*` | `dsh-toolkit:notification:*`（避免与参考插件冲突） |
| 自定义音频 | 支持上传 | 第一版可不做 |
| 宿主半区/schemastery | 有（惰性） | 不做 |

---

*本笔记只读分析参考仓库产出；除本文件外未修改任何内容。*


