# notification 模块契约（会话通知）

> 本文是「设置 → 通知」模块的接口契约。实现代码位于 `src/modules/notification/`，
> 行为测试位于 `tests/notification/`。勘测笔记（参考实现拆解、宿主 API、接入约定）在
> 同目录的 `reference-notes.md` / `runtime-notes.md` / `toolkit-notes.md`，实现后以本文为准。

## 目标

会话跑完、出错、等回答、需要授权时提醒用户，并把「点击通知 → 回到对应会话」做成闭环：

- 四类提醒：`completed`（会话完成）、`failed`（会话失败）、`question`（等待回答，含计划审阅）、`permission`（需要授权）；
- **系统通知标题 = 会话标题**（宿主的 `displayTitle`），**正文 = 本轮最后一个 assistant 回复**（失败时是错误信息，待交互时是问题文本/工具名）；
- **点击通知 → `ctx.uiWorkspace.openSession(sessionId)`** 跳回对应会话；已归档会话先取消归档再打开；
- 偏好保存在宿主配置里，跨窗口与重启后仍在；
- 不进入模型请求、不写会话日志、不新增 HTTP 路由。

## Client 端

### 目录与入口

```
src/modules/notification/client/
├── index.jsx           # 工厂入口 createNotification(require)：装配 + 注册
├── locale.js           # 命名空间 dsh-toolkit.notification + zh/en 文案 + createTranslator
├── model.js            # 纯逻辑：配置常量/默认值/容错解码、正文截断、相对时间
├── detail.js           # 纯逻辑：会话快照 + 对话快照 → 本轮事实投影
├── engine.js           # 通知引擎（注入端口，DOM-free）：running 边沿 / 待交互边沿分类
├── dispatch.js         # 分发器（注入端口）：偏好门控 + 提示音 + 系统通知
├── browser-notify.js   # Notification API 封装：权限、选项、点击激活、图标降级
├── sounds.js           # Web Audio 合成的四个提示音
├── recent.js           # 「最近通知」内存 store
├── panel.jsx           # 设置页组件
└── styles.css          # ntf- 前缀，仅主题变量
```

入口是**工厂**（需要宿主 `require`）：`createNotification(require)` 先 `globalThis.__dshReact = require('react')`，
返回 `{ name: 'toolkit-notification-client', inject, apply }`，由 `src/client/index.js` 最后追加注册。

### 依赖

Cordis 服务注入：`['slots', 'locale', 'configForms', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'workspaces']`。

> Cordis 的 `ctx` 是严格的：没在 `inject` 里声明的服务一旦读取就会抛
> `cannot get property "…" without inject`。`workspaces` 只用于点击通知时判断归档会话，也必须在列。

| 服务 | 用途 |
| --- | --- |
| `sessions.list` | running 边沿、`displayTitle`、`projectionsBySession`（宿主是否续跑） |
| `sessions.binding` / `using` | 读对话快照；必要时物化未打开过的会话 |
| `uiSession.sessionStatus` | `pendingInteraction` 边沿与 `completionUnread`（全量已编目会话） |
| `uiConversation.binding(...).activate('chat')` | 读取 `assistant-step` / `user` / `turn-error` 节点 |
| `uiWorkspace.openSession` / `unarchiveSession` | 点击通知后的跳转 |
| `configForms` + `slots` + `locale` | 配置读写与设置页注册 |

`package.json` 的 `dsh.client.inject` 额外登记 `@deepseek-ai/dsh-api-session-controller`、
`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-client-ui-workspace`、
`@deepseek-ai/dsh-client-ui-conversation`，保证上述服务在自身工厂之前就位。

### 设置页

| 项 | 值 |
| --- | --- |
| slot | `settings.section` |
| id | `notification` |
| order | `24` |
| label | `t('nav')` → 「通知」/「Notifications」 |
| locale | `dsh-toolkit.notification` |
| 样式节点 | `style[data-plugin="toolkit-notification"]`，类名前缀 `ntf-` |

版式：行容器用宿主「通用设置」页 item 行的几何（`padding:16px 0`、`border-bottom:.5px solid
var(--dsw-alias-border-l2)`、控件靠右 `gap:24px`），标题/副标题层级对齐 Skills & MCP
（标题 14px/500/22px 主色，副标题 12px/18px 三级灰）。控件优先用官方 `primitives.Switch` /
`primitives.Button`，缺失时回落到自绘开关与按钮；下拉是原生 `<select>`（宿主没有 Select primitive）。

