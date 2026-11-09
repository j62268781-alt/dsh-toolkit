# weixin-clawbot 功能流程

微信私聊 ↔ DSH 会话桥。一句话：**消息先进过滤链，再过「审批 / 命令 / 对话」三分支；对话分支始终只驱动一条会话，这条会话是「接管的、恢复的、或新建的」。**

图里的每个判定，都对应 `src/modules/weixin-clawbot/host/` 里的一个函数；容易含糊的四处（谁持有 agent、什么时候换会话、正在回答时能不能换、审批算谁的）在文末有定论表。

## ① 消息入口与过滤

![消息入口与过滤](../../docs/img/weixin-clawbot-flow-1-entry.png)

```mermaid
flowchart TD
  A(["微信消息<br/>getupdates"]) --> F["过滤链（按序，任一不过就丢）<br/>① message_type = 1 → 丢弃<br/>② 发送者非空 → 丢弃<br/>③ 桥接已启用（连接后默认开启）→ 静默丢弃<br/>④ 白名单放行 → 计 skipped + 记最近联系人<br/>⑤ 这条没处理过 → 静默丢弃"]
  F --> H{"有等待中的审批 ?"}
  H -- 是 --> H1{"回复的是 approve / reject ?"}
  H1 -- 是 --> H2["交给审批，结束"]
  H1 -- 否 --> H3["提示：回复 /approve 或 /reject"]
  H -- 否 --> I{"以 / 开头 ?"}
  I -- 是 --> I1["命令分支 /status /sessions /use /new …"]
  I -- 否 --> J["对话链路（见 ②）"]
```

## ② 对话链路：跑一轮并回微信

![对话链路](../../docs/img/weixin-clawbot-flow-2-turn.png)

```mermaid
flowchart TB
  subgraph S1["准备这一轮"]
    direction LR
    J["入队（同一用户串行）"] --> K["解析入站<br/>文本 / 图片 / 文件落 inbox"] --> L["typing 心跳 15s"]
  end
  subgraph S2["跑一轮"]
    direction LR
    M["ensureAgent<br/>选定一条会话"] --> N["followup<br/>whenIdle 最长 180s"] --> O["collectReply<br/>从事件取文本与图片"]
  end
  subgraph S3["回微信"]
    direction LR
    P["prepareOutboundText 整形"] --> Q["sendText 回文字"] --> R["最多再回发 4 张图"]
  end
  S1 --> S2 --> S3
```

## ③ 会话归属：接管 / 恢复 / 新建

![会话归属](../../docs/img/weixin-clawbot-flow-3-ownership.png)

```mermaid
flowchart TD
  A["本轮要用的会话 id = state.sessionId"] --> B{"agents.get(id)<br/>拿到活 agent ?"}
  B -- 是 --> C["接管<br/>owned = false<br/>绝不 dispose"]
  B -- 否 --> D{"该 id 有历史 ?"}
  D -- 是 --> E["resume<br/>preset 用会话头里的 agentPreset"]
  D -- 否 --> F["create<br/>cwd = 桥工作区<br/>preset = 插件配置<br/>+ 身份提示 + 标题"]
  E --> G["owned = true<br/>切走时才 dispose"]
  F --> G
  C --> H["跑这一轮"]
  G --> H
```

## ④ 选会话与切换：`/use` 与 `/new`

![选会话与切换](../../docs/img/weixin-clawbot-flow-4-switch.png)

```mermaid
flowchart TD
  U0(["/use 序号 或 id 前缀"]) --> U1{"当前会话正在回答 ?"}
  U1 -- 是 --> U2["提示先 /cancel<br/>这次不切"]
  U1 -- 否 --> U3["解析目标<br/>序号 → 最近一次 /sessions<br/>前缀 → 跨工作区唯一匹配"]
  U3 --> U4{"解析到唯一目标 ?"}
  U4 -- 否 --> U5["提示：没找到 / 匹配到多条"]
  U4 -- 是 --> U6["release 当前会话<br/>只 dispose 自己 owned 的"]
  U6 --> U7["sessionId = 目标<br/>bindings 落盘"]
  U7 --> U8["下一条消息：接管或恢复目标会话"]
  N0(["/new 或 /reset"]) --> N1["release 当前会话"]
  N1 --> N2["generation + 1 落盘<br/>清掉 bindings"]
  N2 --> N3["新 id = weixin-clawbot-哈希-rN"]
```

