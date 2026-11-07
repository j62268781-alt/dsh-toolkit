# 外观页预览：照真实新会话页绘制

外观（设置 → 外观）顶部那块实时预览，展示的不再是手绘的占位界面，而是**当前版本真实新会话页的仿制品**：
鲸鱼标记 + 「探索未至之境」+「预览版」徽标、两个下拉 chip（工作区 / Agent 预设）、以及完整输入卡片
（占位文案、`+`、权限 chip、模型 chip 与发送按钮）。

## 为什么是「仿制品」而不是复用宿主组件

真实 hero 是宿主 `@deepseek-ai/dsh-client-ui-conversation` 里的 React 组件，类名是 CSS Module 的
hash 变体（`WOwLGG_*`、`GRgSLq_*`）。插件既拿不到这些组件实例，也不允许把这些 hash 类名写进样式：

- `tests/integration/theme-center.test.mjs` 断言 `theme-center.css` **不得**出现 `class*="_xxxxx_"`
  这类宿主类名子串；
- 宿主换版时 hash 会变，写死等于自毁。

所以预览用**自有 `.sk-theme-preview-*` 类名**重建同一套结构，只有「美术素材」沿用宿主的真值。

## 素材来源（`src/modules/theme/client/hero-art.js`）

| 导出 | 内容 |
| --- | --- |
| `HERO_FISH_PATH` | 宿主 hero 鲸鱼路径，`viewBox 0 0 23.16 17.04`，3448 字符，原样取自真机渲染出的 `<path d>` |
| `HERO_ICONS` | `folder / preset / shield / chevron / plus` 五个图标的 path 几何，来自宿主 sprite 的 `<symbol>`（`dsw-icon-*`），颜色一律 `currentColor` |
| `SEND_PATH` | 输入卡片发送按钮的 16×16 箭头路径 |

**为什么不直接 `<use href="#dsw-icon-...">`**：那些 symbol 属于宿主的 sprite，插件不能假定它一定在页面上；
而且预览是静态插图，内联 path 更可控、可测试、不产生跨文档引用。

> 生成脚本 `gen-icons.mjs` 是一次性的逆向工具（存在 `.cache/`，不入库）。要重新取数：在真机新会话页
> 用 CDP 抓 `svg[data-icon=...]` 的 `outerHTML` 与 hero 鲸鱼的 `<path>`。

## 尺寸与文案（都以真机量为准）

视口 1280×900、dpr2 实测：

| 元素 | 值 |
| --- | --- |
| 标题行 | 26px / 500 / 行高 32，图标与文字间距 10，标题与徽标间距 7 |
| 鲸鱼图标 | 34×25，`currentColor` |
| 「预览版」徽标 | 12px / 500 / 行高 18，`padding: 1px 7px 0`，圆角 999，底 `#e4edfd`，字 `#0e3074` |
| 下拉 chip | 高 28，圆角 6，`padding: 0 8px`，13px / 500，图标 16，chevron 12～14 |
| 输入卡片 | 圆角 20，`padding-top: 8px`，底纯白，阴影 `0 0 0 .5px rgb(0 0 0/.1)` + 两层柔光 |
| 输入区 | 最小高 52，`padding: 4px 8px 0 14px`，占位色 `#adb2b8`，14px / 24 |
| 按钮行 | `padding: 2px 8px 6px`，间距 12；`+` 28×28 圆、底 `#f5f6f7`；发送 34×34 圆、底 `#4176e6`、`translateY(-2px)` |

文案取真实 locale 值，**不要改写**：

- 标题 `探索未至之境`，徽标 `预览版`
- 占位 `描述你想要构建的内容, / 调用指令, @ 文件或对话`（单行，中间是 `, / ` 而不是换行）
- 工作区 chip `dsh-toolkit`，预设 chip `标准模式`，权限 chip `工作区内修改`
- 模型 chip `DeepSeek-V4.1-Flash` + 灰字 `High`（真机当前是 `DeepSeek-Flash · x0.1` + `Max`，
  这里按产品口径展示新模型名；其余文案仍以真机为准）

## 保留的旧行为

- `data-preview-palette` / `data-preview-mode` 仍在最外层 window 上，四个调色板各自的皮肤照旧生效；
- ocean / hope 的预览覆盖改为作用于 `.sk-theme-preview-send`（原先是 `.sk-theme-preview-composer i`，
  那个蓝点已经被真实的发送按钮取代）；这两个调色板的其它覆盖（rail / logo / composer 背景与圆角）不变；
- `SceneBox` 仍挂在 `.sk-theme-preview-hero` 里，作为最底层装饰，`data-sk-preview-hero` 属性保留。

## 交互细节

鲸鱼图标保留真机的「招手」动效：`@media (hover: hover) and (prefers-reduced-motion: no-preference)`
下 hover 时按 `sk-theme-fish-swim` 摆动 1.6s（对应宿主 `WOwLGG_hero-fish-swim` 的同样关键帧）。
预览其余部分全部 `aria-hidden`，不抢焦点、不可交互 —— 它只是插图。

## 验证方式

改了这块之后：

```powershell
pnpm build
node --test tests/integration/theme-center.test.mjs tests/integration/theme-ocean.test.mjs tests/integration/theme-hope.test.mjs
```

真机对照：`.cache/x/preview-shot.mjs <authority> <out.png>` 会打开设置 → 外观，滚动到预览并把
window 单独截图；`.cache/x/preview-grid.mjs <authority>` 强制切换 `data-preview-palette` / `data-preview-mode`
抓四主题 × 明暗八张，用于确认皮肤没有互相串味。
