# Codex 侧栏更新入口：设计确认与实现

> 适用范围：仅 `html[data-sk-palette="codex"]`。其他主题不做任何改动。
> 宿主版本：DSH 桌面端 0.2.1-rc.5（client bundle `dsh-client-ui-settings-general`）。
> 状态：设计已确认并实现（`update-tile.js` + `sidebar.css`），`pnpm build` / `pnpm check` 通过，单测 5 例全绿。

## 1. 原生行为（非 codex 主题下是什么样）

侧栏底部设置行的末位是 `DesktopUpdateIndicator`，它只在**桌面端 + 侧栏展开**时渲染（依赖 preload 桥
`window.dshDesktop.updates`，protocolVersion 1；浏览器里根本没有这个按钮）。连接状态提示出现时它会被隐藏。

| 阶段 phase | 按钮上的文字（label） | 悬停气泡（tooltip detail） | 点击 |
| --- | --- | --- | --- |
| available | 新版本 | 新版本：0.2.1 | 直接开始下载（无二次确认） |
| downloading | 42%（进度百分比） | 正在下载更新：42%⏎目标版本：0.2.1 | 无（按钮 busy） |
| verifying | 正在校验更新文件… | 0.2.1（无版本时显示 label） | 无 |
| installing | 正在准备重启… | 0.2.1 | 无 |
| ready | 安装并重启 | 安装并重启：0.2.1 | 打开「安装并重启」确认框 |
| error | 重试更新 | 检查/下载/安装失败等具体文案 | 重试 |
| checking | 正在检查更新… | — | 无（主进程从不发布这个相位） |

视觉：28px 高、蓝色 20% 描边的浅蓝底 pill，14px 图标 + 12px 文案；tooltip 是深色气泡、13px 白字。

## 2. 已修：codex 下气泡是空的

原生 `Tooltip` 原语默认 `portal: false`——气泡**不 portal**，而是作为触发器的兄弟节点内联渲染：

```html
<span role="tooltip" class="_bubble_44yfq_1"><span class="_label_44yfq_30">新版本：0.2.1</span></span>
```

codex 为了在窄轨道里隐藏账户按钮的文字，写了这条规则：

```css
… [class*="_settingsArea"] [class*="_label"] { position:absolute; width:1px; height:1px;
                                                  clip-path: inset(50%); white-space: nowrap }
```

它同时命中了气泡里的 `_label_44yfq_30`，于是气泡只剩 `padding: 3px 7px` 的黑块（实测 14×6px）。

**修复**：紧接着补一条复位规则，只作用于气泡内部（`role="tooltip"`）：

```css
… [class*="_settingsArea"] [role="tooltip"] [class*="_label"] {
  position: static; width: auto; height: auto;
  overflow: visible; clip-path: none; white-space: inherit;
}
```

实测修后气泡 95×26、文案 `新版本：0.2.1` 正常显示，hover 行为与原生一致。

## 3. 已确认的设计（四选四）

| 问题 | 结论 |
| --- | --- |
| 图标按钮里还留不留文字 | **纯图标**，36×36，文案只在 tooltip 里 |
| 下载进度怎么表达 | **圆环 + 中心百分比**（环 24px、2px 粗，数字 9px/600 tabular-nums） |
| 「可安装」图标 | **箭头入托盘**（ready 与 available 同底色，glyph 不同） |
| 蓝色强调程度 | **无底色、无描边**，纯蓝色图标；hover 才出现与轨道按钮一致的灰底 |

## 4. 实现

### 4.1 数据来源

主题 client 直接订阅同一个 preload 桥 `globalThis.dshDesktop?.updates`（`protocolVersion === 1`）：
`subscribe(cb)` 推送 presentation，`status()` 取首帧初值；迟到的 status 不会覆盖已到达的实时相位。
拿到的 `{ phase, version?, percent?, failure? }` 与原生渲染同源，**不依赖文案/语言**。

桥不存在（浏览器）时从 `aria-label` 里的百分比推断 `downloading`，其余情况显示通用下载图标。

### 4.2 标记

在 `[data-slot="sidebar"] [class*="_triggerRow"] > [class*="_indicator"][aria-disabled]` 上写：

- `data-cx-update="available|downloading|verifying|installing|ready|error|unknown"`
- `data-cx-progress="42"` + 内联 `--cx-update-pct: 42%`（仅 downloading 携带）

`MutationObserver`（body，childList+subtree）+ `requestAnimationFrame` 合并重绘，处理按钮重渲染。

### 4.3 视觉（`sidebar.css`）

