# 现代 Web 能力审计：11 个模块的客户端代码

> 运行时：DSH 桌面端 **Electron 44.7.0 = Chromium 152**（`D:\软件\deepseek\version`）；Web GUI 也可能跑在浏览器里。
> 语料库：`modern-web-guidance` 1.0.1（210 篇 guide / 203 个 use case），静态规则 52 条 / 38 篇。
> 范围：`src/client/**` + `src/modules/*/client/**`，共 **12 个区域、176 个文件、约 23,900 行**（不含 `host/`）。
> 状态：审计完成。所有条目都读过源码原文并核对了指南的兼容性/回退要求。
>
> **进度（23:15 复核）**
> - ✅ 已落地：§3.5 的 `.sk-tip` → `popover="hint"`（`rail-unpin.ts` + `sidebar.css`），实测位置/尺寸/配色逐像素不变，新增 Esc 与点外关闭。
> - ✅ 已由另一个会话落地：§4.3 / §4.4 的「全文档观察者」收口（新增 `theme/client/watch.ts`，改 `rail.ts` / `sidebar.ts` / `band.ts` / `update-tile.ts` / `rail-unpin.ts`）；§4.5 里 pet 那条 1s 常驻轮询改为按 `petEnabled/islandEnabled` 开合；`settings-nav` 对聊天区记录直接短路；提示音重写为共享 `AudioContext`（suspend/resume）。
> - ⏳ 未开始：§2（3 条正确性）、§3 其余 4 处浮层、§4.1 / §4.2 / §4.5 的 `poll.ts` 与 mobile、§4.6、§5 全部、§6 的 19 处现代 JS 内建。
> - `pnpm build:check` 通过（产物与源码同步）。

---

## 0. 结论

**底层其实已经很现代**：移动端串流用 WebCodecs `VideoDecoder` + `requestAnimationFrame` 限帧 + `ResizeObserver`；状态用 `useSyncExternalStore`；CSS 已经在用 `:has()`（43 处）、`color-mix()`（35 处）、`scrollbar-width`、`prefers-reduced-motion`（14 处）、`corner-shape`；指针拖拽用 Pointer Events + `setPointerCapture`。这不是一个「停在 2019 年」的代码库。

欠账集中在三类，一共 **24 条**（见下表）：

1. **浮层/弹层语义全靠手写**（7 处）——`popover` / `<dialog>` / `commandfor` 一个都没用。每处都要自己处理「点外关闭、Esc、层叠顺序、焦点还原、跟随锚点滚动」，这些是平台已经做完的事，也是 bug 最容易藏的地方（`theme/settings-actions.ts:105` 甚至要用 `stopImmediatePropagation` 抢在宿主 modal 前面吃掉 Esc）。
2. **生命周期不跟可见性挂钩**（5 处）——面板收起、切 tab、窗口最小化后，1080p 串流仍在全速解码、轮询仍在按 5s/0.7s/1s 打宿主接口、每秒一次的 `getComputedStyle` 仍在跑。
3. **少量真 bug**（3 处）——中文输入法组字期间按 Enter 会「用拼音提交」（git 建分支、mobile 转字、remote 改名）；OAuth 复制链接未 `await` 剪贴板写入，失败也显示「已复制」；`fetchJson` 没有截止时间，后端不响应就永久禁用按钮。

### 数量分布

| 优先级 | 类别 | 条数 | 典型收益 |
| --- | --- | --- | --- |
| P0 | 正确性（IME / 剪贴板 / 超时） | 3 | 不再写坏数据、不再假成功、按钮不再永久变灰 |
| P1 | 平台能力替换（popover / dialog / interestfor） | 7 | 删掉约 250 行交互代码，脱离 z-index 军备竞赛 |
| P2 | 性能（可见性、轮询合并、强制布局） | 6 | 后台 CPU/耗电归零，输入延迟与首屏渲染改善 |
| P3 | 可访问性/表单/CSS 细节 | 8 | 读屏可用、错误就近提示、跟随主题 |
| — | 现代 JS 内建（静态扫描） | 20 处 | 纯删代码，零风险 |

