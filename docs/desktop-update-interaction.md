# DSH 桌面端「新版本」更新/下载交互（0.2.1-rc.5 逆向说明）

> 目标：把现行「更新」交互的事实摊平，供设计 Codex 风格新下载流程时对照。
> 方法：只读解包后的代码。凡代码里查不到的，一律写「待确认 / 代码中未见」，不做推测。

**引用简写**（下文 `文件:行号` 均指以下三个文件）：

| 简写 | 完整路径 | 说明 |
| --- | --- | --- |
| `M` | `C:\Users\彭洪彬\AppData\Local\Temp\dsh-asar\main.js` | Electron 主进程，13197 行（`app.asar` 解包） |
| `B` | `D:\项目\dsh-toolkit\.cache\bundles\dsh-client-ui-settings-general.js` | Web 侧 `@deepseek-ai/dsh-client-ui-settings-general`，1334 行 |
| `S` | `C:\Users\彭洪彬\AppData\Local\Temp\dsh-asar\out6\dsh\node_modules\@deepseek-ai\dsh-client-ui-sidebar\lib\client.js` | 侧栏插件（徽标槽位宿主） |

**未解包（全文相关结论的边界）**：`preload-app.cjs` / `preload-update-dialog.cjs` / `renderer/`（含 `dsh-app://shell/update-dialog.html` 的实际渲染实现）**都不在解包目录里**。因此「桥的实现细节」和「对话框逐像素外观」两类问题无法从代码确认，见文末「待确认」。

---

## 1. 一句话总览

**动作归 Electron 主进程，文案归 Web 客户端**；两者通过 `globalThis.dshDesktop.updates` 这层桥通信，桥**只在 `globalThis.dshDesktop.protocolVersion === 1` 时启用**（`B:1106-1107`）。

- Web 侧能做的只有三件事：`status()` 取当前态、`subscribe(cb)` 收推送、`open()` 请求「走一次更新流程」（`B:503-568`）。
- 所有对话框都是主进程用 Electron 子窗口（overlay）打开的，不是 Web 组件；Web 端只有侧栏那枚 28px 的 chip（宽栏）/ 6px 的点（折叠 rail）。
- 主进程侧对应的三个 IPC 通道定义在 `M:6981-7007`：
  - `dsh-desktop:updates-status`（`M:7000`）
  - `dsh-desktop:updates-open`（`M:7001`）
  - `dsh-desktop:updates-presentation`（`M:7002`，主进程 → Web 的单向推送）

---

## 2. 入口在哪 / 何时可见

### 2.1 两个入口

| 位置 | 组件 | 形态 | 渲染条件 |
| --- | --- | --- | --- |
| 侧栏 footer（宽栏） | `DesktopUpdateIndicator`（`B:169-201`） | 28px 高 chip：14px 图标 + 文案 | 由 `SettingsRoot` 渲染，与 `ConnectionIndicator` 同一行（`B:464-479`） |
| 折叠 rail | `DesktopUpdateBadge`（`B:206-225`） | 6px 圆点，`span role="img"`，**无 onClick** | 注入到 `sidebar.toggle.badge` 槽（`B:1111-1118`），侧栏包只在 `!wide` 时渲染该槽（`S:379`） |

关键事实：**rail 上的圆点不是可点目标**。它被渲染在「侧栏折叠」按钮内部（`S:361-381`），点击它等于点折叠按钮；它本身没有 `onClick`，只有 `aria-label` 与 tooltip。

### 2.2 可见性条件（三套规则，互不相同）

**宽栏 chip**（`B:171`）：

```js
if (!wide || hidden || !failed && (state === void 0 || state.phase === "idle")) return null;
```

- `!wide` → 不渲染；
- `hidden` → 由上层传入（`B:475`）：`connectionIndicator !== void 0 && desktopUpdate.presentation?.phase !== "installing"`，即**连接指示器（断线/重连/恢复）正在显示时 chip 让位，但 installing 是例外**（安装时连接指示器自己让位，见 `B:465`）；
- `!failed && (state === undefined || phase === "idle")` → 不渲染，**即 idle 不显示、桥不可用（failed）时才强制显示「重试更新」**。

**rail 圆点**（`B:209`，注意 `&&` 优先级高于 `||`）：

```js
if ((connection === "disconnected" || connection === "connecting") && state?.phase !== "installing"
    || !failed && (state === void 0 || state.phase === "idle")) return null;
```

- 未连上后端且不在安装中 → 隐藏；
- idle 且桥正常 → 隐藏。

**纯浏览器**：没有 `globalThis.dshDesktop`，`new DesktopUpdateSource(undefined)`（`B:1107`）→ `presentation` 永远是 `undefined`、`failed` 保持 `false` → 两个组件都返回 `null`；`open()` 在 `bridge === undefined` 时立即 return（`B:539`）。**浏览器里完全没有更新入口**。

### 2.3 尺寸与样式要点

chip 的 CSS 在 `B:94`（`.VUhOWa_indicator`）：