## ⑤ 审批转发时序

![审批转发时序](../../docs/img/weixin-clawbot-flow-5-approval.png)

```mermaid
sequenceDiagram
  autonumber
  participant W as 微信
  participant B as bridge
  participant A as 当前绑定会话 Agent
  A->>B: approval/request（工具要越界）
  B->>W: 审批卡片（工具 + 参数 + 会话 id）
  Note over W: 120s 内回复<br/>超时自动拒绝
  W->>B: /approve 或 /reject
  B->>A: 结论（allow / deny）
  Note right of A: 其它会话的审批不经过微信<br/>监听只挂在当前绑定会话上
```

## ⑥-a 选择门禁：还没绑定会话时怎么处理

![选择门禁](../../docs/img/weixin-clawbot-flow-6a-gate.png)

```mermaid
flowchart TD
  M(["微信消息（已过入口过滤）"]) --> C{"以 / 开头 ?"}
  C -- 是 --> C1["基础命令直接执行<br/>/help /start /status /new /use<br/>/sessions /workspaces /cancel …<br/>不被选择门禁拦住"]
  C -- 否 --> N{"有选择卡，且这条是数字 ?"}
  N -- 是 --> N1["按卡执行<br/>（细节见下一张）"]
  N -- 否 --> B{"这个用户已绑定会话 ?"}
  B -- 是 --> P["正常进 Agent"]
  B -- 否 --> S["挂起这条消息<br/>10 分钟内可补跑"]
  S --> K["欢迎语（24 小时内只发一次）<br/>+ 选择卡（先工作区，再会话）"]
  K --> E["等用户回复数字"]
```

- 门禁只拦**拿不准该用哪条会话**的普通消息；命令一律放行，所以第一次用的人发 `/help`、`/status`、`/new` 都不会被卡住。
- 挂起不是丢弃：选完会话后 bridge 会先回一句「接着回你刚才那条：」，再把这条消息补跑掉。
- 超过 10 分钟没选，挂起作废（避免几天后突然冒出个旧问题）；对话里会说明，重新发一句即可。
- 打招呼按人记时间戳，**24 小时内不会重复发**；`/start` 随时可以重新要一张选择卡。

## ⑥-b 选择卡怎么点：先选工作区，再选会话

![选择卡交互](../../docs/img/weixin-clawbot-flow-6b-card.png)

```mermaid
flowchart TD
  A(["收到一个数字"]) --> Z{"现在看的是哪张卡 ?"}
  Z -- 工作区卡 --> W{"数字是多少 ?"}
  W -- "1..N" --> W1["列出这个工作区<br/>（会话只显示标题）"]
  W -- "N+1（最后一项）" --> W2["不选 → 用默认工作区"]
  W -- 其他 --> WX["回「没有 N 这个选项」<br/>卡保留，不换工作区"]
  W1 --> S["会话卡"]
  W2 --> S
  Z -- 会话卡 --> S2{"数字是多少 ?"}
  S2 -- "1" --> S1["在这个工作区新建会话<br/>rotate(cwd)"]
  S2 -- "2..N+1" --> S3["切到这条已有会话<br/>switchTo(id, cwd)"]
  S2 -- "0" --> S0["回到工作区卡"]
  S2 -- 其他 --> SX["回「没有 N 这个选项」<br/>卡保留，不换会话"]
  S1 --> R["已选定会话 → 补跑挂起的那条消息"]
  S3 --> R
```

两张卡的实际样子：

```
先选工作区（回复序号）
1. dsh-toolkit（当前）
2. dsh-plugins
3. 不选，用默认工作区（~）

请选择会话（回复序号）
工作区：dsh-toolkit

1. 新建一条会话
2. 修一下登录跳转
3. 微信桥接的命令设计
0. 换个工作区
```

- **先工作区、再会话**：两步走，每一步的序号都少，卡也短。工作区只显示**目录名**（家目录显示 `~`），会话只显示**标题**——不带长路径、不带 `session_id`。
- 工作区卡的最后一项是「不选，用默认工作区」：不想挑就直接跳过（默认工作区就是桥启动时的工作区，通常是 `~`）。
- 会话卡里 **`1` 固定是新建**，选 `0` 退回工作区卡。该工作区的会话**全列出来**（不截断），所以序号就是卡片上的顺序。
- 一个工作区都没登记时（全新环境），跳过工作区卡直接给默认工作区的会话卡。
- 输入非数字（比如直接说话）不会当成选项，仍按普通消息处理——所以卡在屏幕上时照样可以问别的。