### 现代特性命中为 0 的清单

在整个 client 侧**一次都没有出现**：`popover` / `closedby` / `showModal()` / `commandfor` / `focusgroup` / `interestfor` / `anchor-name` / `content-visibility` / `field-sizing` / `@starting-style` / `interpolate-size` / `calc-size()` / `startViewTransition` / `scheduler.yield` / `structuredClone` / `AbortSignal.timeout` / `Promise.withResolvers` / `toSorted` / `Temporal`。

---

## 1. 先确认「这些特性在当前运行时到底有没有」

语料库给的支持数据（我逐条核过原文），对照 Electron 44 / Chromium 152：

| 特性 | 语料库判定 | Chromium 152 可用 | 结论 |
| --- | --- | --- | --- |
| Popover | Baseline Newly available（2025-01-27），Chrome 116+ | ✅ | **可直接上**，全浏览器都支持 |
| `@starting-style` + `transition-behavior: allow-discrete` | Newly available（2024-08-06），Chrome 117+ | ✅ | **可直接上** |
| `<dialog closedby>` | Chrome 134+（Safari 无） | ✅ | 桌面端可用；Safari 下退化为「只能 Esc 关」= 优雅降级 |
| Invoker commands（`commandfor` / `command`） | Baseline（2025-12-12），Chrome 135+ | ✅ | 可用；老浏览器按指南条件加载 polyfill |
| `content-visibility` | Newly available（2025-09-15），Chrome 108+ | ✅ | 可用 |
| `field-sizing: content` | Newly available（2026-06-16），Chrome 123+ | ✅ | 可用 |
| `focusgroup` | Chrome 150 only（Firefox/Safari 无） | ✅ | 只能当增强，必须带指南给的回退脚本 |
| Interest invokers（`interestfor`） | Chrome 149 only | ✅ | 同上，浏览器版 GUI 要回退 |
| `interpolate-size` / `calc-size()` | Limited，Chrome 129 only | ✅ | 只能当增强 |
| `overlay`（`transition-behavior` 的离散属性之一） | Limited，Chrome 117 only | ✅ | 别当唯一路径，Firefox 会「立即消失」 |
| **CSS Anchor Positioning** | **Limited，Chrome 157（2026-11）** | ❌ | **当前运行时没有**：定位继续走 JS，等 Chromium 升级再切 |

> 这条表决定了改造顺序：**先吃 popover / dialog 的语义**（跨浏览器稳、收益最大），**定位算法先保留**（`measureMenuAnchor` 那套不许删，它就是锚点定位不可用时的官方回退形态）。
> 落任何一条之前，先用一行代码在目标运行时实测：`CSS.supports('position-area: block-end')`、`Object.hasOwn(HTMLElement.prototype, 'popover')`、`'interestForElement' in HTMLButtonElement.prototype`。

---

## 2. P0：正确性问题（3 条，先修这个）

### 2.1 IME 组字期间按 Enter 会提交拼音（5 处调用点）

| 位置 | 现状 |
| --- | --- |
| `git/client/surfaces/branch-chip/index.tsx:351-356` | `if (event?.key === "Enter" && draftValid) { preventDefault(); submit(draft, true) }` |
| `git/client/surfaces/settings/index.tsx:213-217` | 同上，写 `branchPrefix` |
| `mobile/client/components/stream-view.tsx:188-197` | `onKeyDown` → `translateKey(event)` → `enqueueKey(item)`，组字阶段的字母会当按键转发到真机（同文件 199 行已有 `onCompositionEnd`，说明意图就是「组字中不发键」，只是漏了前置门） |
| `remote/client/mobile/tab.tsx:100-102`、`remote/client/wechat/views.tsx:96-98` | `if (event.key === 'Enter') save()` / `submit()` |