- `height: 28px`；`border: 1px solid color-mix(品牌色 20%, transparent)`；`background: color-mix(品牌色 8%, transparent)`；`border-radius: var(--dsw-radius-sm)`；
- `display: inline-grid` + `grid-template-columns: 14px max-content`，`column-gap: 4px`，`padding: 0 8px`；
- 字体 `12px / 18px / 500`，`white-space: nowrap`；
- 图标容器固定 `14px × 14px`；
- spinner 是 `1s linear infinite` 旋转，且 `@media (prefers-reduced-motion: reduce)` 下关闭动画（`B:94` 同一条 CSS 串）；
- `[aria-disabled="true"]` 时 `cursor: default`（busy 态）。

rail 圆点：`6px × 6px`、`border-radius: 50%`、`position: absolute`、`top: 2px`、`inset-inline-end: 2px`、品牌色（`B:94` `.VUhOWa_badge`）；定位锚是切换按钮（`.wtg9ga_iconButton{...position:relative}`，rail 模式 36px，见 `S` 内 CSS）。

---

## 3. 状态机表

**桥实际会出现的相位只有 7 个**：`idle` / `available` / `downloading` / `verifying` / `ready` / `installing` / `error`。
⚠️ `checking` 是 Web 侧的「理论态」——`BUSY_PHASES` 里列了它（`B:114-119`），但**主进程全文没有任何 `phase: "checking"` 的发布**（`grep "checking"` 在 `M` 命中 0 行）。所以「正在检查更新…」这枚 chip 文案永远不会通过桥出现。

| 相位 | 桥可达 | chip 文案（zh key / en key） | 图标 | busy | 点击动作 | tooltip / detail |
| --- | --- | --- | --- | --- | --- | --- |
| `idle` | 是 | 不渲染（`B:171`） | — | — | — | — |
| `checking` | **否** | `desktop.update.checking`「正在检查更新…」/ "Checking for updates…"（`B:971` / `B:1015`） | spinner | 是 | 被忽略 | detail = `state.version ?? label`（`B:131-134`） |
| `available` | 是 | `desktop.update.available`「新版本」/ "Update"（`B:970` / `B:1014`） | 下载图标 `IconDownloadOutlineRegular` 14px | 否 | **立即下载（无确认）**，见 §4.2 | `versionDetail`「新版本：{version}」（`B:977`） |
| `downloading` | 是 | `desktop.update.progress`「{percent}%」（`B:972`） | spinner | 是 | 被忽略 | `downloadDetail`「正在下载更新：{percent}%\n目标版本：{version}」（`B:978`） |
| `verifying` | 是 | `desktop.update.verifying`「正在校验更新文件…」（`B:973`） | spinner | 是 | 被忽略 | detail = version |
| `installing` | 是 | `desktop.update.installing`「正在准备重启…」（`B:974`） | spinner | 是 | 被忽略 | detail = version；此时连接指示器让位（`B:465`） |
| `ready` | 是 | `desktop.update.ready`「安装并重启」/ "Install and Restart"（`B:975` / `B:1019`） | 下载图标 | 否 | 再走一次 `install`（会重新弹确认框） | `versionDetail`「安装并重启：{version}」 |
| `error` | 是 | `desktop.update.retry`「重试更新」/ "Retry update"（`B:976` / `B:1020`） | `errorDot`（6px 圆点，`currentColor`，`B:94`） | 否 | 按 `failedOperation` 分支重试，见 §4.2 | `failure` 映射 9 种文案（`B:135-148`） |
| 桥失败 `failed` | — | 同样显示「重试更新」，即使 `presentation === undefined`（`B:173-177`） | `errorDot` | 否（`opening` 除外） | `open()` 再试 | tooltip = 「重试更新」 |

**busy 的判定**（`B:179`）：`busy = opening || BUSY_PHASES.has(phase)`，其中 `BUSY_PHASES = {checking, downloading, verifying, installing}`（`B:114-119`）。
点击处理：`onClick: () => { if (!busy) onOpen(); }`（`B:188-190`），同时 `aria-disabled={busy}`。
另外 `DesktopUpdateSource.open()` **自己也有一层忙判**（`B:538-546`）：`opening === true` 或相位在 `[checking, downloading, verifying, installing]` 内 → 直接 return，所以 busy 时连 IPC 都不会发。

**失败态**：`error` 是一种相位（不是独立标志），并带 `failure` 分类。分类枚举由 `desktopUpdateFailureKind` 决定（`M:9221-9225`）：

- 基础：`check` / `download` / `install`（取 `failedOperation`，缺省 `install`）；
- 网络细分：上述任一命中 `NETWORK_FAILURE` 正则（`M:9215`，含 `ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ETIMEDOUT`）→ `check-network` / `download-network` / `install-network`；
- 安装准备工作失败原样返回（`preparationFailure`，仅 `failedOperation === "install"` 时）：`tasks-unavailable` / `tasks-changed` / `stop-failed`。