页头 = 标题 + 副标题（复用 `src/client/styles/settings.css` 的 `.ntf-pageTitle` /
`.ntf-pageIntro`，与「通用设置」「浏览器」「Skills & MCP」页一致，通知模块只做
`settingsStyles('ntf')` 前缀拼接，不再自写一套标题尺寸）。

页面包含三个分组卡片：「通知」（通知总开关、通知时机、测试通知、系统权限）、「提醒类型」
（四种类型开关）、「声音」（提示音开关、声音类型与试听、音量）。测试通知与系统权限都是普通 item
行：测试通知行只有在权限已授予时可点，系统权限行的副标题随权限实时变化（已授予 / 已拒绝 /
尚未授予 / 不支持），按钮在未授权时是「授权」、已授予或已拒绝时是「重新检查」。发送测试通知成功
不再额外弹一条「已发送」状态文案——通知本身即反馈。

## 行为

### 事件判定

- **完成/失败**：`sessions.list.byId[id].running` 由 `true→false` 后等 250ms settle，再读一次事实快照：
  本轮新增了 `turn-error`（`seq` 大于开跑基线）或 `lastAgentError` 相对基线变化 → `failed`，
  否则 → `completed`。开跑时只记基线，插件加载前就空闲的会话不补发。
- **暂停不是结束**：宿主还有排队输入（`inbox['next-turn'/'next-step']`）或未达轮次上限的 `goal` 时，
  这次空闲边沿不通知，由真正结束的那次边沿通知。
- **子会话与等待**：`scope = all` 时子会话也提醒；`main`/`main-wait` 下子会话静音，
  且 `main-wait` 会把主会话的完成通知 hold 到所有后代跑完再发一次；失败永远立即提醒。
- **待交互**：`uiSession.sessionStatus` 的 `pendingInteraction` 出现或 `key` 变化时发一条；
  同一互动不重复；互动消失不通知；插件加载前就存在的互动不补发。
- **对话文本**：`assistant-step.data.blocks` 里 `kind === 'text'` 的文本拼接，最后一个非空 step 胜出；
  `user.data.content` 用 `type === 'text'`（且 `source.kind === 'user'`）。
  未打开过的会话借一次 `sessions.using(id, { source: 'controllerOperation' })` 物化后再读，读不到就降级。

### 分发门控

1. `enabled`（通知总开关）关闭 → 什么都不做；
2. 该类型 `*Enabled` 关闭 → 什么都不做；
3. 按「窗口状态 × `currentMode`」决定要不要提醒（`never` 静默；`unfocused` 是默认；`always` 始终提醒）：

   | 窗口状态 | `unfocused`（默认） | `always` |
   | --- | --- | --- |
   | 可见 + 有焦点 | 静默（正在进行的那个会话更不会提醒） | 系统通知 + 提示音 |
   | 可见 + 无焦点 | 系统通知 + 提示音 | 系统通知 + 提示音 |
   | 隐藏 / 最小化 | 系统通知 + 提示音 | 系统通知 + 提示音 |

   **只有一条提醒通道：系统通知（`new Notification`）**。宿主没有给插件任何「应用内弹窗 / 通知卡片」
   的官方能力，自己再画一套只会和系统横幅重复一遍，所以应用内卡片通道已经移除。窗口在前台时不发
   通知（前台横幅多半不弹，弹了点击也回不到会话），这是刻意保持安静的取舍，不是缺陷。
4. `soundEnabled` 且该类型音效不为 `none` → 播放提示音（只在真的发通知时响）；
5. 系统通知：`tag = dsh-toolkit:notification:<sessionId>:<kind>`，`renotify: true`；
   桌面外壳下额外 `silent: true`（避免系统音与本模块提示音叠加）；
   图标取页面 favicon（`dsh-app:`/SVG data URL 不可用时省略）。

点击回调（系统通知点击）：`window.focus()` → （归档先 `unarchiveSession`）→
`ctx.uiWorkspace.openSession(sessionId)` → 等一个宏任务 → 用
`sessions.retainInfo(id).retainedBy.mainView > 0` 校验真的切过去了；没生效重试一次。
切过去之后如果发现宿主有模态弹层开着（`[role="dialog"][aria-modal="true"]`），补一个 document 级
`Escape` 把它关掉 —— 否则会话是在弹层背后切的，用户看到的仍是弹层。
rc.5 桌面外壳没有窗口聚焦 IPC，`window.focus()` 只能尽力而为（见下方已知限制）。

### 提示音

`chime`（完成）、`fault`（失败）、`pop`（提问）、`alert`（授权），全部用 Web Audio 振荡器 +
包络 + 软限幅实时合成；共享 `AudioContext` 懒创建、播放结束即 suspend、插件卸载时 close。