修法（三行，零风险）：

```ts
const native = (event.nativeEvent ?? event) as KeyboardEvent & { keyCode?: number }
if (native.isComposing || native.keyCode === 229) return
```

`keyCode === 229` 不是冗余：Safari 在组字确认的 keydown 上只报 `keyCode: 229`、不报 13（指南 `ime-safe-enter-submit`）。React 合成事件不保证带 `isComposing`，必须读 `nativeEvent`。
顺手补一处：`branch-chip:335-342` 那个 primitives 缺失时的降级 `<input>` 现在按 Enter 完全没反应。

### 2.2 OAuth 复制链接是「假成功」

`skills-mcp/client/hooks/useOAuth.ts:54-60`：

```ts
try {
  void navigator.clipboard?.writeText?.(url)   // ← 没 await
  setCopiedUrlFor(serverName)                  // ← 无条件标「已复制」
} catch { … }                                  // ← 永远进不来
```

权限被拒或文档失焦时 `writeText` 异步 reject，`try/catch` 早已结束，按钮照样显示「已复制」，用户把空剪贴板粘进浏览器，OAuth 直接卡住。改成 `await`，失败切文案（「复制失败，请手动选中」），成功后 2s 清除状态。

### 2.3 `fetchJson` 没有截止时间 → 按钮永久变灰

`src/client/http.ts:1` 的注释明写「without retries or a global timeout」，但调用链上没人传 signal：git 分支 chip 的 `load()`/`submit()`（`index.tsx:130`、`:160`）、hooks 的 `load()/refresh()`（`settings/index.tsx:64`、`:96`）。宿主路由一卡，promise 永不 settle，`finally` 不执行，`loading`/`busy` 永远为真。

```ts
// fetchJson 里合一个默认 deadline，允许调用方覆盖
const signal = options.signal
  ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
  : AbortSignal.timeout(timeoutMs)
```

注意：`AbortSignal.timeout()` 的 reason 是 `DOMException('TimeoutError')`，不是 `AbortError`，现有 `catch` 里按 `signal.aborted` 判断的地方要一起看一眼。仓库里 `skills-mcp/client/hooks/useRuntime.ts:38-41` 已经手搓了同一套 10s 超时，属于第二个消费者。

---

## 3. P1：浮层语义交给平台（7 处）

现状盘点（全部是手写 top-layer）：

| # | 位置 | 手写了什么 |
| --- | --- | --- |
| 1 | `client/ui/components/menu/index.ts` + `theme/client/settings-actions.ts` | 量 `getBoundingClientRect` → `itemCount*30+10` 估高 → 内联 `position:fixed`；自己抓 Esc、`pointerdown` 判点外、`scroll`(capture)/resize 关闭；Arrow/Home/End 漫游；`stopImmediatePropagation` 抢宿主 modal 的 Esc |
| 2 | `skills-mcp/client/panel.tsx:502-544` | 上面那份 + 全屏 `.smp-menuScrim` 遮罩；**并且重复注册了一次 Escape**（`listenMenuDismiss` 自己已经注册过） |
| 3 | `judgment/client/components.tsx:29-80` | 第三份同样实现，`role="menu"` 但没有任何箭头键契约（无效 ARIA） |
| 4 | `remote/client/panel.tsx:114-296` | `createPortal` + `position:fixed` + `z-index:2147482000` + 手写 Esc(165-174) + 手写点外(404) + 滚动重采锚点(370-380) + 150ms 卸载定时器与 CSS 时长靠注释同步 |
| 5 | `theme/client/rail-unpin.ts:31-111` | 自建 `div.sk-tip` 工具提示：450ms 延迟、`placeTip()` 手算左边界并做视口夹取、`role="tooltip"`、鼠标进出管理 |
| 6 | `client/ui/components/resizable-dialog/index.tsx:210-247` | `div[role=dialog][aria-modal=true]` + 手写遮罩 + 窗口级 Esc 监听 + 自行夹取尺寸；**没有焦点陷阱、没有初始焦点、关闭不还原焦点** |
| 7 | `client/ui/toast.ts:90-152` | 手建 DOM 栈 + 两个 `@keyframes` + `--leaving` 类 + `animationend` + 180ms 兜底定时器 + `z-index:1100` |