合计 **9 种**（`desktopUpdateErrorSummary`，`M:9232-9245`，Web 侧同一套 key 在 `B:135-148`）。

---

## 4. 点击之后发生什么

### 4.1 链路

```
chip 点击
  → openDesktopUpdate()                         B:1134-1136
  → DesktopUpdateSource.open()                  B:538-562  （忙判 + opening=true + failed 兜底）
  → bridge.open()                               B:551      （preload 未解包，实现待确认）
  → IPC `dsh-desktop:updates-open`              M:7001
  → ipcMain.handle(... assertProductSender)     M:12538-12541
  → openUpdatePrompt()                          M:12544   ★ manual 参数没传 → 默认 false
```

- **幂等/合流**：`openUpdatePrompt` 内部 `promptOperation ??= Promise.resolve().then(...)`（`M:12550`），并发或重复调用共享同一个 promise，`.finally` 里清空（`M:12628-12631`）。所以第二次点击不会排队、不会开第二个流程，只是 join。
- **Web 侧的 opening**：`open()` 立刻把 `opening: true` 写进 store（`B:547-550`），`finally` 里复位（`B:556-561`）；`bridge.open()` reject 时置 `failed: true`（`B:551-556`），chip 变「重试更新」。
- 注意：IPC handler 是 `await openUpdatePrompt()`，也就是说**这个 Promise 会挂住整个下载+安装流程**（`M:12540`），期间 Web 的 `opening` 一直是 `true`。

### 4.2 界面是什么（不是窗口，是 overlay 子窗）

主进程**没有**自绘的进度窗口，也没有独立「更新窗口」。所有 UI 都是 `DesktopUpdateDialog`（`M:10320-10476`）打开的一个 overlay 子窗口：

- 页面：`dsh-app://shell/update-dialog.html`（`M:10328`）；
- 窗口由 `overlays.create()` 创建（`M:11524-11615`）：`transparent` + `frameless`，尺寸等于父窗 `getContentBounds()`，`modal: nativeModal || process.platform !== "darwin"`，`skipTaskbar`，`sandbox` + `contextIsolation`，跟随父窗 move/resize/show，`setWindowOpenHandler(() => ({action:"deny"}))`；
- 对话框 view 模型（`M:10393-10404`）：`{ revision, locale, title, message, detail, buttons, cancelId, closeLabel: updateClose, technicalDetails, technicalDetailsLabel }`；
- 收尾：先向页面推 `changed(null)`，150ms 后 close（`M:10413-10417`）；
- IPC：`dsh-update-dialog:status` / `:changed` / `:respond`（`M:10323-10327`）。
- **`update-dialog.html` 的实际布局/字号/技术详情展开方式在解包目录里不存在 → 待确认。**

### 4.3 按相位分支（`manual === false`，即 chip 点击路径）

`openUpdatePrompt` 的分支顺序（`M:12561-12618`）——这是最重要的表：

| 当前相位 | 会发生什么 | 依据 |
| --- | --- | --- |
| `idle` | 先弹「正在检查更新…」遮罩（只有一个「稍后」按钮，`cancelId: 0`）→ 等检查结束 | `M:12563`、`M:12567-12578` |
| `error` 且 `failedOperation === "check"` | 同上（先弹检查遮罩再重查） | `M:12563`、`M:12584-12587` |
| 检查后 `idle` | 原生对话框「检查更新 / 已是最新版本 / 当前版本：{version}」 | `M:12588-12595` |
| 检查后 `error(check)` | 失败对话框（`updateFailedTitle` + 分类摘要 + 技术详情） | `M:12584-12587` |
| `ready` 或 `error(install)` | 直接再走 `updates.install(version)` → 弹「安装并重启」确认 | `M:12597-12602` |
| **`available`** | **跳过「发现新版本」确认**（该确认被 `if (manual)` 包着），直接 `downloadUpdate()` → 下载完立刻 `install()` | `M:12605-12618` |
| `error(download)` | 同样放行到 `downloadUpdate()` 重试 | `M:12604`、`M:12614-12618` |
| `downloading` / `verifying` / `installing` | 点不动（Web 端 busy 已拦，IPC 也会被 `updates.download`/`install` 的互斥挡住） | `B:179-190`、`M:7839`、`M:7875` |
| 强制更新阻塞中（`isMandatory()`） | 只把强制窗口 `focus()`，普通流程整体让位 | `M:12554-12558` |

★ **入口不一致的关键事实**：`openUpdatePrompt(manual=true)` 只由**应用菜单「检查更新…」**调用（`M:12754-12758`），它才会弹「发现新版本 {version} / 下载完成后，可安装并重启应用。」+「下载更新」按钮（`M:12605-12613`）。而 Web 侧 `updatesOpen` 传的是默认 `false`（`M:12540`）——**点侧栏 chip 时没有任何「要不要下载」的确认，直接开始下载**。

### 4.4「下载 → 校验 → 安装 → 重启」每步的可见反馈