- `_triggerRow` 改为 `flex-direction: column-reverse`：原生把更新按钮追加在账户按钮之后，52px rail 里账户头像必须固定在最底，更新磁贴叠在它上方（x 8..44、36×36）。
- 隐藏原生 `> span`（图标与文案），用 `::before` + `mask-image` 内联 SVG 画相位图标；`conic-gradient` + `radial-gradient` mask 画进度环，`::after` 用 `attr(data-cx-progress) "%"` 写百分比。
- 图标 18px（与轨道上方面板图标同尺寸），磁贴 36×36 透明底、无描边：available / ready 只把颜色换成主题蓝；
  **所有相位**（含 downloading / verifying / installing 这些 busy 态）hover 时都显示 `--cx-rail-item-hover`
  灰底，与上方按钮完全一致。
- available / ready：`color: var(--dsw-alias-brand-primary-new-colorprimary-new-color)`；error：
  `var(--dsw-alias-state-error-primary, #c4453f)` + 右上 5px 红点。
- downloading：22px 圆环（2px 粗，`conic-gradient` + radial mask）+ 中心 8px 百分比（`attr(data-cx-progress)`）。
- verifying / installing：22px 完整浅蓝圆环 + 内部旋转的圆头蓝色弧（SVG mask + `rotate`），
  避免「只剩一段弧、不像圆」的观感；`@keyframes cx-update-spin` 全局但以 `cx-` 前缀隔离。
- **必须给 `::before` / `::after` 显式 `corner-shape: round`**：宿主 `@deepseek-ai/dsh-client-ui-theme`
  注入了 `@supports (corner-shape:superellipse(1.5)){ *,:before,:after { corner-shape: var(--dsw-corner-shape) } }`
  （`--dsw-corner-shape: superellipse(1.5)`），把任何 `border-radius:50%` 画成「超椭圆/圆角方块」。
  真机截图里那个「方轮廓 + 只有底部一段弧」的怪圈就是它造成的（harness 加回该规则可 1:1 复现，
  见 `.cache/x/zoom-compare.png` 第一格）。磁贴自身的 8px hover 圆角仍随宿主走，保持与轨道行一致。
- 原生 `aria-label`、`aria-disabled`、点击处理器、tooltip、对话框全部保留，磁贴不拦截任何事件。

### 4.4 文件与测试

| 内容 | 位置 |
| --- | --- |
| 桥订阅与属性写入 | `src/modules/theme/client/update-tile.js`（`installUpdateTile`，仅 codex shell 安装） |
| 磁贴视觉 | `src/modules/theme/client/styles/sidebar.css`（`[data-cx-update=…]` 规则块） |
| 安装器接线 | `src/modules/theme/client/index.js` |
| 单测（jsdom） | `tests/integration/theme-update-tile.test.mjs`（5 例：降级、桥、迟到 status、异常、卸载清理） |
| 调色板护栏 | `tests/integration/theme-shell.test.mjs`（允许 `cx-` 前缀的全局 @keyframes） |

## 5. 验证

- 无头 Chrome + 真实 CSS 的 harness（`.cache/x/build2.mjs`）渲染六种相位，对照图 `.cache/x/states.png`：
  available 蓝下载图标 / downloading 42% 环 / verifying、installing 旋转弧 / ready 入托盘 / error 红点重试。
- 放大对照图 `.cache/x/zoom-compare.png`：`demo-verifying-bug.html`（`bug-repro.mjs` 把宿主的
  `corner-shape: superellipse(1.5)` 加回去）呈圆角方块，修复后是正圆 —— 与真机截图一致。
- 旋转确认（`.cache/x/spin-check.mjs` 连拍四帧 + `spinsheet.py` 拼图 `.cache/x/spin-frames.png`）：
  verifying / installing 每帧弧的位置都不同，`frame-0` 与 `frame-2` 的像素差 bbox 分别为
  `(35, 53, 97, 96)`、`(35, 35, 77, 97)` ⇒ 动画在跑，不是「卡住」。
- 实测坐标（dpr2，viewport 1264×705）：磁贴 36×36 @ x=8..44 y=621..657；账户头像 36×36 @ y=661..697；没有横向溢出，不再压到白色面板卡。
- `pnpm build`（Host 223 / Client loader+7 / Packages 9, 259 files）、`pnpm check`（25/25 + tsc 未定义名字）、
  `pnpm build:check`（无 stale）、`node --test tests/integration/theme-shell.test.mjs tests/integration/theme-update-tile.test.mjs`
  （11/11）全部通过。
- 已知与本次无关：`tests/pet/*` 两例在 Windows 上失败（断言路径以 `/` 开头、`/runtime/main.cjs$` 正则），属既有的 POSIX 假设问题。

## 6. 如果要做「新的下载流程」

磁贴只负责表现桥已发布的相位，不拦事件，所以新流程的交互仍要落在原生侧：`main.js` 的 `updatesOpen`
handler（`main.js:12538-12541`，当前 manual 才弹确认）按相位分流，或在 preload 桥上加新 verb。
Web 侧可复用的状态呈现已经是现成的（本磁贴覆盖 有新版本 / 下载中 / 可安装 / 失败 四种可见状态）。