**共同改法（按收益排序）**

1. **菜单（3 处）→ `popover="auto"` + `commandfor`/`command="toggle-popover"`**：顶层渲染、light dismiss、Esc、焦点还原全部由浏览器给，遮罩和两套监听可以整段删掉。
   定位分两档落地：现在用现有 JS 测量（保留），`@supports (position-area: block-end)` 通过时切 `position-area: block-end span-inline-end` + `position-try-fallbacks: flip-block, flip-inline`。
   顺带把 `role` 修干净：要么按指南补 `focusgroup="menu nomemory"`（Chromium 150+，回退脚本见 guide），要么去掉 `role="menu"` 只留 `aria-expanded`——指南的原话是「Do not apply `role="menu"` unless you fully implement the corresponding keyboard navigation contract」。
2. **远程面板 → `popover="auto"`**：`role="dialog"`/`aria-haspopup="dialog"` 语义保留，`position:fixed` 的坐标可以保留（定位与弹层机制解耦），删掉 Esc/点外/滚动重采三套监听。收起动画改用 `el.getAnimations().map(a => a.finished)`，消灭「150ms 两份常量」；升级到 `@starting-style` + `allow-discrete` 是第二步。
3. **rail 工具提示 → `popover="hint"` + `interestfor`**：hover/焦点/长按统一由浏览器触发，`popover="hint"` 不会误关别人的菜单，light dismiss 与 Esc 免费；定位用 CSS 锚点（不可用时 `placeTip()` 原样保留）。注意 `interestfor` 只有 Chromium 149+，Firefox/Safari 要么 polyfill 要么保留现有 `pointerover/pointerout`。
4. **`ResizableDialog` → 原生 `<dialog>` + `showModal()`**：拿到 top layer、`::backdrop`、焦点限制、Esc、焦点还原，删掉 `role`/`aria-modal`/窗口 Esc 监听；点击遮罩关闭用 `closedby="any"`（Chrome 134+，不支持时按指南补 12 行 pointerdown/up 判断）。拖拽把手同时改成 Pointer Events（现在只有 `mousedown`，触屏/手写笔拖不动），并在 `pointerup` 才提交尺寸，拖动中用 CSS 自定义属性直接写宽度、绕开「每次 mousemove 一次 React 重渲染」。
5. **toast → `popover="manual"` + `@starting-style`**：顶层渲染让 toast 不再和宿主 modal 抢 z-index（宿主弹层若是原生 `<dialog>`，1400 也压不过 top layer）；进出场交给 `transition` + `allow-discrete`，删掉 `animationend` + 180ms 兜底。**注意**：类名被 5 个测试断言，不能动；不支持 popover 时必须保留老路径（指南给的回退正是「用 JS 加类」）。
6. **设置面板进出场（可选，L 工作量）**：`theme/client/settings-motion.ts:30-55` 现在是「克隆整个 overlay DOM + 手动清 id/role + WAAPI 反向播放 + 定时移除」。这是 View Transitions 的经典场景（`document.startViewTransition` 自动快照旧状态），但需要和宿主的关闭时机协作，风险高于收益，建议等前 5 条落地后再评估。

---

## 4. P2：性能（6 条）

### 4.1 串流面板不可见时仍在全速解码（最值钱的一条）

`mobile/client/index.tsx:217-218` 刻意配了 `keepMounted: true`（注释：切换会话保留流与解码器），而 `stream/use-h264-canvas.ts:147-152` 的 `for(;;) await reader.read()` + `decoder.decode()` 没有任何可见性出口。面板收起 / 切 tab / 窗口最小化时，帧被反复替换后 `close()`，等于纯烧 CPU 和电。