| 步骤 | 主进程行为 | 界面可见反馈 |
| --- | --- | --- |
| ① 下载 | `updates.download(version)` → `setState({phase:"downloading", version, percent:0})`（`M:7839-7845`）→ `updater.downloadUpdate()` | **只有 chip**：图标变 spinner，文案 `{percent}%`；tooltip 两行「正在下载更新：NN%\n目标版本：x.y.z」。**无对话框、无进度条、无取消/暂停**。主进程里的 `updateDownloading`「正在下载 {percent}%…」文案**定义了但从未使用**（`M:7392` / `M:7559`，grep 仅命中定义行） |
| ② 校验 | `onProgress` 在 `percent >= 100` 时把相位切成 `verifying`（`M:7767-7775`） | chip 文案「正在校验更新文件…」，detail = 版本号，**percent 停在 100**。`updateVerifying` 原生文案同样未被使用（`M:7393`） |
| ③ 就绪 | `setState({phase:"ready", version})`（`M:7856`） | chip 变「安装并重启」——但这个态通常只有几百毫秒，因为 `downloadUpdate` 紧接着就 `await updates.install(version)`（`M:12384-12392`） |
| ④ 安装授权 | `install()` → `setState({phase:"installing"})`（`M:7879`）→ `beforeRestart()`（`M:12329-12376`） | **弹 overlay 确认框**（见下），此时 chip 已是「正在准备重启…」+ spinner |
| ⑤ 停宿主 | `await backend.stop()`、`updateStoppedHost = true`（`M:12360-12363`）、`shellInstallerOwnsQuit = true`（`M:12367`） | Web 与后端断开，连接指示器本会出现，但因 `installing` 例外而让位（`B:465`/`B:209`），安装态仍然可见 |
| ⑥ 退出安装 | `updater.quitAndInstall(true, true)`（`M:7889`） | 应用退出，交给 OS 安装器（Windows 上即 NSIS：`updateDownloadedDetailWindows` 提示「期间请勿重复启动应用」，`M:7647`）。Web 端不再有任何界面 |
| ⑦ 重启 | 安装器拉起应用；新进程 `phase` 回到 `idle`（`M:7760`） | 无「更新成功」提示（代码中未见成功 toast/对话框） |

**④ 的确认框文案**（`beforeRestart`，`M:12337-12345`）：

- 无活跃任务（`info`，按钮只有一个）：
  - `title`: 「DeepSeek Harness 更新」(`updateTitle`)
  - `message`: 「新版本 {version} 已准备就绪」(`updateDownloadedTitle`，由 `desktopUpdateReadyConfirmation` 生成，`M:7643-7648`、`M:12336`)
  - `detail`: 非 Windows「更新期间应用将暂时关闭，完成后会自动打开。」/ Windows「…请耐心等待，期间请勿重复启动应用。」(`updateDownloadedDetail` / `updateDownloadedDetailWindows`)
  - `buttons: [「安装并重启」]`，`defaultId: 1`，`cancelId: 1`
- 有活跃任务（`warning`）：
  - `message`: 「仍有进行中的任务」(`updateActiveTasks`)；`detail`: 「更新将停止进行中的任务并重启应用，是否继续？」(`updateActiveTasksDetail`)
  - `buttons: [「停止任务并更新」, 「稍后更新」]`，`defaultId: 1`，`cancelId: 1`

两条路径的 `cancelId` 都是 `1`：用户关窗/选「稍后更新」都会让 `response !== 0` → `beforeRestart` 返回 false → `install()` 回滚成 `setState({phase:"ready"})`（`M:12351`、`M:7875-7899`）。也就是说**取消安装后应用不会重启，chip 停在「安装并重启」**。

**③ 之前的失败**会落成 `error`：`publishUpdate` 对非 `check` 的失败自动弹错误对话框（`M:12278-12301`），标题「更新失败」，正文取 9 种分类文案之一，`technicalDetails = state.technicalDetails ?? state.message`（`M:12263-12267`）；同一份 state 只弹一次（`WeakMap` 去重，`M:12254`、`M:12261`）。若失败发生在「宿主已停」之后（`install` 失败 + `updateStoppedHost`），主进程会**自动把宿主重新拉起并重新导航**（`M:12279-12298`）。

---

## 5. 自动检查与手动检查

### 5.1 调度器 `DesktopUpdateSchedule`（`M:9119-9212`）

| 项 | 值 | 依据 |
| --- | --- | --- |
| 默认间隔 | `600000 ms`（10 分钟） | `DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS`，`M:9126-9136` |
| 随机抖动 | `0.2`（±20%）→ 首轮实际落在 **8–12 分钟** | `DSH_DESKTOP_UPDATE_CHECK_JITTER` |
| 失败退避 | `delay *= 2`，上限 `3600000 ms`（1 小时） | `DSH_DESKTOP_UPDATE_CHECK_MAX_BACKOFF_MS`，默认 `max(interval, 1h)` |
| 退避算法 | `lower = max(1000, delay*(1-jitter))`、`upper = min(maxBackoff, delay*(1+jitter))`、`delay = round(lower + (upper-lower)*random())` | `M:9198-9211` |
| 合流 | `check(manual=false, force=manual)`：已有 pending 且非 manual → 直接 join；`!force && now < nextCheck` → 直接返回当前 state | `M:9168` |
| 触发点 | ① 启动 `automaticCheck()`（`M:13177`）② `powerMonitor.on("resume")`（`M:12705`）③ 强制策略开始 blocking（`M:13151`）④ 定时器（`M:9206`） | — |

