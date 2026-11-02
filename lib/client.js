/**
 * dsh-shell-kit — 客户端产物，由 scripts/build-client.mjs 生成，请勿手改。
 * 源码：src/client/parts/*.jsx（按文件名排序拼接）+ src/client/styles/*.css
 */
const PKG = "dsh-shell-kit";
let React = null;
const CSS = "/**\n * dsh-shell-kit — 皮肤样式表\n * ============================================================================\n *\n * 目标：只换「结构」，不换「配色」。\n *   · 结构：把 DSH 的侧栏拆成 Codex 那样的 52px icon rail + 工作区面板，\n *           并收一档圆角、微调排版与间距；\n *   · 配色：一个色号都不新引入，全部引用 DSH 自己的 `--dsw-*` 令牌。\n *           于是浅色/深色、跟随系统、用户换第三方主题、DSH 自己改主题——皮肤\n *           都自动跟随，不会出现「皮肤和系统主题打架」或者过时的问题。\n *\n * ── 为什么这套 CSS 能生效（机制，不是猜测）─────────────────────────────\n *\n * 1) 颜色、圆角、阴影都走 `--dsw-*` 设计令牌，客户端组件的样式全部消费它们\n *    （`background:var(--dsw-alias-bg-base)`）。我们不改这些令牌，只消费。\n *\n * 2) 组件内部布局没有公开的 class 名（CSS Modules 带每版本哈希前缀，例如\n *    `kB3qhq_root`）。因此次级修改只用两种稳定锚点：\n *      · `<div data-slot=\"<seat>\">` —— 槽位包裹层，名字是公开契约；\n *      · `[class*=\"_localName\"]` —— 子串选择器，跨版本仍能命中哈希类名。\n *    一律 `>` 直连、不做宽泛后代选择器：`_root` / `_iconButton` 这类局部名在\n *    别的组件里重名（WorkspaceBrowser 也有 `_root`、`_rail`、`_iconButton`），\n *    后代选择器会误伤。\n *\n * 3) 样式表是客户端 bundle 在 apply 时自建 `<style data-plugin=…>` 插到 head\n *    末尾的（与官方包同一通道），所以后注入即覆盖；插件被逐出时 `ctx.effect`\n *    的 disposer 会把整张表摘掉。\n *\n * ── 边界 ────────────────────────────────────────────────────────────────\n *\n * 这是「样式接管」，不是「组件替换」：侧栏的 DOM 与交互仍由 ui-sidebar 渲染，\n * 我们只是用 grid 把它重排。所以：\n *   · 折叠态（点折叠按钮）原样交还给 DSH 自己的表现，不试图接管；\n *   · panelList 图标化后标题文字被视觉隐藏（仍在无障碍树里），tooltip 由\n *     `src/client/index.js` 的 installRailTitles() 用 JS 补；\n *   · 换到没见过的版本时，哈希前缀变了不要紧，但要留意局部名是否改名。\n */\n\n/* ════════════════════════════════════════════════════════════════════════\n * 层 1 · 局部别名：把 DSH 的令牌接成皮肤要用的几个「表面」\n * ────────────────────────────────────────────────────────────────────────\n * 平台没有「rail 比面板深一档」这种概念，所以用 color-mix 从平台令牌现算：\n *   · 浅色：sidebar-fill = bluish-50 (#f9fafb)，压暗 6% ≈ bluish-75；\n *   · 深色：sidebar-fill = bluish-900 (#1b1b1c)，提亮 6% ≈ bluish-875。\n * 定义在 body 上而不是侧栏 root 上：macOS 的通栏层（下一节）要把同一条色带\n * 画到中央列的顶带上，跨列取值必须放在共同祖先。 */\nhtml body {\n  --cx-rail: color-mix(\n    in srgb,\n    var(--dsw-specific-sidebar-fill),\n    var(--dsw-alias-label-primary) 6%\n  );\n  /* 选中态统一成同一个「浅底方块」：home 入口和每个面板图标点击后长得一样。\n   * 原来用平台的 --dsw-specific-sidebar-nav-item-active，桌面端主题里不一定\n   * 定义 → 取不到值就是透明，表现为「点了没反应」。这里直接落到 alias 令牌，\n   * 两边都取得到。 */\n  --cx-rail-item-hover: var(--dsw-alias-interactive-bg-hover);\n  --cx-rail-item-active: var(--dsw-alias-interactive-bg-hover);\n  --cx-line: var(--dsw-alias-border-l3);\n}\n\n/* 圆角：这是唯一保留的「造型」差异（不是颜色）。DSH 默认\n * xs4/sm8/md12/lg16/xl20/panel28 偏圆润，Codex 更像 3/6/8/12/14/20。\n * 平台把它声明在 `:root{}` 里 —— 伪类比元素选择器权重高（0,1,0 > 0,0,1），\n * 所以必须写 `html:root`（0,1,1）才压得住，光写 `html` 会静默失效。 */\nhtml:root {\n  --dsw-radius-xs: 3px;\n  --dsw-radius-sm: 6px;\n  --dsw-radius-md: 8px;\n  --dsw-radius-lg: 12px;\n  --dsw-radius-xl: 14px;\n  --dsw-radius-panel: 20px;\n}\n\n/* ════════════════════════════════════════════════════════════════════════\n * 层 1.5 · 布局变量：**平台差异只在这一节分叉**，全表其余规则只有一份\n * ────────────────────────────────────────────────────────────────────────\n * `data-sk-desktop` 由 client 插件打在 <html> 上（parts/00-core.jsx 的\n * installDesktopMarker），判据是 macOS(darwin) 或 Windows(data-windows-titlebar)。\n * CSS 和 JS 共用这一个标记，避免「CSS 改了 macOS、JS 还只认 darwin」的分叉。\n *\n * 两个平台真正不同的只有三处，所以只让这三个变量分叉：\n *   · --cx-band-h     顶部色带高度\n *       macOS：JS 量「会话标题行下边缘」后回写（默认 50px 兜底）\n *       Windows：0px —— 色带由 DSH 自己的 frame `padding-top:\n *                var(--dsh-windows-titlebar-height)` 让位，我们不再叠一层\n *   · --cx-toggle-x   折叠钮的水平锚点\n *       macOS：88px（红黄绿三灯右侧）\n *       Windows：12px（DSH 原生就把折叠钮 fixed 在 left:12px）\n *   · --cx-title-clear 会话标题给「窗口 chrome」让出的宽度\n *       macOS：160px（全屏 84px），避开三灯 + shell.leading 那排钮\n *       Windows：0px（没有三灯，标题不该被推走）\n * ════════════════════════════════════════════════════════════════════════ */\nhtml[data-sk-desktop] body {\n  /* 卡片式布局参数：rail 52 + 面板 240 + 右缝 = 侧栏列宽 */\n  --cx-rail-w: 52px;\n  --cx-panel-w: 240px;\n  --cx-gap: 4px;\n  --cx-band-pad: 10px;\n  --cx-band: var(--cx-rail);\n  --cx-card-radius: 12px;\n  --cx-page-head-pad: 28px;\n  /* 标题与「窗口 chrome 让位带」之间额外的呼吸量。DSH 原生是\n   * clearance - 20px，收起态下 shell.leading 那排钮占 88–152，标题\n   * 从 140 起 —— 直接压进按钮区。加到 36px 后标题落在 176，\n   * 与按钮留出 24px。 */\n  --cx-title-air: 36px;\n  /* 下面是三个「平台差异」变量，默认值按 macOS 给（见下方两组覆盖） */\n  --cx-band-h: 50px;\n  --cx-toggle-x: 88px;\n  --cx-title-clear: 160px;\n  --cx-title-clear-full: 84px;\n}\n\n/* macOS：色带高度最终由 JS 回写，这里只是首帧兜底 */\nhtml[data-platform=\"darwin\"] body {\n  --cx-band-h: 50px;\n  --cx-toggle-x: 88px;\n  --cx-title-clear: 160px;\n  --cx-title-clear-full: 84px;\n}\n\n/* Windows：标题栏由 frame 的 padding 让位（_topStrip 是 darwin 独有），\n * 折叠钮是原生 fixed 在 titlebar 里的 left:12px，也没有三灯要让位。\n * --cx-rail 取和原生 titlebar 完全相同的色，避免「色带 vs rail」之间出现接缝。\n * --dsh-windows-content-radius 归零：原生用它给中央列切 16px 左上圆角，会把\n * 我们 12px 的卡片圆角裁出一个更大的缺口；卡片圆角由皮肤自己画。 */\nhtml[data-windows-titlebar] body {\n  --cx-band-h: 0px;\n  --cx-toggle-x: 12px;\n  --cx-title-clear: 0px;\n  --cx-title-clear-full: 0px;\n  --cx-rail: var(--dsw-specific-sidebar-fill);\n  --dsh-windows-content-radius: 0px;\n}\n\n/* ════════════════════════════════════════════════════════════════════════\n * 层 2 · macOS 通栏：顶部一条定高底色带，与左侧 rail 连成一片\n * ────────────────────────────────────────────────────────────────────────\n * Codex 的窗口是「顶栏 + 左 rail 共用一块底色，其余全白」。DSH 在 darwin 上\n * 是三段各画各的：frame 透明（露毛玻璃）、侧栏列是毛玻璃叠色、中央列是\n * bg-base 白。于是顶部那条里左中右三种底色，看着是断开的。\n *\n * 做法：把「顶部色带 + 白色」画到三列各自的 background 上（三列都从 y=0 起，\n * 所以一条定高的线性渐变就能拉齐），再把盖在中央列最上层的那层白底\n * （会话根节点 `[data-slot=\"main.conversation\"] > ._root`，background:\n * bg-base）改成透明，让色带透上来。侧栏里 rail 那条 52px 竖带仍然由\n * SidebarRoot 自己画，宽度和色带一致，两者在左上角无缝接成 L 形。\n *\n * 高度取 40px —— 这是会话页头里 **标题行** 的高度：页头 `_header` 是\n * `min-height:76px; padding:10px 28px 0 20px` 的两行网格，第一行是标题行\n * （`_titleRow`，min-height:30px）→ 10+30=40；第二行才是 tab 行（40–76）。\n * 实测量到的标题文字在 18–31px、tab 文字在 53–64px，与这个划分吻合。色带\n * 只盖住标题行，所以「对话 / 轨迹 / 上下文 …」那排 tab 落在白色上，属于内容\n * 区而不是标题栏。要改高矮只改 --cx-band-h。\n *\n * 几点刻意的取舍：\n *   · 色带以下：侧栏面板与中央列都用 bg-base（浅色即纯白），即用户要的\n *     「工作区用白色」；rail 竖直方向仍保持色带色，L 形不断。\n *   · 整个外壳里 **一根竖线都不画**：侧栏列/中央列之间的 border 与渐变线\n *     全部去掉 —— 面板与对话区同色，本来也不需要分隔。\n *   · 色带底边也不画线：色带是在页头中间断开的，加线会横穿页头。\n *\n * 触发条件是统一的 `html[data-sk-desktop]`：这个标记由 client 插件在 apply 时\n * 打到 <html> 上（见 parts/00-core.jsx 的 installDesktopMarker），判据是\n * 「macOS（data-platform=\"darwin\"）或 Windows（data-windows-titlebar）」——\n * 网页端两者都没有，所以不会误命中。\n * 布局变量（含平台差异）统一在 styles/10-tokens.css 定义，这里只消费。\n * ════════════════════════════════════════════════════════════════════════ */\n\n/* ── 外壳色：三列统一铺「rail 色」────────────────────────────────────\n * 卡片式布局里，色带、栏间距、卡片外的缝隙都应该是同一种「外壳色」。\n * 三列都从 y=0 起，各自铺一层纯色，天然连成一片 L 形 + 底部一条缝。 */\nhtml[data-sk-desktop] [class*=\"_frame\"] > [class*=\"_sidebarCol\"],\nhtml[data-sk-desktop] [class*=\"_frame\"] > [class*=\"_centerCol\"],\nhtml[data-sk-desktop] [class*=\"_frame\"] > [class*=\"_rightbarCol\"] {\n  background-color: var(--cx-rail);\n  background-image: none;\n  border-left: none;\n  border-right: none;\n}\n\n/* ── 中央区的「通用白卡片」───────────────────────────────────────────\n * 不只是会话页：插件、自动化任务等任何进入中央区的页面视图，都要长成同一张\n * 白卡片（从色带下沿开始、12px 圆角、右/下各留 4px 外壳色）。\n *\n * 中央主槽位的包裹层是 `display: contents`（没有盒子），真正的页面视图是它的\n * 子元素；会话页那层是 keyed 槽位 `[data-slot=\"main.conversation\"]`（同样是\n * contents），由下面「层 2」的专用规则处理，所以这里用 `:not([data-slot])`\n * 把页面视图挑出来，不会误伤会话。\n *\n * 用 margin 而不是 padding：页面视图自己就是滚动容器，padding 会跟着滚动内容\n * 一起动，margin 不会。圆角会给滚动容器也裁出圆角（Chromium 对 scroll\n * container 同样生效），这样页面自己的白底也不会把卡片角补成直角。 */\nhtml[data-sk-desktop] [data-slot=\"main\"] > :not([data-slot]) {\n  /* 卡片仍然从色带下沿开始（上面那条色带空着，和会话页保持同一套版式）。 */\n  margin: var(--cx-band-h) var(--cx-gap) var(--cx-gap) 0;\n  /* 有些页面视图自己写了 width:100%，只靠 margin 会把右边缝挤没（100% 是\n     按容器算的，margin 再往下推就溢出了），所以再夹一道 max-width。 */\n  max-width: calc(100% - var(--cx-gap));\n  border-radius: var(--cx-card-radius);\n  background-color: var(--dsw-alias-bg-base);\n}\n\n/* 页面自己的标题区上内边距 76px 太大（卡片顶边已经在色带下沿，再叠 76px 标题\n * 就离卡片顶 126px，显得空）。DSH 自己的页面（插件页 `_pageHead`、自动化任务\n * `_pageHeading`）和第三方页面（如 dsh-context 的 `lc-ov-pagehead`）都是这一套\n * 76px，所以用大小写不敏感的 `pagehead` 子串一次按住宅们，统一收到\n * `--cx-page-head-pad`。特异性 (0,3,0) 高于它们自己的 `.xxx{padding-top:76px}`，\n * 不需要 !important。 */\nhtml[data-sk-desktop] [data-slot=\"main\"] > :not([data-slot]) [class*=\"pagehead\" i] {\n  padding-top: var(--cx-page-head-pad, 28px);\n}\n\n/* 拖拽手柄关掉：面板宽度是定死的（由 JS 把 frame 的第一条栅格轨锁成\n * 52 + 240 + 1.5），留着它就只是在骗用户「可以拖」。 */\nhtml[data-sk-desktop] [class*=\"_frame\"] > [class*=\"_handle\"] {\n  display: none;\n}\n\n/* ── 会话区 = 白卡片（圆角，右/下留缝）────────────────────────────────\n * 卡片画在「会话根」上，而不是画在中央列上：内核 CSS 里会话根本身就是\n * `overflow: hidden` 的裁剪容器（`_root{background:bg-base; overflow:hidden}`），\n * 于是卡片圆角能把里面的正文 / 输入框一起裁成圆角 —— 这是圆角能「看起来」\n * 生效的关键：只要有任何一层白底画到列边，直角就会盖住卡片圆角。\n * 上半段留透明：色带（0 …--cx-band-h）仍由中央列画，页头标题落在色带上。 */\n\n/* 会话根节点原本整列铺一层 bg-base 白，会把中央列的色带盖掉 —— 改成透明，\n * 白底由中央列自己画（同色令牌，第三方主题下依然一致）。 */\n/* 页头：把 10px 的 padding-top 收掉、改成标题行自己的上下等内边距 ——\n * 于是「色带高度 = 10 + 标题行内容 + 10」，标题文字在色带里垂直居中，\n * 而 tab 行正好从色带下边缘开始（落在白色上）。 */\nhtml[data-sk-desktop]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_header\"]:has([class*=\"_titleRow\"]) {\n  padding-top: 0;\n}\n\n/* 会话标题左侧的文件夹图标：跟工作区列表里那个\"未选中文件夹\"同形同色，\n * 用 mask + 背景色画，形状是 16×16 描边文件夹（stroke-width 1，与 DSH\n * 自己的图标集同规格）。只加在有会话的页头上，空会话的 headerBlank 不画。 */\nhtml[data-sk-desktop]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_header\"]:has([class*=\"_titleRow\"]):not([class*=\"_headerBlank\"])\n  [class*=\"_crumbCurrent\"]::before {\n  content: \"\";\n  display: inline-block;\n  width: 16px;\n  height: 16px;\n  margin-right: 6px;\n  vertical-align: -3px;\n  background-color: var(--dsw-alias-label-tertiary);\n  -webkit-mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23000' stroke-width='1'%3E%3Cpath d='M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z'/%3E%3Cpath d='M3.63501 7.66614H12.3647'/%3E%3C/svg%3E\");\n  mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23000' stroke-width='1'%3E%3Cpath d='M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z'/%3E%3Cpath d='M3.63501 7.66614H12.3647'/%3E%3C/svg%3E\");\n  -webkit-mask-position: center;\n  mask-position: center;\n  -webkit-mask-size: 16px 16px;\n  mask-size: 16px 16px;\n  -webkit-mask-repeat: no-repeat;\n  mask-repeat: no-repeat;\n}\n\nhtml[data-sk-desktop]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_header\"]:has([class*=\"_titleRow\"])\n  [class*=\"_titleRow\"] {\n  min-height: 30px;\n  padding-block: var(--cx-band-pad);\n  box-sizing: content-box;\n}\n\nhtml[data-sk-desktop] [data-slot=\"main.conversation\"] > [class*=\"_root\"] {\n  position: relative;\n  isolation: isolate;\n  margin-right: var(--cx-gap);\n  margin-bottom: var(--cx-gap);\n  /* 只裁下缘：上缘的圆角由 ::before 那张卡片自己画，根的上 12px 在色带里，\n     拿它去裁会把标题行贴边的像素切掉。 */\n  border-radius: 0 0 var(--cx-card-radius) var(--cx-card-radius);\n  overflow: hidden;\n  background: none;\n}\n\n/* 会话卡片本体：从色带下沿开始的一张 12px 圆角白卡。\n * 画在根的 ::before 上（宿主 isolation + z-index:-1），于是它只在内容下面；\n * 上缘的圆角靠它自己，下缘另由根的 overflow+radius 裁住内容。 */\nhtml[data-sk-desktop] [data-slot=\"main.conversation\"] > [class*=\"_root\"]::before {\n  content: \"\";\n  position: absolute;\n  top: var(--cx-band-h);\n  left: 0;\n  right: 0;\n  bottom: 0;\n  border-radius: var(--cx-card-radius);\n  background: var(--dsw-alias-bg-base);\n  z-index: -1;\n  pointer-events: none;\n}\n\n/* 标题行贴到卡片左缘（页头默认左内边距 20px，tab 行单独保留，于是两行\n * 各自的位置都不变，只有标题跟着卡片的白色左边走）。 */\nhtml[data-sk-desktop]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_header\"]:has([class*=\"_titleRow\"]) {\n  padding-left: 0;\n}\n\nhtml[data-sk-desktop]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_header\"]:has([class*=\"_titleRow\"])\n  [class*=\"_tabs\"] {\n  padding-left: 20px;\n}\n\n/* ════════════════════════════════════════════════════════════════════════\n * 层 3 · 侧栏重排：52px icon rail + 工作区面板\n * ────────────────────────────────────────────────────────────────────────\n * SidebarRoot 的直接子节点顺序是固定的（源码 dsh-client-ui-sidebar:\n *   div._root[.collapsed][.fading][.quietBars]\n *     └─ div._topStrip      （仅 darwin，含折叠按钮）\n *        div._logoRow       （brand.mark + brand.name）\n *        button._newSession\n *        nav._panelList\n *        div._regionArea    （sidebar.workspaces 槽位）\n *        div._footArea      （footer.action + settings）\n *\n * 我们用 grid 把它拍成两列若干行（折叠钮绝对定位在标题栏带里，不占网格）：\n *\n *          rail(52)   panel(1fr)\n *  band ┌──────────────────────────────┐  ← 标题栏带（= rail 同色）\n *       │  ▣                 brand …    │     三灯 / 折叠钮 / 会话标题\n *       ├─────────┬────────────────────┤\n *       │ 插件     │ 新会话（原生按钮）  │  ← 46px 品牌行 + 原生新建会话行\n *       │ …        │ workspaces         │  ← 1fr\n *       ├─────────┼────────────────────┤\n *       │ 头像      │ footer(额度卡)      │  ← auto\n *       └─────────┴────────────────────┘\n *\n * 三点取舍：\n *   1) 折叠钮放在标题栏带里、红黄绿三灯右侧的**原生位置**（left 88px、28×28、\n *      垂直居中）—— 与侧栏收起后 DSH 自己的 shell.leading 控件位置一致，\n *      所以展开/收起时按钮不会跳。\n *   2) 「新会话」保留 DSH 原生的按钮样式（38px 高、带边框、居中文案），只是\n *      落进面板列（品牌行下面），不再改成 rail 里的 ＋ 图标。\n *   3) 账户头像在 rail 底，与额度卡同一水平线（同一行）。实现靠\n *      `_footArea{display:contents}` 把它的两个子节点（额度卡\n *      `_footerActions` / 账户 `_settingsArea`）提升成 grid item，各占一格。\n *\n * rail 的底色画在 root 的 background 上（52px 色带，面板区留 transparent，\n * 露出侧栏列自己画的底色），这样即使某个单元格是空的色带也连续。\n * 折叠态用 `:not([class*=\"_collapsed\"])` 排除，交还给 DSH 自己的表现。\n *\n * 顶部的让位高度用 `var(--cx-band-h)`：**不写死**。默认值只是兜底，运行时由\n * client 插件里的 JS 量「会话标题行的下边缘」回写（页头两行里第一行就是标题\n * 行），所以页头内边距/字号变了它跟着变。\n * ════════════════════════════════════════════════════════════════════════ */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) {\n  /* 侧栏原本靠 padding 撑内边距，重排后由各列自己负责 */\n  --dsh-sidebar-inline-padding: 0px;\n  display: grid;\n  grid-template-columns: var(--cx-rail-w) var(--cx-panel-w);\n  grid-template-rows: 46px auto minmax(0, 1fr) auto;\n  grid-template-areas:\n    \"nav     brand\"\n    \"nav     new\"\n    \"nav     region\"\n    \"account foot\";\n  /* 顶部让位给 macOS 标题栏带（三灯 + 折叠钮）：内容让开，但 rail 的色带要\n     一直画到窗口顶边（background 覆盖 padding 区），看起来才是「从顶到底的\n     一整条 rail」。rail 与白色面板之间刻意「不画线」：只留一次颜色跳变，\n     线条会把这一整块重新切开。 */\n  padding: var(--cx-band-h) 0 0;\n  position: relative;\n  background: linear-gradient(\n    to right,\n    var(--cx-rail) 0 52px,\n    transparent 52px\n  );\n}\n\n/* root 本来带一个行内 width（= 用户偏好 280px）；列宽被我们锁成 293.5 之后\n * 它只会让内容挤在左侧 280px 里，剩下的按键区露出来。压成 100% 一致。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) {\n  width: 100% !important;\n  /* 让 root 成为层叠上下文，面板卡片的 z-index:-1 才会「盖住根背景、垫在\n   * 内容下面」；否则负 z-index 会跑到列背景背后去。 */\n  isolation: isolate;\n}\n\n/* 工作区面板 = 白卡片：从 rail 右边开始，宽 240、右/下各留 1.5px 缝 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]):not([data-sk-rail-only])::after {\n  content: \"\";\n  position: absolute;\n  top: var(--cx-band-h);\n  left: var(--cx-rail-w);\n  width: var(--cx-panel-w);\n  bottom: var(--cx-gap);\n  border-radius: var(--cx-card-radius);\n  background: var(--dsw-alias-bg-base);\n  z-index: -1;\n  pointer-events: none;\n}\n\n/* rail-only 下原生折叠钮在 [88,11]：视觉上还看得见（它 fixed 出了 52px 的列），\n * 但层叠顺序在 sidebarCol 里，点击会被主区标题行吃掉（实测 elementFromPoint\n * 拿到 kiGsTW_titleRow）。所以在这个坐标放一个体级透明热区按钮接住点击，\n * 只画 hover 底色，图标仍由原生那颗显示。 */\n.sk-collapse-hit {\n  position: fixed;\n  left: var(--cx-toggle-x);\n  top: calc((var(--cx-band-h) - 28px) / 2);\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  border: 0;\n  border-radius: var(--dsw-radius-md);\n  background: transparent;\n  cursor: pointer;\n  z-index: 40;\n  display: none;\n}\n.sk-collapse-hit[data-show] {\n  display: block;\n}\n.sk-collapse-hit:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n.sk-collapse-hit:focus-visible {\n  outline: 2px solid var(--dsw-alias-label-primary);\n  outline-offset: -2px;\n}\n\n/* ── rail-only：选中非 home 的图标时，侧栏收成纯图标栏 ─────────────────\n * 用户要的行为：点房子 → 展开「工作区」列；点插件 / 自动化任务 → 工作区\n * 让位，主区拿到那 240px。做法是给 root 打 data-sk-rail-only，JS 里\n * installSidebarWidth() 同时把 frame 的首轨从 296px 改成 52px（= rail 宽度，\n * 不留缝），这样主区卡片自己铺到 x=52，rail 的视觉宽度与 home 态完全一致。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] {\n  grid-template-columns: var(--cx-rail-w);\n  grid-template-rows: minmax(0, 1fr) auto;\n  grid-template-areas: \"nav\" \"account\";\n}\n\n/* 品牌行 / 新会话 / 工作区列表 / 底部动作区在这一态全部让位，只留 rail 本身 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] > [class*=\"_logoRow\"],\n[data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] > [class*=\"_newSession\"],\n[data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] > [class*=\"_regionArea\"],\n[data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] > [class*=\"_footArea\"] > [class*=\"_footerActions\"] {\n  display: none;\n}\n\n/* 折叠钮在 rail-only 时**留在原地不动**：home 态它在 (left:88, 色带垂直居中)，\n * 切到面板页时位置一模一样。\n *\n * 难点是它此时已经溢出 52px 的 rail 列、落在主区色带的水平范围里。DOM 顺序上\n * centerCol 在 sidebarCol 之后绘制，所以绝对定位会被盖住（实测 elementFromPoint\n * 拿到 centerCol、像素是纯色带色）。把定位换成 fixed：它的包含块变成视口、脱离\n * 侧栏列，再给一个高于 centerCol 的 z-index，就既画得出来也点得到（实测命中\n * 就是按钮本身）。z-index 只取 40 —— 够压住主区，又低于 DSH 的对话框/浮层。\n *\n * 折叠回 0px 后由 DSH 自己在 shell.leading（left:88）画展开钮，本规则不生效。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"])[data-sk-rail-only] > [class*=\"_topStrip\"] {\n  position: fixed;\n  top: calc((var(--cx-band-h) - 28px) / 2);\n  left: var(--cx-toggle-x);\n  z-index: 40;\n}\n\n/* ── rail-only 时，会话标题不能落进 macOS 三灯区 ────────────────────────\n * DSH 自己的做法：在 frame[data-sidebar-collapsed] 上把\n *   --dsh-frame-leading-clearance: 160px（全屏 84px）\n * 而会话标题行是\n *   padding-inline-start: max(0px, calc(clearance - 20px))\n * 我们只是把首轨写窄（DSH 认为侧栏没收起），这根 var 取不到 → 标题贴着卡片\n * 左缘（52px）一直顶到红绿灯下面。这里补上同样的带宽，并把 rail 那 52px 从\n * 内距里扣掉 —— 于是标题的绝对 x 与「整栏收起」时一致，切页面时不会横向跳动。\n * 另外原生只留 20px（clearance - 20），收起态下那颗折叠钮几乎贴着标题，\n * 所以两边都再加 --cx-title-air（20px）撑开呼吸。 */\nhtml[data-sk-desktop]\n  [class*=\"_frame\"]:has([data-sk-rail-only]) {\n  --dsh-frame-leading-clearance: var(--cx-title-clear);\n}\n\n/* 收起态（DSH 原生 data-sidebar-collapsed）也按同一套加呼吸量；\n * 必须带上状态选择器 —— 展开态没有让位带，标题要贴着卡片左缘。 */\nhtml[data-sk-desktop]\n  [class*=\"_frame\"][data-sidebar-collapsed]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_titleRow\"] {\n  padding-inline-start: max(\n    0px,\n    calc(var(--dsh-frame-leading-clearance, 0px) - 20px + var(--cx-title-air))\n  );\n}\n\nhtml[data-fullscreen] [class*=\"_frame\"]:has([data-sk-rail-only]) {\n  --dsh-frame-leading-clearance: var(--cx-title-clear-full);\n}\n\nhtml[data-sk-desktop]\n  [class*=\"_frame\"]:has([data-sk-rail-only])\n  [data-slot=\"main.conversation\"]\n  [class*=\"_titleRow\"] {\n  padding-inline-start: max(\n    0px,\n    calc(\n      var(--dsh-frame-leading-clearance, 0px) - 20px + var(--cx-title-air) - var(--cx-rail-w)\n    )\n  );\n}\n\n/* ── 卡片内部的「出血」元素，要跟着卡片缩进 4px ────────────────────────\n * 卡片是伪元素，内容却是原生节点：有两处会主动画到列的边缘、把 4px 缝糊掉。\n *   1) 页头的 border-bottom 横线：header 宽度 = 整列宽，线会横穿右侧缝隙；\n *   2) 输入框所在的 composerSeat 是 position:absolute; bottom:0 + 渐变白底，\n *      正好盖住底部缝隙。\n * 各自让开 var(--cx-gap) 即可，不改任何布局。 */\nhtml[data-sk-desktop]\n  [data-slot=\"main.conversation\"]\n  [class*=\"_header\"]:has([class*=\"_titleRow\"]) {\n  margin-right: 0;\n}\n\nhtml[data-sk-desktop] [data-slot=\"main.conversation\"] [class*=\"_composerSeat\"] {\n  bottom: 0;\n}\n\n/* ── 折叠按钮：放进 macOS 标题栏带（三灯右侧，与三灯同一条水平线）───────\n * 原生 `_topStrip` 是一条 52px 高、justify-content:flex-end 的横条（贴侧栏\n * 右上角）。这里把它改成绝对定位的小方块，落在三灯右边 —— 位置取 DSH 自己\n * 收起侧栏时 shell.leading 里那颗钮的位置（left 88px / 28×28 / 垂直居中），\n * 这样展开与收起两种状态下按钮不会跳。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_topStrip\"] {\n  position: absolute;\n  top: calc((var(--cx-band-h) - 28px) / 2);\n  left: var(--cx-toggle-x);\n  width: auto;\n  height: 28px;\n  margin: 0;\n  padding: 0;\n  z-index: 2;\n  justify-content: flex-start;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_topStrip\"] [class*=\"_iconButton\"] {\n  width: 28px;\n  height: 28px;\n}\n\n/* ── 品牌行 ───────────────────────────────────────────────────────────── */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_logoRow\"] {\n  grid-area: brand;\n  height: 46px;\n  margin: 0;\n  padding: 0 8px 0 10px;\n  justify-content: flex-start;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_logoRow\"] [class*=\"_brandName\"] {\n  font-size: 15px;\n  font-weight: 600;\n  letter-spacing: 0.01em;\n}\n\n/* ── 新会话：保留 DSH 原生按钮（38px、带边框、居中文案），落进面板列 ─────\n * 只做落位与左右内缩，样式全部沿用原生（不再改成 rail 里的 ＋ 图标）。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_newSession\"] {\n  grid-area: new;\n  margin: 0 8px 8px 4px;\n}\n\n/* ── rail 中部：面板图标 ───────────────────────────────────────────────\n * 注意内边距必须是 0：居中靠每一行的 `margin: 0 auto`。若这里留对称内边距，\n * 叠加 DSH 核心样式自己的（不对称）padding 后，行就不在 52px 轨道正中 ——\n * 实测 Windows 上图标中心偏右约 2.5px 就是这个原因。清零后 36px 的行在\n * 52px 轨道里恒居中等分（左右各 8px），与 DSH 内边距怎么写无关。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] {\n  grid-area: nav;\n  align-self: start;\n  margin: 6px 0 0;\n  padding: 0;\n  gap: 2px;\n}\n\n/* rail 图标放大 2px（DSH 原生 16px → 18px）。SVG 的 width/height 是属性，\n * CSS 能直接压过去；行高 36px 不变，只是 glyph 更醒目。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] [class*=\"_panelGlyph\"] svg {\n  width: 18px;\n  height: 18px;\n}\n\n/* 注意这里是**后代**选择器，不是 `>` 直连：列表里大部分行是直接子元素，但\n * 「更多」那颗行被 Menu 的 anchor 容器（`_moreAnchor`）多包了一层 —— 用直连\n * 会漏掉它，于是它保持 DSH 原生的整行宽度 + 左对齐，在 52px 轨道里露出一截，\n * 看起来就是「歪了、没居中」。后代选择器把两种挂法都覆盖到。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] [class*=\"_panelRow\"] {\n  width: 36px;\n  height: 36px;\n  min-height: 36px;\n  margin: 0 auto;\n  padding: 0;\n  border-radius: var(--dsw-radius-md);\n  justify-content: center;\n  gap: 0;\n}\n\n/* 包着一行的容器（目前只有 `_moreAnchor`）：占满 52px 轨道并让行居中。\n * 用 `:has()` 兜住「anchors 外面还套了几层」的版本差异，不用写死容器名。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] > *:has([class*=\"_panelRow\"]) {\n  display: flex;\n  justify-content: center;\n  width: 100%;\n  min-width: 0;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] [class*=\"_panelRow\"]:hover {\n  background: var(--cx-rail-item-hover);\n}\n\n/* 激活项用平台自己的「侧栏导航激活色」，与 DSH 其它地方的选中态一致 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] [class*=\"_panelRow\"][class*=\"_panelActive\"] {\n  background: var(--cx-rail-item-active);\n}\n\n/* 图标化：文字不 display:none，而是 clip 掉——保留无障碍树里的名字，\n * 屏幕阅读器和「按名字点」的自动化仍能找到它们。 */\n/* ── rail 最上面的「工作区」入口（home 图标）─────────────────────────\n * 按钮由 src/client/index.jsx 的 `installHomeRail()` 注入到面板列表最前面，\n * 点击 = `ctx.layout.selectPanel(null)`（回到会话/工作区视图）。\n * 样式和面板行同款：36×36、圆角 md、hover/active 都用 interactive-bg-hover，\n * 下面再加一条 1px 分隔线把它和「插件 / 自动化任务 / …」分成两组。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] > .sk-home {\n  box-sizing: border-box;\n  display: flex;\n  flex: none;\n  align-items: center;\n  justify-content: center;\n  width: 36px;\n  height: 36px;\n  margin: 0 auto;\n  padding: 0;\n  border: none;\n  border-radius: var(--dsw-radius-md);\n  background: transparent;\n  /* 和面板图标同一个描边色：DSH 的 `_panelRow` 本来就是 label-primary，\n   * 这里若用 label-secondary 会出现「只有房子是灰的」这种不一致。 */\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] > .sk-home:hover {\n  background: var(--cx-rail-item-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] > .sk-home[data-active=\"true\"] {\n  background: var(--cx-rail-item-active);\n  color: var(--dsw-alias-label-primary);\n}\n\n.sk-home__glyph {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.sk-home__glyph svg {\n  width: 18px;\n  height: 18px;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_panelList\"] [class*=\"_panelTitle\"] {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n\n/* ── 工作区（面板列）────────────────────────────────────────────────── */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_regionArea\"] {\n  grid-area: region;\n  min-height: 0;\n  margin: 0;\n  padding: 0 6px 0 4px;\n  overflow: hidden;\n}\n\n/* 区域小标题：小字号、加宽字距、大写，接近 Codex 的 section label */\n[data-slot=\"sidebar\"] [class*=\"_sectionHeader\"] {\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.06em;\n  text-transform: uppercase;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* ── 底部两格：rail 底 = 账户头像，右侧 = 额度卡 ─────────────────────────\n * `_footArea` 只是 `_footerActions`(额度卡) + `_settingsArea`(账户) 的竖排壳，\n * 把它 display:contents 化，两个子节点就直接成为 root grid 的 item，\n * 于是一个落进 rail 底、一个落进面板底，占同一行、同一水平线。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] {\n  display: contents;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] > [class*=\"_footerActions\"] {\n  grid-area: foot;\n  box-sizing: border-box;\n  padding: 0 8px 8px;\n  min-width: 0;\n}\n\n/* 账户：只留头像，名字 clip 掉（按钮有 aria-label=\"账号菜单\"） */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] > [class*=\"_settingsArea\"] {\n  grid-area: account;\n  align-self: end;\n  padding: 0 0 8px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n}\n\n/* 账户触发器原生是「44px 高、整行铺满」的，塞进 52px rail 要收成 36×36 的圆钮 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] > [class*=\"_settingsArea\"] [class*=\"_triggerRow\"] {\n  width: 100%;\n  margin: 0;\n  justify-content: center;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] > [class*=\"_settingsArea\"] [class*=\"_trigger\"]:not([class*=\"_triggerRow\"]) {\n  width: 36px;\n  height: 36px;\n  justify-content: center;\n  padding: 0;\n  gap: 0;\n}\n\n/* 按钮外面还套了一层 inline-flex 的 anchor（实测 52px 宽、默认 flex-start 对齐）：\n * 只把按钮收成 36px 不够 —— 它会在 anchor 里贴左，头像看着就歪到 rail 左缘了。\n * 把 anchor 也居中，头像才回到 rail 正中（52px rail → 按钮 x 8..44，头像中心 26）。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] > [class*=\"_settingsArea\"] [class*=\"_anchor\"] {\n  justify-content: center;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"]:not([class*=\"_collapsed\"]) > [class*=\"_footArea\"] > [class*=\"_settingsArea\"] [class*=\"_label\"] {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n\n/* ── 工作区列表：不画滚动条 ─────────────────────────────────────────────\n * 面板只有 240px，DSH 原生给列表留了一条 5px 滚动条 + `scrollbar-gutter:\n * stable`（预算 gutter 宽度在 `--dsh-session-list-scrollbar-*` 里，padding-right\n * 用它们算），行标题因此更早被截断。\n *\n * 这里把这几件事一起关掉：\n *   1) 原生滚动条不画（`scrollbar-width: none` + WebKit 的 `::-webkit-scrollbar`）；\n *   2) 不再预留 gutter（`scrollbar-gutter: auto`）；\n *   3) 把 DSH 自己的两个宽度变量归零 —— 否则 `_list` 的 padding-right 仍然按 5px\n *      算，右侧会多出一条空白，看着像\"滚动条没了但位置还占着\"。\n *\n * 只是**不画**，不是不能滚：滚轮 / 触控板 / 键盘仍然可以滚。 */\n[data-slot=\"sidebar\"] > [class*=\"_root\"] {\n  --dsh-session-list-scrollbar-width: 0px;\n  --dsh-session-list-scrollbar-offset: 0px;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"] [class*=\"_list\"] {\n  scrollbar-width: none;\n  scrollbar-gutter: auto;\n}\n\n[data-slot=\"sidebar\"] > [class*=\"_root\"] [class*=\"_list\"]::-webkit-scrollbar {\n  width: 0;\n  height: 0;\n  display: none;\n}\n\n/* ════════════════════════════════════════════════════════════════════════\n * 层 3.5 · Windows 专属的结构差异（不是数值，所以不能收进变量）\n * ────────────────────────────────────────────────────────────────────────\n * 依据 DSH 源码（@deepseek-ai/dsh-client-ui-sidebar 的 SidebarRoot）：\n *\n *   macOS ：`darwinDesktop && <div class=\"_topStrip\">{toggle}</div>`\n *           —— 折叠钮单独一条 52px 的条，绝对定位到三灯右侧。\n *   Windows：没有 _topStrip。折叠钮是 `_logoRow` 的**第二个子元素**，并且被\n *           核心 CSS `[data-windows-titlebar] ._toggle{position:fixed;left:12px;\n *           top:calc((var(--dsh-windows-titlebar-height) - 28px)/2)}` 钉进\n *           原生标题栏里。\n *\n * 所以 Windows 上有两处必须单独处理，否则会「整个按钮消失」：\n *   1) rail-only 态原本靠隐藏整个 `_logoRow` 让位；Windows 上折叠钮就在\n *      `_logoRow` 里，隐藏父节点会连 fixed 子节点一起不渲染 → 只藏品牌那块；\n *   2) 透明点击热区（.sk-collapse-hit）是为 macOS「按钮溢出 52px 轨道、被\n *      主区盖住」准备的；Windows 的按钮固定在 left:12px、完全在 rail 内，\n *      用不上，藏掉以免在错误位置冒出一个 hover 方块。\n * ════════════════════════════════════════════════════════════════════════ */\n\n/* 1) rail-only：只藏品牌，留下折叠钮（它 fixed，出流后仍可见可点） */\nhtml[data-windows-titlebar]\n  [data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] > [class*=\"_logoRow\"] {\n  display: flex;\n  height: 0;\n  min-height: 0;\n  margin: 0;\n  padding: 0;\n  overflow: visible;\n}\n\nhtml[data-windows-titlebar]\n  [data-slot=\"sidebar\"] > [class*=\"_root\"][data-sk-rail-only] > [class*=\"_logoRow\"] > [class*=\"_brand\"] {\n  display: none;\n}\n\n/* 2) macOS 专用的折叠钮热区，在 Windows 上不需要 */\nhtml[data-windows-titlebar] .sk-collapse-hit {\n  display: none !important;\n}\n\n\n/* ── 右侧边栏 = 标题栏 + 白卡片 ─────────────────────────────────────────\n * 右侧边栏走的是 dockkit：`[data-dockkit-pane]` 这个 section 自己铺满整列、\n * 底色就是 bg-base（纯白），所以整列从窗口顶到底是一块白，和左边的卡片式\n * 外壳接不上。\n *\n * 这里把 pane 的白底摘掉、改成一张卡片：\n *   · pane 本身透明（露出右列的外壳色 + 顶部色带）；\n *   · 卡片画在 pane 的 ::before 上，从色带下沿开始，右/下各留 4px；\n *   · pane 的第一行是标题栏（tab strip，实测 38px = 10 padding + 28 按钮），\n *     给它补一段 padding-bottom 正好到色带高度，标题就落在色带里，卡片\n *     紧贴其下开始 —— 与会话区的「标题行在色带、正文在白卡」同一套版式。\n *\n * 全屏态（浏览器 tab 全屏）不套这套：那时 pane 就是整个窗口，卡片化没有意义。 */\nhtml[data-sk-desktop]\n  [class*=\"_rightbarCol\"]\n  [class*=\"_panel\"]:not([data-sidebar-right-panel=\"fullscreen\"])\n  [data-dockkit-pane] {\n  background-color: transparent;\n  position: relative;\n  isolation: isolate;\n  /* dockkit 给每个 pane 画了一条 1px 左边框当分隔线（rgba(0,0,0,.16)），\n   * 卡片化之后这条线横穿色带与缝隙、在会话区右缘显形，去掉它 ——\n   * 卡片之间本来就隔着 4px 缝，不需要额外的线。 */\n  border-left: 0;\n}\n\nhtml[data-sk-desktop]\n  [class*=\"_rightbarCol\"]\n  [class*=\"_panel\"]:not([data-sidebar-right-panel=\"fullscreen\"])\n  [data-dockkit-pane]::before {\n  content: \"\";\n  position: absolute;\n  top: var(--cx-band-h);\n  left: 0;\n  right: var(--cx-gap);\n  bottom: var(--cx-gap);\n  border-radius: var(--cx-card-radius);\n  background: var(--dsw-alias-bg-base);\n  z-index: -1;\n  pointer-events: none;\n}\n\n/* 内容层也要跟着卡片收边。pane 的 body 是「铺满整列」的滚动容器（实测从\n * 色带下沿到窗口底、宽到窗口右缘），页面自己要是不透明（浏览器 iframe、\n * 文件预览、任何带底色的页面），就会把卡片的四个圆角和右/下两条 4px 缝\n * 一起盖掉 —— 看起来就是「右侧边栏没有圆角」。这里给 body 补上和卡片一致\n * 的边距 + 圆角 + 裁剪，谁在里面画白底都被收进卡片里。 */\nhtml[data-sk-desktop]\n  [class*=\"_rightbarCol\"]\n  [class*=\"_panel\"]:not([data-sidebar-right-panel=\"fullscreen\"])\n  [data-dockkit-pane]\n  > :last-child {\n  position: relative;\n  margin-right: var(--cx-gap);\n  margin-bottom: var(--cx-gap);\n  border-radius: var(--cx-card-radius);\n  overflow-x: hidden;\n  overflow-y: auto;\n}\n\n/* 标题栏补齐到色带高度：实测 38px（10px 上内边距 + 28px 按钮），\n * 补 var(--cx-band-h) - 38px 的 padding-bottom，标题行就正好在色带内结束。 */\nhtml[data-sk-desktop]\n  [class*=\"_rightbarCol\"]\n  [class*=\"_panel\"]:not([data-sidebar-right-panel=\"fullscreen\"])\n  [data-dockkit-pane]\n  > :first-child {\n  padding-bottom: calc(var(--cx-band-h) - 38px);\n}\n\n/* ══════════════════════════════════════════════════════════════════════\n * 设置页 · 已归档的聊天（`settings.section` → id: archived-chats）\n *\n * 这一块**不受平台门控**：设置页在网页端和桌面端都要长一样，所以它不套\n * `:is(html[data-platform=\"darwin\"], …)` 那层条件。颜色全部取 DSH 令牌，\n * 深浅色自动跟随。\n * ══════════════════════════════════════════════════════════════════════ */\n\n.sk-arch {\n  max-width: 760px;\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.sk-arch__head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n}\n\n.sk-arch__title {\n  margin: 0;\n  font-size: 18px;\n  font-weight: 600;\n}\n\n/* 主按钮：与行内次按钮区分，用实心文字色描边，不做大面积填充 */\n.sk-arch__action {\n  height: 32px;\n  padding: 0 12px;\n  border-radius: var(--dsw-radius-sm);\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 12.5px;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background-color 120ms ease;\n}\n\n.sk-arch__action:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.sk-arch__action:disabled,\n.sk-arch__btn:disabled {\n  opacity: 0.45;\n  cursor: default;\n}\n\n.sk-arch__bar {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.sk-arch__search {\n  flex: 1 1 auto;\n  min-width: 0;\n  height: 38px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 0 12px;\n  border-radius: var(--dsw-radius-md);\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.sk-arch__search input {\n  flex: 1 1 auto;\n  min-width: 0;\n  border: 0;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n  outline: none;\n}\n\n.sk-arch__search input::placeholder {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.sk-arch__select {\n  height: 38px;\n  padding: 0 10px;\n  border-radius: var(--dsw-radius-md);\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n  cursor: pointer;\n}\n\n.sk-arch__group {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.sk-arch__groupHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.sk-arch__icon {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.sk-arch__groupTitle {\n  font-weight: 500;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.sk-arch__groupCount {\n  margin-left: auto;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.sk-arch__row {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 12px 14px;\n  border-radius: var(--dsw-radius-md);\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.sk-arch__rowMain {\n  flex: 1 1 auto;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n\n.sk-arch__rowTitle {\n  font-size: 13.5px;\n  font-weight: 500;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.sk-arch__rowTime {\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.sk-arch__btn {\n  height: 30px;\n  padding: 0 10px;\n  border-radius: var(--dsw-radius-sm);\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 12.5px;\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.sk-arch__btn:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.sk-arch__empty {\n  padding: 28px 0 8px;\n  text-align: center;\n}\n\n.sk-arch__emptyTitle {\n  margin: 0;\n  font-size: 13px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.sk-arch__emptyHint {\n  margin: 6px 0 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* 已归档的聊天：不可恢复的归档记录补充说明 */\n.sk-arch__note {\n  margin: 18px 0 0;\n  font-size: 12px;\n  line-height: 1.6;\n  color: var(--dsw-alias-label-caption);\n}\n\n/* 删除按钮：危险动作用警示色，但只染文字，不染底色 —— 这一页不是主操作面。 */\n.sk-arch__btn--danger {\n  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-secondary));\n}\n\n.sk-arch__btn--danger:hover:not(:disabled) {\n  background: var(--dsw-alias-state-error-primary-muted, var(--dsw-alias-interactive-bg-hover));\n}\n\n.sk-arch__note--error {\n  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-secondary));\n}\n";
function installStylesheet() {
  const tag = document.createElement("style");
  tag.dataset.plugin = PKG;
  tag.dataset.pluginCss = PKG + "/styles.css";
  tag.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(tag);
  return {
    tag,
    dispose() {
      tag.remove();
    }
  };
}
const DESKTOP_MARK = "data-sk-desktop";
function isDarwinDesktop() {
  return document.documentElement.getAttribute("data-platform") === "darwin";
}
function isDesktopShell() {
  const root = document.documentElement;
  return isDarwinDesktop() || root.hasAttribute("data-windows-titlebar");
}
function installDesktopMarker() {
  const root = document.documentElement;
  const sync = () => {
    if (isDesktopShell()) {
      if (!root.hasAttribute(DESKTOP_MARK)) root.setAttribute(DESKTOP_MARK, "");
    } else if (root.hasAttribute(DESKTOP_MARK)) {
      root.removeAttribute(DESKTOP_MARK);
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-platform", "data-windows-titlebar"]
  });
  sync();
  return () => {
    observer.disconnect();
    root.removeAttribute(DESKTOP_MARK);
  };
}
const RAIL_ROW = '[data-slot="sidebar"] > [class*="_root"] [class*="_panelRow"]';
function installRailTitles() {
  let queued = 0;
  const pass = () => {
    queued = 0;
    for (const row of document.querySelectorAll(RAIL_ROW)) {
      const label = row.querySelector('[class*="_panelTitle"]');
      const text = label?.textContent?.trim();
      if (text && row.getAttribute("title") !== text) row.setAttribute("title", text);
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  pass();
  return () => {
    observer.disconnect();
    if (queued) cancelAnimationFrame(queued);
  };
}
const HOUSE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.8 8 2.2l6 4.6V13a.9.9 0 0 1-.9.9H2.9A.9.9 0 0 1 2 13V6.8Z"/><path d="M6.2 13.9V9.2h3.6v4.7"/></svg>';
const RAIL_LIST = '[data-slot="sidebar"] > [class*="_root"] [class*="_panelList"]';
function installHomeRail(ctx) {
  let queued = 0;
  let home = null;
  let offPanel = null;
  const label = () => (document.documentElement.lang || "").toLowerCase().startsWith("zh") ? "工作区" : "Workspace";
  const isHomeActive = () => {
    const info2 = ctx.layout?.panelInfo;
    try {
      return info2 ? info2.getSnapshot()?.activePanelId == null : false;
    } catch {
      return false;
    }
  };
  const sync = () => {
    if (!home) return;
    home.dataset.active = isHomeActive() ? "true" : "false";
  };
  const onClick = (event) => {
    event.preventDefault();
    try {
      ctx.layout?.selectPanel(null);
    } catch {
    }
    sync();
  };
  const ensure = () => {
    const list = document.querySelector(RAIL_LIST);
    if (!list) return;
    if (home?.isConnected) return;
    if (!home) {
      home = document.createElement("button");
      home.type = "button";
      home.className = "sk-home";
      home.dataset.skHome = "";
      home.innerHTML = '<span class="sk-home__glyph">' + HOUSE_SVG + "</span>";
      home.addEventListener("click", onClick);
    }
    home.setAttribute("aria-label", label());
    home.setAttribute("title", label());
    list.prepend(home);
    sync();
  };
  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      ensure();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  const info = ctx.layout?.panelInfo;
  if (info && typeof info.subscribe === "function") offPanel = info.subscribe(sync);
  ensure();
  return () => {
    observer.disconnect();
    if (queued) cancelAnimationFrame(queued);
    if (typeof offPanel === "function") offPanel();
    if (home) {
      home.removeEventListener("click", onClick);
      home.remove();
      home = null;
    }
  };
}
const TITLE_ROW = '[data-slot="main.conversation"] [class*="_titleRow"]';
function installBandHeight() {
  let queued = 0;
  const pass = () => {
    queued = 0;
    if (!isDarwinDesktop()) return;
    const row = document.querySelector(TITLE_ROW) ?? document.querySelector('[class*="_header"] [class*="_titleRow"]');
    if (!row) return;
    const bottom = Math.round(row.getBoundingClientRect().bottom);
    if (bottom <= 0) return;
    const next = bottom + "px";
    if (document.body.style.getPropertyValue("--cx-band-h") !== next) {
      document.body.style.setProperty("--cx-band-h", next);
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", schedule);
  pass();
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    if (queued) cancelAnimationFrame(queued);
    document.body.style.removeProperty("--cx-band-h");
  };
}
const SIDEBAR_W = "296px";
const RAIL_W = "52px";
let frameEl = null;
let workspaceCollapsed = false;
let widthPass = null;
let collapseSync = null;
function isHomeView(ctx) {
  try {
    const info = ctx.layout?.panelInfo;
    return info ? info.getSnapshot()?.activePanelId == null : true;
  } catch {
    return true;
  }
}
function findFrame() {
  if (frameEl && frameEl.isConnected) return frameEl;
  frameEl = [...document.querySelectorAll('[class*="_frame"]')].find(
    (el) => el.style?.gridTemplateColumns?.includes("minmax(")
  ) ?? null;
  return frameEl;
}
function installSidebarWidth(ctx) {
  let queued = 0;
  let offPanel = null;
  const pass = () => {
    queued = 0;
    if (!isDesktopShell()) return;
    const frame = findFrame();
    if (!frame) return;
    const cols = frame.style.gridTemplateColumns;
    if (!cols) return;
    const collapsed = frame.hasAttribute("data-sidebar-collapsed");
    const home = isHomeView(ctx);
    const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
    if (root) {
      const railOnly = !collapsed && (!home || workspaceCollapsed);
      if (railOnly && !root.hasAttribute("data-sk-rail-only")) {
        root.setAttribute("data-sk-rail-only", "");
      } else if (!railOnly && root.hasAttribute("data-sk-rail-only")) {
        root.removeAttribute("data-sk-rail-only");
      }
    }
    const target = collapsed ? "0px" : home && !workspaceCollapsed ? SIDEBAR_W : RAIL_W;
    const next = cols.replace(/^[\d.]+px/, target);
    if (next !== cols) frame.style.gridTemplateColumns = next;
    collapseSync?.();
  };
  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };
  widthPass = pass;
  const observer = new MutationObserver((mutations) => {
    const frameRewritten = mutations.some(
      (m) => m.type === "attributes" && m.attributeName === "style" && m.target === frameEl
    );
    if (frameRewritten) pass();
    else schedule();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "data-sidebar-collapsed"]
  });
  const platformObserver = new MutationObserver(schedule);
  platformObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-platform", "data-windows-titlebar"]
  });
  window.addEventListener("resize", schedule);
  const info = ctx.layout?.panelInfo;
  if (info && typeof info.subscribe === "function") offPanel = info.subscribe(schedule);
  pass();
  return () => {
    observer.disconnect();
    platformObserver.disconnect();
    window.removeEventListener("resize", schedule);
    if (typeof offPanel === "function") offPanel();
    if (queued) cancelAnimationFrame(queued);
    frameEl = null;
  };
}
function installWorkspaceCollapse(ctx) {
  const isToggleButton = (btn) => [...btn.classList].some((name) => name.includes("_toggle"));
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "sk-collapse-hit";
  hit.setAttribute("aria-label", "收起侧边栏");
  hit.title = "收起侧边栏";
  document.body.appendChild(hit);
  const sync = () => {
    const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
    const frame = findFrame();
    const collapsed = !!frame && frame.hasAttribute("data-sidebar-collapsed");
    const railOnly = !!root && root.hasAttribute("data-sk-rail-only");
    hit.toggleAttribute("data-show", railOnly && !collapsed);
  };
  collapseSync = sync;
  let wasCollapsed = false;
  const stateObserver = new MutationObserver(() => {
    const frame = findFrame();
    const collapsed = !!frame && frame.hasAttribute("data-sidebar-collapsed");
    if (wasCollapsed && !collapsed && workspaceCollapsed) {
      workspaceCollapsed = false;
      widthPass?.();
    }
    wasCollapsed = collapsed;
  });
  stateObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-sidebar-collapsed"],
    subtree: true
  });
  const onClick = (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const btn = el.closest("button");
    if (!btn) return;
    const frame = findFrame();
    if (!frame) return;
    const collapsed = frame.hasAttribute("data-sidebar-collapsed");
    if (btn === hit) {
      event.preventDefault();
      event.stopPropagation();
      ctx.layout?.toggleSidebar?.();
      return;
    }
    if (btn.classList.contains("sk-home")) {
      if (workspaceCollapsed) {
        workspaceCollapsed = false;
        widthPass?.();
      }
      return;
    }
    if (!collapsed && !workspaceCollapsed && isHomeView(ctx) && isToggleButton(btn)) {
      event.preventDefault();
      event.stopPropagation();
      workspaceCollapsed = true;
      widthPass?.();
    }
  };
  document.addEventListener("click", onClick, true);
  sync();
  return () => {
    document.removeEventListener("click", onClick, true);
    stateObserver.disconnect();
    collapseSync = null;
    hit.remove();
  };
}
const ARCH_NS = "shell-kit.archived";
const ARCH_COPY = {
  zh: {
    nav: "已归档的聊天",
    title: "已归档的聊天",
    search: "搜索已归档的聊天",
    allProjects: "所有项目",
    project: "项目",
    restoreAll: "全部取消归档",
    restore: "取消归档",
    remove: "删除",
    confirmRemove: "确定要永久删除这条会话吗？\n\n「{t}」的聊天记录会从磁盘移入回收站（dsh-delete-session-trash），无法在应用里恢复。",
    removeFailed: "删除失败：{reason}",
    removeHint: "删除会把会话目录移进 ~/.dsh/dsh-delete-session-trash，列表里立刻消失；归档标记的残留在下次启动后被自动忽略。",
    chats: "个聊天",
    empty: "还没有归档的会话",
    emptyHint: "在侧栏会话的「…」菜单里选「归档」，它就会出现在这里。",
    noMatch: "没有匹配的归档会话",
    ungrouped: "未分组",
    confirmRestoreAll: "恢复全部 {n} 个归档会话？",
    done: "已恢复 {n} 个会话",
    untitled: "无标题会话",
    unlisted: "另有 {n} 条归档记录没有可显示的会话数据（所属工作区已不存在），无法在这里恢复。"
  },
  en: {
    nav: "Archived chats",
    title: "Archived chats",
    search: "Search archived chats",
    allProjects: "All projects",
    project: "Project",
    restoreAll: "Unarchive all",
    restore: "Unarchive",
    remove: "Delete",
    confirmRemove: 'Permanently delete this chat?\n\n"{t}" will be moved to the trash folder (dsh-delete-session-trash); it cannot be restored from the app.',
    removeFailed: "Delete failed: {reason}",
    removeHint: "Delete moves the chat folder into ~/.dsh/dsh-delete-session-trash. The row disappears right away; the leftover archive marker is ignored on next launch.",
    chats: "chats",
    empty: "No archived chats yet",
    emptyHint: "Pick “Archive” from a session’s “…” menu in the sidebar and it shows up here.",
    noMatch: "No archived chats match",
    ungrouped: "Ungrouped",
    confirmRestoreAll: "Unarchive all {n} archived chats?",
    done: "Restored {n} chats",
    untitled: "Untitled chat",
    unlisted: "{n} more archived records have no session data left (their workspace is gone), so they cannot be restored here."
  }
};
function archivedRowTitle(summary) {
  const title = typeof summary?.title === "string" ? summary.title.trim() : "";
  if (title !== "") return title;
  const display = typeof summary?.displayTitle === "string" ? summary.displayTitle.trim() : "";
  return display;
}
function readArchived(ctx) {
  const sessions = ctx.sessions?.list?.getSnapshot?.() ?? {};
  const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? {};
  const byId = sessions.byId ?? {};
  const items = Array.isArray(workspaces.items) ? workspaces.items : [];
  const archived = new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : []);
  const workspaceByPath = /* @__PURE__ */ new Map();
  for (const workspace of items) {
    const path = typeof workspace.path === "string" ? workspace.path : "";
    if (path && !workspaceByPath.has(path)) workspaceByPath.set(path, workspace);
  }
  const workspaceKey = (workspace) => workspace?.workspaceId ?? workspace?.id ?? "";
  const workspaceOf = /* @__PURE__ */ new Map();
  for (const workspace of items) {
    for (const sessionId of workspace.sessionIds ?? []) {
      if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, workspace);
    }
  }
  const groupOf = (id) => {
    const byMember = workspaceOf.get(id);
    if (byMember) return byMember;
    const cwd = byId[id]?.cwd;
    return typeof cwd === "string" ? workspaceByPath.get(cwd) : void 0;
  };
  const toRow = (id) => {
    const summary = byId[id];
    const workspace = groupOf(id);
    return {
      id,
      title: archivedRowTitle(summary),
      updatedAt: summary?.updatedAt ?? 0,
      workspaceId: workspaceKey(workspace)
    };
  };
  const byRecency = (a, b) => b.updatedAt - a.updatedAt;
  const buckets = /* @__PURE__ */ new Map();
  for (const id of archived) {
    const summary = byId[id];
    if (summary === void 0) continue;
    if (summary.origin === "subagent") continue;
    const workspace = groupOf(id);
    const key = workspace ? workspaceKey(workspace) : "__ungrouped";
    if (!buckets.has(key)) {
      buckets.set(key, { id: key, title: workspace?.title ?? workspace?.path ?? "", rows: [] });
    }
    buckets.get(key).rows.push(toRow(id));
  }
  const groups = [];
  for (const workspace of items) {
    const key = workspaceKey(workspace);
    const bucket = buckets.get(key);
    if (!bucket || bucket.rows.length === 0) continue;
    groups.push({ ...bucket, rows: bucket.rows.sort(byRecency) });
    buckets.delete(key);
  }
  const ungrouped = buckets.get("__ungrouped");
  if (ungrouped && ungrouped.rows.length > 0) {
    groups.push({ id: "__ungrouped", title: "", rows: ungrouped.rows.sort(byRecency) });
  }
  const total = groups.reduce((n, group) => n + group.rows.length, 0);
  return { groups, total, unlisted: Math.max(0, archived.size - total) };
}
function ArchivedFolderIcon() {
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      className: "sk-arch__icon",
      width: 16,
      height: 16,
      viewBox: "0 0 16 16",
      fill: "none",
      strokeWidth: 1,
      "aria-hidden": "true"
    },
    /* @__PURE__ */ React.createElement(
      "path",
      {
        d: "M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z",
        stroke: "currentColor"
      }
    ),
    /* @__PURE__ */ React.createElement("path", { d: "M3.63501 7.66614H12.3647", stroke: "currentColor" })
  );
}
function ArchivedSearchIcon() {
  return /* @__PURE__ */ React.createElement("svg", { width: 15, height: 15, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("circle", { cx: 7, cy: 7, r: 4.5, stroke: "currentColor", strokeWidth: 1 }), /* @__PURE__ */ React.createElement("path", { d: "M10.6 10.6L14 14", stroke: "currentColor", strokeWidth: 1 }));
}
function deleteEndpoint() {
  const host = typeof window === "undefined" ? null : window.__SK_HOST;
  if (!host || typeof host.deleteUrl !== "string" || typeof host.token !== "string") return null;
  return host;
}
async function removeSessionViaHost(sessionId) {
  const host = deleteEndpoint();
  if (host === null) return { ok: false, reason: "no-endpoint" };
  try {
    const response = await fetch(`${host.deleteUrl}/delete-session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sk-token": host.token },
      body: JSON.stringify({ sessionId })
    });
    return await response.json();
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}
function createArchivedSection(ctx) {
  const timeFormat = new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" });
  return function ArchivedChatsSection() {
    const t = ctx.locale.bind(ARCH_NS);
    const [, bump] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const [project, setProject] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [hidden, setHidden] = React.useState(() => /* @__PURE__ */ new Set());
    const [notice, setNotice] = React.useState("");
    const canRemove = deleteEndpoint() !== null;
    React.useEffect(() => {
      const rerender = () => bump((n) => n + 1);
      const offs = [];
      try {
        offs.push(ctx.sessions.list.subscribe(rerender));
      } catch {
      }
      try {
        offs.push(ctx.workspaces.list.subscribe(rerender));
      } catch {
      }
      return () => {
        for (const off of offs) {
          try {
            off();
          } catch {
          }
        }
      };
    }, []);
    const { groups, total, unlisted } = readArchived(ctx);
    const projects = groups.filter((group) => group.id !== "__ungrouped");
    const needle = query.trim().toLowerCase();
    const visible = groups.filter((group) => project === "" || group.id === project).map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        if (hidden.has(row.id)) return false;
        if (needle === "") return true;
        return (row.title || "").toLowerCase().includes(needle) || group.title.toLowerCase().includes(needle);
      })
    })).filter((group) => group.rows.length > 0);
    const shown = visible.reduce((n, group) => n + group.rows.length, 0);
    const remove = async (row) => {
      const ask = t("confirmRemove").replace("{t}", row.title || t("untitled"));
      if (typeof window !== "undefined" && !window.confirm(ask)) return;
      setBusy(true);
      setNotice("");
      try {
        const result = await removeSessionViaHost(row.id);
        if (result?.ok === true) {
          setHidden((prev) => new Set(prev).add(row.id));
        } else {
          setNotice(t("removeFailed").replace("{reason}", result?.reason ?? "unknown"));
        }
      } finally {
        setBusy(false);
      }
    };
    const restore = async (id) => {
      setBusy(true);
      try {
        await ctx.workspaces.unarchiveSession(id);
      } finally {
        setBusy(false);
      }
    };
    const restoreAll = async () => {
      const ids = visible.flatMap((group) => group.rows.map((row) => row.id));
      if (ids.length === 0) return;
      const ask = t("confirmRestoreAll").replace("{n}", String(ids.length));
      if (typeof window !== "undefined" && !window.confirm(ask)) return;
      setBusy(true);
      try {
        for (const id of ids) await ctx.workspaces.unarchiveSession(id);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "sk-arch" }, /* @__PURE__ */ React.createElement("div", { className: "sk-arch__head" }, /* @__PURE__ */ React.createElement("h2", { className: "sk-arch__title" }, t("title")), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "sk-arch__action",
        disabled: busy || shown === 0,
        onClick: restoreAll
      },
      t("restoreAll")
    )), /* @__PURE__ */ React.createElement("div", { className: "sk-arch__bar" }, /* @__PURE__ */ React.createElement("div", { className: "sk-arch__search" }, /* @__PURE__ */ React.createElement(ArchivedSearchIcon, null), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "search",
        value: query,
        placeholder: t("search"),
        "aria-label": t("search"),
        onChange: (event) => setQuery(event.target.value)
      }
    )), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "sk-arch__select",
        value: project,
        "aria-label": t("project"),
        onChange: (event) => setProject(event.target.value)
      },
      /* @__PURE__ */ React.createElement("option", { value: "" }, t("allProjects")),
      projects.map((group) => /* @__PURE__ */ React.createElement("option", { value: group.id, key: group.id }, group.title))
    )), visible.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "sk-arch__empty" }, /* @__PURE__ */ React.createElement("p", { className: "sk-arch__emptyTitle" }, total === 0 ? t("empty") : t("noMatch")), total === 0 ? /* @__PURE__ */ React.createElement("p", { className: "sk-arch__emptyHint" }, t("emptyHint")) : null) : visible.map((group) => /* @__PURE__ */ React.createElement("section", { className: "sk-arch__group", key: group.id }, /* @__PURE__ */ React.createElement("div", { className: "sk-arch__groupHead" }, /* @__PURE__ */ React.createElement(ArchivedFolderIcon, null), /* @__PURE__ */ React.createElement("span", { className: "sk-arch__groupTitle" }, group.title || t("ungrouped")), /* @__PURE__ */ React.createElement("span", { className: "sk-arch__groupCount" }, `${group.rows.length} ${t("chats")}`)), group.rows.map((row) => /* @__PURE__ */ React.createElement("div", { className: "sk-arch__row", key: row.id }, /* @__PURE__ */ React.createElement("div", { className: "sk-arch__rowMain" }, /* @__PURE__ */ React.createElement("span", { className: "sk-arch__rowTitle", title: row.title || t("untitled") }, row.title || t("untitled")), /* @__PURE__ */ React.createElement("span", { className: "sk-arch__rowTime" }, row.updatedAt > 0 ? timeFormat.format(new Date(row.updatedAt)) : "")), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "sk-arch__btn",
        disabled: busy,
        onClick: () => restore(row.id)
      },
      t("restore")
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "sk-arch__btn sk-arch__btn--danger",
        disabled: busy || !canRemove,
        title: canRemove ? void 0 : t("removeFailed").replace("{reason}", "no-endpoint"),
        onClick: () => remove(row)
      },
      t("remove")
    ))))), notice !== "" ? /* @__PURE__ */ React.createElement("p", { className: "sk-arch__note sk-arch__note--error" }, notice) : null, canRemove ? /* @__PURE__ */ React.createElement("p", { className: "sk-arch__note" }, t("removeHint")) : null, unlisted > 0 ? /* @__PURE__ */ React.createElement("p", { className: "sk-arch__note" }, t("unlisted").replace("{n}", String(unlisted))) : null);
  };
}
function installArchivedSection(ctx) {
  const t = ctx.locale.bind(ARCH_NS);
  return ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "archived-chats",
        order: 20,
        label: () => t("nav"),
        locale: ARCH_NS
      },
      createArchivedSection(ctx)
    )
  );
}
function apply(ctx) {
  ctx.effect(installDesktopMarker, "dsh-shell-kit:desktop-marker");
  ctx.effect(() => {
    const sheet = installStylesheet();
    return sheet.dispose;
  }, "dsh-shell-kit:stylesheet");
  ctx.effect(installRailTitles, "dsh-shell-kit:rail-titles");
  ctx.effect(() => installHomeRail(ctx), "dsh-shell-kit:home-rail");
  ctx.effect(installBandHeight, "dsh-shell-kit:band-height");
  ctx.effect(() => installSidebarWidth(ctx), "dsh-shell-kit:sidebar-width");
  ctx.effect(() => installWorkspaceCollapse(ctx), "dsh-shell-kit:workspace-collapse");
  ctx.effect(() => ctx.locale.register(ARCH_NS, ARCH_COPY), "dsh-shell-kit:archived-dict");
  ctx.effect(() => installArchivedSection(ctx), "dsh-shell-kit:archived-section");
}
window.__ModuleLoader__.load({
  id: PKG,
  factory: (require2) => {
    React = require2("react");
    const exports = {};
    exports.apply = apply;
    exports.inject = ["slots", "layout", "locale", "sessions", "workspaces"];
    return exports;
  }
});