改法：给 `.mbm-stage` 加 `content-visibility: auto` + `contain-intrinsic-size`，监听 `contentvisibilityautostatechange` 的 `event.skipped` 去 `abort()` 取流，恢复时复用已有的 `needsKeyframe = true` 等下一个 IDR。事件不冒泡，必须挂在带 `content-visibility` 的元素上；不支持时要 `IntersectionObserver` 兜底（指南 `efficient-background-processing`）。

### 4.2 4Hz 轮询量宽度，旁边的 ResizeObserver 没用上

`mobile/client/panel.tsx:133-156` 每 250ms 调 `preferredStreamWidth()` → `querySelector('.mbm-stage')` → `getComputedStyle()` + 读 `clientWidth/clientHeight`（一次强制样式计算 + 强制布局，永不停止）。而 `stream/canvas.ts:102-113` 本来就已经 `ResizeObserver.observe(stage)` 盯着同一个元素，只是没通知上层。把「尺寸变化订阅」接出来即可，`REGRANT_*_HOLD_MS` 的持续性语义保留。

### 4.3 theme 侧两个「全文档 + 每帧」的观察者

| 位置 | 现状 | 代价 |
| --- | --- | --- |
| `theme/client/sidebar.ts:215-227` | `observer.observe(document.body, { childList, subtree, attributes, attributeFilter: ['style', ...] })`，且 frame 的 style 变化走**同步** `pass()` | 聊天界面里内联 style 写入极频繁，每次都要跑 `querySelectorAll('[class*="_frame"]')` + 读 `gridTemplateColumns` + 写回内联样式，等于和宿主抢布局 |
| `theme/client/settings-nav.ts:322-330` | `characterData: true` + `childList` + `attributes`，回调里**同步** `scan()`（`document.querySelector(PANEL)` → 可能整块重建导航） | 流式输出时每个 token 一批 characterData → 一次全文档查询；设置面板开着时还会 `JSON.stringify` + 重建菜单 |

改法：`settings-nav` 把回调合到 `requestAnimationFrame`/微任务里，并把观察范围从 `document.body` 收到设置面板（面板不在时根本不观察）；`sidebar.ts` 的 `attributeFilter` 收窄到 frame 子树，或用 `ResizeObserver` 盯 frame。两条都不需要改行为语义。

### 4.4 `band.ts` 每帧一次强制布局

`theme/client/band.ts:19-34`：`MutationObserver(characterData: true, subtree: true)` → rAF → `getBoundingClientRect()`。流式输出期间等于每帧一次同步布局。改成 `ResizeObserver` 盯 `TITLE_ROW` 即可（它只关心尺寸）。

### 4.5 轮询不判可见性（5 个消费者）

`src/client/poll.ts:1` 的契约写着「Callers own visibility」，实际只有 remote 侧三处照做（`panel.tsx:158`、`mobile/tab.tsx:206`、`features.ts:76`）。漏的：

- `mobile/client/panel.tsx:184-195`：5s 一次状态，回调里 5 个 `setState`
- `skills-mcp/client/hooks/useFormRefresh.ts:18-25`：**700ms** 一次全量重渲染（设置页签是保活的，切到别的面板后仍在跑）
- `pet/client/index.tsx:169`：`setInterval(…, 1000)` 每秒遍历全部会话快照求 `mainView()`

最省事的做法是把「hidden 时不排下一次 + visible 立刻补一次」上提到 `poll.ts` 一处，三个面板同时受益；`pet` 那条直接加 `document.visibilityState` 短路。

### 4.6（可选）宿主会话列表的 `content-visibility`

sidebar 的 `_list` 里行数可能上百，行内是标题 + 时间 + 操作按钮。主题侧已有 `[class*="_sessionRow"]` 选择器（`styles/sidebar.css:643-665`），加 `content-visibility: auto; contain-intrinsic-size: auto 32px` 理论收益明显。**风险**：估算高度不准会让滚动条跳动，且宿主如果自己是虚拟列表就是白改。建议先拿 200+ 会话实测 FPS 再决定。