**静默性**：自动检查全程没有任何对话框。失败的检查连错误框都不会弹——`publishUpdate` 明确排除 `failedOperation === "check"`（`M:12278`），且非 manual 的 `check()` 不会把 error 写进 state（`M:7824-7834`）。

**免打扰（DND）**：**代码中未见**。`grep` `doNotDisturb` / `quietHours` 在 `M` 命中 0 行；调度器不读任何通知/免打扰设置。
**系统通知 / 任务栏提醒**：`DesktopUpdateAttention`（`M:9670-9760`：win32 `flashFrame(true)`、darwin `dock.bounce("informational")`、`new Notification({silent: true})`）**只被强制更新窗口实例化**（`M:9791`），普通更新流程完全不用它——所以「有新版本」既不会闪烁任务栏，也不会发通知。

### 5.2 手动检查的两条路径

| 路径 | 调用 | `manual` | 「发现新版本→下载更新」确认 | 「正在检查更新…」遮罩 | 「已是最新版本」框 |
| --- | --- | --- | --- | --- | --- |
| 应用菜单「检查更新…」 | `openUpdatePrompt(true)`（`M:12754-12758`） | `true` | **有**（`M:12605-12613`） | 有（无条件） | 有 |
| 侧栏 chip / 桥 `open()` | `openUpdatePrompt()`（`M:12540`） | `false` | **没有** | 仅当 `idle` 或 `error(check)` | 有 |

菜单文案：`checkUpdatesMenu`「检查更新…」/ "Check for Updates…"（`M:7537` / `M:7370`）。

### 5.3 Journal：不是断点续传

`DesktopUpdateJournal`（`M:9019-9102`）容易被误读成「checkpoint」，实际是**追加写的诊断证据（JSONL）**：

- 只有设置了环境变量 `DSH_DESKTOP_UPDATE_JOURNAL_DIR` 才会构造（`M:12045-12046`）；
- 文件 `<dir>/<Date.now()>-<uuid>.jsonl`，`mode: 384`、`flush: true`（每条落盘），首条是 `action("started")`（`M:9048` 起）；
- 每条形如 `{schemaVersion: 1, sequence, time, pid, version: <安装版本>, event}`；
- `desktopUpdateJournalState` 是 state 白名单（`M:9036-9046`）：`phase`、`targetVersion`（有 version 时）、`percent`（**仅 downloading**，取整）、`failedOperation` + `errorCode`（**仅 error**）；
- `ERROR_CODES` 白名单 8 个（`M:9021-9030`）：`ETIMEDOUT`、`ENOSPC`、`ERR_INTERNET_DISCONNECTED`、`ERR_CONNECTION_RESET`、`ERR_CONNECTION_CLOSED`、`ERR_NAME_NOT_RESOLVED`、`ERR_UPDATER_INVALID_SIGNATURE`、`ERR_UPDATER_CHECKSUM_MISMATCH`；
- 记录的 action：`started`、`check-requested`（`M:12551`）、`download-requested`（`M:12386`）、`install-confirmed`（`M:12366`）、`workspace-ready`（`M:12289` / `M:12317`）、`workspace-failed`（`M:12319`）、`quit-requested`（`M:13072` / `M:13099`）、`policy-login-<event>`（`M:13135`）。

**结论**：**没有任何「续传」语义**——每次启动 `current = { phase: "idle" }`（`M:7760`），进程重启后不会从 journal 恢复进度。electron-updater 自身的下载缓存是否复用属于该库行为，**代码中未见 → 待确认**。

### 5.4 宿主停服（`updateStoppedHost` / `stop-failed`）

- 安装前的 `beforeRestart` 会 `requireCleanStop = true` → `await backend.stop()` → `updateStoppedHost = true`（`M:12360-12363`）；
- 停服失败（`stopFailure !== undefined`）→ `new DesktopUpdatePreparationError("stop-failed", …updateStopFailed…)`（`M:12365`），fail-open 成 `error`，对话框文案「未能安全停止任务，更新尚未安装，请稍后重试。」（`M:7568` zh / `M:7401` en、`B:985`）；
- 失败回滚：`publishUpdate` 在 `install` 失败且 `updateStoppedHost` 时会 `backend.start()` 重新拉起宿主、重新导航（`M:12279-12298`），并复位 `shellInstallerOwnsQuit` / `updateStoppedHost`。

---

## 6. 桥接口契约（给设计用）