## 五处容易含糊的判定，这里是定论

| 问题 | 结论 | 代码 |
| --- | --- | --- |
| agent 到底谁持有？ | `agents.get(id)` 能拿到活 agent 就说明 GUI（或别处）在跑，我们**只接管、绝不 dispose**；只有我们自己 `resume`/`create` 出来的才在切走时 dispose | `conversation.js` `ensureAgent` / `release` |
| 什么时候换会话？ | **只有** `/use` 和 `/new` 会改 `sessionId`。普通消息永远用当前绑定，不会因为「你提到另一条会话」就跳走 | `conversation.js` `switchTo` / `rotate` |
| 正在回答时能切吗？ | 不能。`/use` 会先看 `agent.status !== 'idle'`，忙就提示先 `/cancel`，避免把跑到一半的回合掐掉。同一用户的普通消息则排队串行 | `conversation.js` `isBusy` / `enqueue` |
| 第一次用的人会被拦住吗？ | 只有「拿不准用哪条会话」的普通消息会被门禁拦下并挂起；命令一律放行。卡 10 分钟有效，选完立刻补跑 | `bridge.js` `handleMessage` / `handleChoice` / `replaySuspended` |
| 欢迎语会天天来吗？ | 不会。按人记 `greeted` 时间戳，24 小时内只发一次；`/start` 主动要卡时才重发 | `picker.js` `GREET_INTERVAL_MS` |
| 审批算谁的？ | 只挂**当前绑定会话**的 `approval/request`：切换时 `detachApproval`，接管时补挂。GUI 里其它会话的审批不会进微信，`/approve` 也批不到它们 | `conversation.js` `attachApproval` / `detachApproval` |

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `/status` | 通道 + 桥接状态（收到 / 回复 / 跳过、当前会话、是否手动绑定） |
| `/where`、`/info` | 当前工作区、会话名、`session_id`、权限预设、会话来源、运行状态 |
| `/workspaces`、`/ws` | 工作区列表（序号 + 标题 + 路径 + 会话数） |
| `/sessions`、`/ls` | 当前工作区最近的会话（带序号与 `session_id`）；`/sessions all` 按工作区分组 |
| `/start` | 重新发一张选择卡（先选工作区，再选会话或新建） |
| `/use <序号>`、`/use <id前缀>`（`/switch`、`/bind`） | 切到已有会话：GUI 开着就接管，只有历史就恢复 |
| `/new`、`/reset` | 另开一条新会话（id 变成 `…-rN`），并清掉绑定 |
| `/cancel`、`/stop` | 中止当前回合 |
| `/approve`、`/reject` | 答复待审批（120s 超时自动拒绝） |
| `/help` | 命令帮助 |

## 落盘状态（`~/.dsh/weixin-clawbot/<account 哈希>.json`）

`enabled`、`policy`（open / allowlist）、`allowFrom`、`cursor`（getupdates 游标）、`contexts`（每用户 `context_token`）、`seen`（消息去重）、`generations`（`/new` 次数）、`bindings`（`/use` 或选择卡选中的 `session_id`）、`greeted`（每个用户上次打招呼的时间戳）。

重启后：`bindings` 还在 → 仍指向同一条会话；活 agent 已不在 → 自动 `resume`，历史接得上。

## 已知限制

- `getupdates` 是消费型接口，**同一 token 同时只能有一个消费者**；桌面端开着桥，CLI/官方插件那边就收不到。
- 语音只取微信给的转写文本；单条正文超过 8000 字节会截断（全文落 `.dsh-weixin`）。
- 单次回答等待上限 180s，超时会 `cancel` 并回提示；图片文件只回发最近 4 张。
- 一个用户同一时间只支持一个待审批（第二条会自动拒绝并告知）。
- 选择卡只在 10 分钟内有效；挂着不选，之后发的消息会重新弹卡并重新挂起。
- 选择卡按「工作区 → 会话」两层展开，会话卡把该工作区的会话全列出来，因此工作区里会话过多时卡会很长；这种场景直接用 `/sessions` + `/use <序号|id前缀>` 更快。
- 改完 host 代码需要重启桌面端才生效。