---

## 5. P3：可访问性 / 表单 / CSS 细节（8 条）

1. **页签与分段控件选中态不在无障碍树上**：`skills-mcp/client/components/tabs.tsx:19-27`、`judgment/client/panel.tsx:686-692`、`components/toolList.tsx:66-75`、`views/importCard.tsx:48-51` 只有 `data-active`，没有 `role="tablist"/"tab"`、`aria-selected`、`role="tabpanel"`、`aria-pressed`。CSS 从 `[data-active=true]` 派生（`src/client/styles/settings.css:20`），读屏完全听不出选中哪个。改 ARIA 后**样式改成从 `aria-selected` 派生**，视觉与语义就不会再漂移（guide `tabs`）。
2. **表单校验只在提交后、且是 toast**：`skillDialog.tsx:114-125`、`serverForm.tsx:17-24` 的输入框没有 `required`/`pattern`/`aria-invalid`。更值得注意：`components/form.ts:61-77` 里 `validateServerDraft`/`validateSkillDraft`/`isValidName` **全仓 client 侧零调用点**（死代码）。要么接回 UI 配 `:user-invalid`（Widely available，2023-11）与 `aria-invalid`（初始值显式 `"false"`），要么删掉。
3. **textarea 固定行高**：`skillDialog.tsx:122-125`（`rows={8}`）、`serverForm.tsx:98-104,145-161`（`rows={3}`）→ `field-sizing: content` + `min/max-block-size` + **显式 `width:100%`**（否则长 placeholder 换短内容时横向跳）。
4. **面板内响应式看视口而不是容器**：`pet/client/style.css:41-46`、`boot/client/styles.css:37`、`notification/client/styles.css:19-22` 用 `@media (max-width: 620/720px)` 改面板内部间距，而面板住在设置弹窗的内容列里——宽屏 + 窄内容列不触发，窄窗口误触发。改成 `container-type: inline-size` + `@container`（Widely，无需回退）。
5. **`prefers-reduced-motion` 漏 3 处**：git chevron 的 `rotate(180deg)`（`branch-chip/style.css:59-68`）、git/notification 两个开关的 `translateX`、toast 的位移。pet / boot 已经做了。注意：若把进场动画挪进 `no-preference` 分支，`animationend` 就永远不触发，必须靠 `getAnimations()` 判空或保留兜底定时器。
6. **`::-webkit-scrollbar` 残留**：`theme/client/styles/sidebar.css:607`、`settings-shell.css:87-88` 与标准 `scrollbar-width/color` 并存。Chromium 121+ 上标准属性已生效，这几条是死代码（删之前确认宿主是否靠它隐藏滚动条）。
7. **`appearance:none` + 手绘箭头三份重复**：`skills-mcp/client/styles/panel.css:150`、`judgment/client/styles.css:55`、`archived/.../style.css:33`，描边写死 `%238b8f99`，不跟主题。`@supports (appearance: base-select)` 下换 `::picker(select)` + `::picker-icon`（Chrome 135+，Firefox/Safari 无 → 保留老分支）。
8. **无效 ARIA 收口**：`skills-mcp/panel.tsx:534`、`theme/settings-actions.ts:12`、`judgment/components.tsx:61` 的 `role="menu"` 都缺键盘契约，按 3.1 的做法一并处理。

---

## 6. 现代 JS 内建：静态扫描 20 处（`src/` 侧）

`legacy-scan` 共报 52 条，其中 32 条落在 `lib/**` 与 `packages/*/lib/**`（构建产物，改源码后自动消失）。剩下的按类型：