`globalThis.dshDesktop` → `.updates`，门禁 `protocolVersion === 1`（`B:1107`）。preload 侧实现未解包（待确认），但主进程侧契约可从 `M:12517-12541` 与 `M:9250-9257` 完整推出：

| 方法 | 语义 | 主进程对应 | 返回值 |
| --- | --- | --- | --- |
| `status()` | 拉一次当前态（补首帧） | `ipcMain.handle(updatesStatus)` → `presentDesktopUpdate(updates.state)`（`M:12517-12520`） | `Promise<Presentation>` |
| `subscribe(cb)` | 订阅后续每次状态推送 | `webContents.send(updatesPresentation, presentation)`，**广播给所有 BrowserWindow**（`M:12277`） | `unsubscribe()` |
| `open()` | 请求走一次更新流程（检查/下载/安装全由主进程编排） | `ipcMain.handle(updatesOpen)` → `openUpdatePrompt()`（`M:12538-12541`） | `Promise<void>` |

**`open()` 的语义与幂等**：

- 并发/重复调用**合流**到同一个 `promptOperation`（`M:12550`），不会叠加；
- busy 相位下 Web 侧根本不发（`B:541-546`），busy 时点 chip 也被 `onClick` 忽略（`B:188-190`）；
- 业务失败**不 reject**：失败变成一次 `presentation.phase = "error"` 推送 + 一个错误对话框；IPC 层失败（bridge 抛错）才让 Web 置 `failed = true`，chip 显示「重试更新」（`B:551-556`）；
- 返回时机：**整个流程（含下载、安装确认、停服）结束后**才 resolve（`M:12540`）。

**Presentation 的全部字段**（`presentDesktopUpdate`，`M:9250-9257`）——**一共 4 个**：

```ts
type Presentation = {
  phase: "idle" | "available" | "downloading" | "verifying" | "ready" | "installing" | "error";
  version?: string;   // 目标版本；available/downloading/verifying/ready/installing 时有
  percent?: number;   // Math.floor，0..100；仅 downloading/verifying
  failure?: "check" | "check-network" | "download" | "download-network"
          | "install" | "install-network" | "stop-failed"
          | "tasks-changed" | "tasks-unavailable";  // 仅 error
};
```

Web 侧对 `status()` 与推送做了**先到先得**处理：`subscribe` 一旦收到过推送，`status()` 的返回就不再覆盖（`received` 标志，`B:516-535`）。

**内部有、但不下发到 Web 的字段**（主进程 state 里有，presentation 里没有）：`failedOperation`、`message`、`preparationFailure`、`technicalDetails`、`downloaded`、`candidate`（`M:7923-7934`、`M:9250-9257`）。

---

## 7. 现状痛点 / 设计约束

以下是设计 Codex 风格流程时绕不开的事实约束（每条都对应上面的代码）：

1. **动作侧在原生，Web 只有 4 个 verb**：`status` / `subscribe` / `open` / 推送里的 4 个字段。Web 无法表达「暂停」「取消」「只下载不安装」「稍后提醒」「忽略此版本」——这些动作在主进程里**没有对应入口**（`M:12538-12541` 只接受无参 `open`）。
2. **没有进度条组件，只有一行百分比文本**：`{percent}%`（`B:972`），且只在 `downloading` 有意义；`verifying` 固定 100%。想做大卡片/进度环，需要新增组件 + 主进程已有 `percent` 数据可用（`M:9250-9257`）。
3. **`checking` 相位是空的**：`BUSY_PHASES` 期望它（`B:114-119`），主进程从不发布（`grep` 0 命中）。点击后 UI 只能靠 `opening` 布尔撑住 spinner，检查最长可拖到 HTTP idle 超时 `DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS`（默认 60s，`M:7792-7814`）都没有任何可见进度。
4. **下载与安装被绑在一次点击里**：`downloadUpdate` 下完立即 `updates.install`（`M:12384-12392`）。唯一的刹车是 `beforeRestart` 的确认框；选「稍后更新」才停在 `ready`（`M:12351`、`M:7875-7899`）。**没有「后台下载、稍后安装」的产品语义**（`autoDownload = false`、`autoInstallOnAppQuit = false`，`M:7792-7814`）。
5. **两条入口行为不一致**：菜单走 `manual=true`，会问「发现新版本→下载更新」；chip 走 `manual=false`，**直接开始下载**（`M:12540` vs `M:12756`、闸门 `M:12605`）。UI 上完全看不出这两条路不同。
6. **富交互都在解包不可见的原生 overlay 里**：`update-dialog.html`（`M:10328`）承载了「检查中 / 已是最新 / 发现新版本 / 安装确认 / 失败详情（含技术详情展开）」。它是 `modal`（win/linux）+ `skipTaskbar` + 跟随父窗的子窗，Web 无法在其中插入节点，也没有「对话框内进度」——所有进度只能在侧栏 chip 上。
7. **可见性有三套规则，且会互相让位**：宽栏 chip 在连接异常时隐藏（除 `installing`）；rail 的 6px 点**不可点**（点击等于折叠侧栏）；纯浏览器**完全不渲染**。设计新入口时必须决定是复用 `sidebar.toggle.badge` / footer 槽，还是新开槽位——现有槽位只承诺「一个 single、root scope」的插槽（`S:623-626`、`B:1111-1118`）。
8. **失败是终止式，没有恢复策略**：失败 → 一个错误框 + chip 变「重试更新」；自动检查失败**完全静默**（`M:12278`、`M:7824-7834`）。没有自动重试、没有退避提示、没有「失败原因分级」的 UI 展开（`technicalDetails` 只有原生框里的一个按钮）。主进程定义了 `updateRetry` 文案（`M:7395`/`M:7562`）但从未使用。
9. **强制更新优先级最高**：`isMandatory()` 为真时，普通流程整体让位（`M:12554-12558`、`M:12257-12259`、`M:12346-12351`），chip 的 `open()` 只会 focus 强制窗。新流程若与策略更新共存，必须遵守这条让位规则。
10. **更新通道按包决定**：`desktopUpdateChannel(manifest)` 读打包清单里的 `dshDesktopUpdateChannel`，缺省 `nightly`，只接受 `nightly` / `latest`（`M:7674-7680`）；本包 `app-package.json:17` 是 `"nightly"`，因此 `allowPrerelease = true`（`M:7792-7814`）。用户不可在 UI 里切换通道（代码中未见切换入口）。