## 根配置 `notification`

`src/host/config.js` 内的 `notification` 命名空间。**每个可写字段都是 volatile 叶子**（DSH 设置服务
只允许写 volatile 字段），且刻意扁平（不嵌套 `types.completed.sound`，因为 schemastery 不允许把
已含 volatile 叶子的对象再包一层 volatile）。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 通知总开关 |
| `soundEnabled` | `true` | 提示音开关 |
| `volume` | `0.6` | 音量 0..1 |
| `currentMode` | `unfocused` | 提醒时机：`never` / `unfocused` / `always`（旧值 `hidden` 在解码时迁移为 `unfocused`） |
| `scope` | `main-wait` | 通知范围：`all` / `main` / `main-wait` |
| `<kind>Enabled` | `true` | 四种类型的开关（`completed`/`failed`/`question`/`permission`） |
| `<kind>Sound` | 见下 | 每种类型的提示音：`chime` / `fault` / `pop` / `alert` / `none` |

默认音效：`completed=chime`、`failed=fault`、`question=pop`、`permission=alert`。
读取端对脏值一律回退默认（`model.js` 的 `resolveSettings`），写入走 `form.set(field, value)`
（`config.js` 的 scoped form 会拼上 `notification` 前缀）。

## 生效方式

1. `pnpm build`（重新生成 `lib/client.js`；`lib/` 是提交物，不要手改）；
2. 重启 DSH 桌面应用（Host 配置 schema 与客户端 bundle 清单都在启动时登记）；
3. 打开 **设置 → 通知**：首次打开系统通知开关时向浏览器/系统申请权限；
4. 点「发送测试通知」验证通道；权限行副标题会同步显示当前系统权限状态。

## 已知限制

- **无法把窗口强制带到前台**：rc.5 的桌面外壳没有 focus/activate IPC，`globalThis.dshDesktop`
  只有 browser/deviceInfo/keyboard/shortcuts/updates，`window.focus()` 只能尽力而为。
- 系统通知在应用前台时的**投递与点击**由系统决定，无法从页面观测；窗口在前台时本模块刻意不发通知。
- 系统通知需要权限，声音需要页面获得用户激活（浏览器自动播放策略），与普通 Web 应用一致。
- 未打开过且从未物化的会话，失败判定依赖 `turn-error`/`lastAgentError`；对话文本读取是 best-effort。
- 通知按会话 + 类型折叠（同一会话的完成与失败不会互相覆盖，同一类型会替换旧通知）。

## 验收

```sh
pnpm build
node --import ./scripts/jsx-register.mjs --test tests/notification/*.test.mjs
pnpm verify
```

覆盖点：配置解码与根 schema 交叉校验、会话事实投影、完成/失败/暂停/等待/静默分类、
待交互 key 变化、分发门控（单通道：系统通知）、系统通知选项与点击、提示音降级、
设置页注册契约与开关写回、端到端（真实 `apply` + 假 ctx）通知标题/正文与点击跳转。

## 真机验证记录（0.2.1-rc.5 桌面端 / Web GUI）

重启桌面应用后，在独立 Web 客户端（同一 `127.0.0.1` GUI）里实测：

1. 设置导航出现「通知」，页头有标题与副标题，页面渲染三个分组卡片（「通知」里是总开关 /
   通知时机 / 测试通知 / 系统权限，「提醒类型」四种，「声音」三项），行标题与副标题层级、
   分隔线、控件位置与「通用设置」页一致；
2. 点击「提示音」开关后，`$DSH_HOME/profiles/desktop/cordis.patch.yml` 出现
   `- id: shell-kit → config.notification.soundEnabled: false`；再点回去恢复 `true`（写回链路真实可用）；
3. 把「通知范围」切到「全部会话」后，一个真实子会话跑完触发了系统通知：
   **标题 = 会话 `displayTitle`**，**正文 = 该轮最后一个 assistant 回复**，`tag` 为
   `dsh-toolkit:notification:<sessionId>:completed`；
4. 点击系统通知，主视图跳到该会话并显示它的回复；
5. 无头 Chrome 默认拒绝通知权限时，「系统权限」行按设计显示「系统通知已关闭；请到系统设置里允许本应用发送通知。」，按钮可重新检查。

> 真机验证还抓到一个 Cordis 严格上下文的坑：`ctx.workspaces` 未列入 `inject` 时读取会抛
> `cannot get property "workspaces" without inject`，点击通知只打 warn 不跳转；已在 `inject` 中补上并回归。