| 类型 | 位置 | 改法 |
| --- | --- | --- |
| `AbortController` + `setTimeout` 手搓超时 | `pet/host/petdex.ts:175,193`、`remote/host/wechat/monitor.ts:191` | `AbortSignal.timeout(ms)` |
| 延迟 promise 外部赋值 resolve/reject | `judgment/host/provider/ledger.ts:133` | `Promise.withResolvers()` |
| `JSON.parse(JSON.stringify(x))` 深拷贝 | `skills-mcp/host/index.ts:331,520`、`runtime/rows.ts:42` | `structuredClone()`（注意含函数/类的对象不行，这几处都是纯数据） |
| 复制后 `.reverse()` / `.sort()` / `.find()` | `hooks/host/domain/history.ts:42`、`mobile/host/agent/loop/candidates.ts:417`、`loop.ts:472,636`、`pet/host/runtime/core.cjs:15`、`theme/client/settings-motion.ts:49` | `toReversed()` / `toSorted()` / `findLast()` |
| 构造后赋值 `.cause` | `mobile/client/index.tsx:33,40`、`mobile/host/device/daemon-rpc.ts:187`、`stream/routes.ts:220`、`remote/client/wechat/model.ts:182` | `new Error(msg, { cause })`（保留原 `.message`，有测试断言） |

---

## 7. 建议的落地顺序

**第 1 批（半天，零风险，只有收益）**
P0 三条 + `AbortSignal.timeout/any` + `Promise.withResolvers` + `structuredClone` + `toSorted/findLast` + `Error.cause`。
验证：`pnpm build`、`pnpm check`、相关单测；IME 改动手工验一次（中文输入法打「zhongwen」按 Enter 建分支）。

**第 2 批（1-2 天，收益最大）**
菜单 3 处 + 远程面板统一到 popover（定位仍用现有 JS），顺带清掉重复的 Escape 注册、遮罩、无效 `role`。
验证：手工验 Esc/点外/箭头键/焦点还原；跑 `tests/integration` 里涉及这些面板的用例。

**第 3 批（1 天，纯性能）**
4.1 串流可见性 + 4.2 ResizeObserver 替 250ms 轮询 + 4.3/4.4 观察者收窄 + 4.5 轮询可见性上提。

**第 4 批（按需）**
`ResizableDialog` → `<dialog>`、toast → `popover=manual`、表单/ARIA/CSS 细节。

---

## 8. 怎么复跑这份审计

```powershell
$cli = 'D:\DeepSeekHarness-home\skills\modern-web-guidance\modern-web.mjs'
node $cli legacy-scan . --json            # 静态规则（约 20% 语料）
node $cli search "anchor position tooltip"  # 找 guide
node $cli retrieve "menu,dialog"            # 读全文（含兼容性与回退要求）
```

> 本地安装版直接吃 `guides/` 目录（210 篇），离线、约 0.4s/次；`npx -y modern-web-guidance@latest` 每次要联网取包。两者内容一致，`update` 走 npx。

---

## 9. 证据索引（文件行号）

- 浮层：`client/ui/components/menu/index.ts:33-86`、`theme/client/settings-actions.ts:67-119`、`skills-mcp/client/panel.tsx:502-544`、`judgment/client/components.tsx:29-80`、`remote/client/panel.tsx:114-296`、`theme/client/rail-unpin.ts:31-111`、`client/ui/components/resizable-dialog/index.tsx:148-247`、`client/ui/toast.ts:90-152`
- 性能：`mobile/client/stream/use-h264-canvas.ts:147-152`、`mobile/client/panel.tsx:133-156`、`theme/client/sidebar.ts:215-227`、`theme/client/settings-nav.ts:322-330`、`theme/client/band.ts:19-34`、`src/client/poll.ts:22-36`
- 正确性：`git/client/surfaces/branch-chip/index.tsx:351-356`、`skills-mcp/client/hooks/useOAuth.ts:54-60`、`src/client/http.ts:17-27`
- 可访问性/表单：`skills-mcp/client/components/tabs.tsx:19-27`、`skills-mcp/client/components/form.ts:61-77`、`skills-mcp/client/components/skillDialog.tsx:114-125`