---

## 8. 代码索引

| 结论 | 位置 |
| --- | --- |
| 三个 IPC 通道名 | `main.js:6981-7007` |
| `updatesStatus` handler（返回 presentation） | `main.js:12517-12520` |
| `updatesOpen` handler（`openUpdatePrompt()`，manual 默认 false） | `main.js:12538-12541` |
| 状态推送广播 | `main.js:12273-12304`（发送在 `main.js:12277`） |
| `presentDesktopUpdate`（4 字段） | `main.js:9250-9257` |
| 失败分类 `desktopUpdateFailureKind` | `main.js:9221-9225` |
| 网络失败正则 | `main.js:9215` |
| 9 种失败文案映射 | `main.js:9232-9245` |
| Coordinator（check/download/install/failure/doCheck） | `main.js:7752-7956`（`download` 7839-7869、`install` 7875-7899、`failure` 7923-7934、`doCheck` 7938-7955） |
| 进度 → `verifying` 切相 | `main.js:7767-7775` |
| `quitAndInstall(true, true)` | `main.js:7889` |
| 调度器与默认节奏 | `main.js:9119-9212`（配置 9126-9136、`check` 9168、退避 9198-9211） |
| Journal（诊断 JSONL，白名单 state） | `main.js:9019-9102`（白名单 9036-9046、ERROR_CODES 9021-9030） |
| `DesktopUpdateAttention`（仅强制更新用） | `main.js:9670-9760`（实例化 `main.js:9791`） |
| 更新对话框与 view 模型 | `main.js:10320-10476`（view 10393-10404） |
| overlay 子窗创建 | `main.js:11524-11615` |
| `openUpdatePrompt` 全分支 | `main.js:12544-12633` |
| 「发现新版本」确认（仅 manual） | `main.js:12605-12613` |
| 菜单「检查更新…」→ `openUpdatePrompt(true)` | `main.js:12753-12758` |
| `beforeRestart`（安装授权/停服/失败分类） | `main.js:12329-12376` |
| `downloadUpdate`（下载后立即安装） | `main.js:12384-12392` |
| `showUpdateFailure`（error 去重弹框） | `main.js:12255-12272` |
| 失败后重启宿主 | `main.js:12278-12298` |
| `desktopUpdateReadyConfirmation` 文案 | `main.js:7643-7648` |
| 文案表 zh / en | `main.js:7541-7575` / `main.js:7373-7408` |
| 通道选择 `desktopUpdateChannel` | `main.js:7674-7680`；本包 `nightly` → `app-package.json:17` |
| 自动检查触发点 | `main.js:13177`、`main.js:12705`、`main.js:13151`、`main.js:9206` |
| `DesktopUpdateSource`（status/subscribe/open） | `settings-general.js:503-568` |
| `BUSY_PHASES` / `updateCopy` | `settings-general.js:114-119` / `120-163` |
| `DesktopUpdateIndicator` 可见性与点击 | `settings-general.js:169-201`（guard 171、busy 179、onClick 188-190） |
| `DesktopUpdateBadge` 可见性 | `settings-general.js:206-225`（guard 209） |
| `SettingsRoot` 中两枚指示器的编排 | `settings-general.js:464-479` |
| 桥门禁 + 徽标槽注入 | `settings-general.js:1106-1118` |
| `openDesktopUpdate` | `settings-general.js:1133-1136` |
| chip / 徽标 CSS | `settings-general.js:94` |
| zh / en 文案表 | `settings-general.js:967-1009` / `1011-1053` |
| `sidebar.toggle.badge` 槽渲染（仅 `!wide`） | `sidebar/lib/client.js:379` |
| 槽声明（single / root） | `sidebar/lib/client.js:623-626` |
| 切换按钮为徽标定位容器 | `sidebar/lib/client.js` 内 `.wtg9ga_iconButton{...position:relative}`、`.wtg9ga_toggle{position:fixed;left:12px;z-index:30}` |

---

## 待确认（无法从已解包代码确认）

1. **`preload-app.cjs` / `preload-update-dialog.cjs` 未解包** → `dshDesktop.updates` 的具体实现（是否直接 `ipcRenderer.invoke`、`subscribe` 如何注册/去重、`protocolVersion` 由谁写入）无法核对；本文档的桥契约是从 Web 调用点 + 主进程 handler 反推的。
2. **`renderer/update-dialog.html` 未解包** → 对话框的真实视觉（按钮样式、`technicalDetails` 的展开控件、`closeLabel` 关闭按钮位置、是否有淡入淡出、`locale` 切换如何触达）在代码中不可见。
3. **`verifying` 相位是否真会出现**：逻辑上由 `onProgress` 的 `percent >= 100` 触发（`main.js:7767-7775`），但 electron-updater 是否真的以 100 结束进度流，需真机抓一次时序才能确认。
4. **electron-updater 下载缓存在进程重启后是否复用**（会不会表现为「断点续传」）：`main.js` 里没有任何相关代码，属库行为，`代码中未见`。
5. **是否真的「无成功提示」**：搜遍 `main.js` 未见更新成功后的 toast/对话框/通知；`main.js` 内 `Notification` 只出现在 `DesktopUpdateAttention`（强制更新用）。如存在 Web 侧成功提示，应在其他 bundle 中，本次未查。

---

## 9. codex 主题的磁贴实现（本仓库已实现）

只作用于 `html[data-sk-palette="codex"]`，其他调色板仍显示原生 28px 药丸；原生组件的 `aria-label`、`aria-disabled`、tooltip、点击处理器全部保留，磁贴只负责“长什么样”。

### 9.1 位置与尺寸

侧栏 `_triggerRow` 改为 `flex-direction: column-reverse`（原生把更新按钮追加在账户按钮之后），52px rail 里账户头像固定在最底，更新磁贴叠在它上方；磁贴 36×36、圆角 `--dsw-radius-md`，与账户按钮同 x 区间（8..44）。

### 9.2 相位 → 视觉

| 桥相位 | 磁贴表现 | 点击 |
| --- | --- | --- |
| （未渲染/`idle`） | 原生组件返回 `null`，不占位 | — |
| `available` | 淡蓝底 + 蓝色描边 + 蓝色下载图标 | 原生 `open()` → 主进程直接开始下载（无确认） |
| `downloading` | 蓝色圆环（`conic-gradient`，`--cx-update-pct` 驱动）+ 中心百分比 | 忙态，原生 `aria-disabled=true` 忽略点击 |
| `verifying` / `installing` | 旋转细弧（18px，0.9s 线性） | 同上 |
| `ready` | 淡蓝底 + 蓝色“入托盘”图标 | 原生 `open()` → beforeRestart「安装并重启」确认 |
| `error` | 红色重试图标 + 右上红点 | 原生 `open()` → 重试 |

`checking` 相位主进程从不发布，因此磁贴永远不会出现“检查中”；`verifying` 时桥里的 `percent` 固定 100，磁贴不画环。

### 9.3 数据来源与降级

1. 有 preload 桥（`globalThis.dshDesktop.protocolVersion === 1`）：订阅 `updates.subscribe()`，并用一次 `updates.status()` 取初值；迟到的 status 不会覆盖已到达的实时相位。
2. 没有桥（纯浏览器/其他 shell）：从 `aria-label` 里的百分比推断 `downloading`，其余情况显示通用下载图标。
3. 两者都没有：`data-cx-update="unknown"`，只显示通用下载图标。

### 9.4 代码位置

| 内容 | 文件 |
| --- | --- |
| 桥订阅 + 属性写入 | `src/modules/theme/client/update-tile.js`（`installUpdateTile`，仅 codex shell 安装） |
| 磁贴视觉 | `src/modules/theme/client/styles/sidebar.css`（`[data-cx-update=…]` 规则块） |
| 单测（jsdom） | `tests/integration/theme-update-tile.test.mjs`（5 例：降级、桥、迟到 status、异常、卸载清理） |

### 9.5 若要把“新下载流程”做成交互

现有磁贴不拦截事件，因此新流程仍需在原生侧实现（磁贴只能表现桥已发布的相位）。可行的落点：`main.js` 的 `updatesOpen` handler（`main.js:12538-12541`）按相位分流，或新增一个桥 verb；Web 侧只负责状态呈现。磁贴已经覆盖“有新版本 / 下载中 / 可安装 / 失败”四种可见状态，够支撑新流程的视觉部分。

