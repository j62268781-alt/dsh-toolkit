/**
 * dsh-shell-kit — Client 半个插件。
 *
 * 职责只有一件事：把 `styles.css` 注入成页面里的一个 `<style>` 标签。
 *
 * ── 为什么是这个形状 ────────────────────────────────────────────────────
 *
 * DSH 的客户端插件不是普通 npm 包：它是**经典脚本**（不是 ESM），由页面的
 * `__ModuleLoader__` 加载，`require` 由宿主注入（只能拿宿主给的模块 id，
 * 不能相对路径、不能打包自己的依赖）。所以这个文件必须是单文件、无 import，
 * 并且用 `window.__ModuleLoader__.load({ id, factory })` 注册自己。
 *
 * DSH 自己的每个客户端包（例如 ui-layout、ui-sidebar）都是这么注入样式的：
 * 建 `<style>`、打 `data-plugin` / `data-plugin-css` 标记、塞进 `<head>`。
 * 这里照抄同一套通道，好处是：
 *   · 样式标签按 document order 生效，后注入的自然压过先注入的；
 *   · `data-plugin` 让我们能被 devtools 一眼认出来；
 *   · 卸载时按引用删掉，不留残渣。
 *
 * `ctx.effect(fn, label)` 是 cordis 的生命周期钩子：fn 里拿到的东西在插件
 * 被卸载 / HMR 替换时会走 fn 返回的 disposer。把注入放进 effect 里，热更新
 * 才不会叠出第二份样式表。
 */

/** 包名：与 package.json 的 name 一致，用来标记 `<style>` 标签。 */
const PKG = "dsh-shell-kit";

/** 宿主在 factory 里注入的 React；模块级函数靠它建元素。 */
let React = null;

/** 构建时由 scripts/build-client.mjs 把 styles.css 完整内联到这里。 */
const CSS = __CLIENT_CSS__;

/**
 * 把样式表挂到 `<head>`。
 *
 * @returns {{tag: HTMLStyleElement, dispose: () => void}}
 */
function installStylesheet() {
  const tag = document.createElement("style");
  tag.dataset.plugin = PKG;
  tag.dataset.pluginCss = PKG + "/styles.css";
  tag.textContent = CSS;
  // 正常情况 <head> 一定在；留个兜底，避免极端加载顺序下 appendChild 抛错
  (document.head ?? document.documentElement).appendChild(tag);
  return {
    tag,
    dispose() {
      tag.remove();
    },
  };
}

/**
 * 图标栏只剩 glyph，鼠标悬停看不到名字。
 *
 * SidebarRoot 是 React 渲染的，我们不改它的结构 —— 只是把标题文字同步成
 * `title` 属性，让浏览器给原生 tooltip。用 requestAnimationFrame 去抖：
 * 流式输出时 DOM 变更极密集，每个 mutation 都跑一次查询不值当。
 */
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

/**
 * rail 最上面的「工作区」入口（home 图标）。
 *
 * 为什么不是注册一个 `sidebar.panellist` 行：那一行点击恒为
 * `ctx.layout.selectPanel(id)`（ui-sidebar 的 PanelRow 里写死），而「工作区 +
 * 会话」不是面板 —— 它是 `activePanelId === null` 的默认态，没有 id 可选。
 * 所以这个入口只能在 DOM 上补：自己建一个按钮插进面板列表的最前面，点击时走
 * 官方入口 `ctx.layout.selectPanel(null)`（LayoutController 的注释原话就是
 * "Select a global panel or return to the Conversation"）。
 *
 * 两件事要自己维护：
 *   · 选中态 —— 订阅 `ctx.layout.panelInfo`，`activePanelId === null` 时点亮；
 *   · 存活 —— 面板列表是 React 渲染的，重渲染可能把我们插的节点删掉，
 *     用 MutationObserver 观察并补回（和 rail tooltip 同一套办法）。
 */
const HOUSE_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2 6.8 8 2.2l6 4.6V13a.9.9 0 0 1-.9.9H2.9A.9.9 0 0 1 2 13V6.8Z"/>' +
  '<path d="M6.2 13.9V9.2h3.6v4.7"/></svg>';

const RAIL_LIST = '[data-slot="sidebar"] > [class*="_root"] [class*="_panelList"]';

function installHomeRail(ctx) {
  let queued = 0;
  let home = null;
  let offPanel = null;

  const label = () =>
    (document.documentElement.lang || "").toLowerCase().startsWith("zh") ? "工作区" : "Workspace";

  const isHomeActive = () => {
    const info = ctx.layout?.panelInfo;
    try {
      return info ? info.getSnapshot()?.activePanelId == null : false;
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
      // 面板服务没就绪时忽略：下一次 subscribe 会再对齐一次选中态
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

/**
 * 标题栏带的高度**不写死**，而是量出来。
 *
 * macOS 上顶部那条色带的高度应该等于「会话标题行 + 上下等内边距」——
 * 也就是标题行的下边缘。CSS 里 `--cx-band-h` 有个兜底值，这里在运行时用
 * 真实 DOM 的 `getBoundingClientRect().bottom` 回写：DSH 以后改了页头的
 * 内边距、字号、图标高度，色带跟着变，不用改样式表里的魔数。
 *
 * 为什么不是纯 CSS：色带要同时画在侧栏列、中央列、右列上，三列都不知道
 * 页头里标题行的实际高度；`calc()` 也读不到兄弟元素的行高。
 */
const TITLE_ROW = '[data-slot="main.conversation"] [class*="_titleRow"]';

function installBandHeight() {
  let queued = 0;

  const pass = () => {
    queued = 0;
    // 只有 macOS 桌面端才有这条通栏；网页端 / Windows 不动
    if (document.documentElement.getAttribute("data-platform") !== "darwin") return;
    const row =
      document.querySelector(TITLE_ROW) ??
      document.querySelector('[class*="_header"] [class*="_titleRow"]');
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

  // 会话切换 / 标题换行 / 窗口缩放都会改标题行高度

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

/**
 * 侧栏列宽锁死：52（rail）+ 240（面板）+ 4（右缝）= 296px。
 *
 * 面板宽度本来是 DSH 的「用户偏好」：默认 280px、可拖 264–420，存在布局设置
 * 里。`ctx.layout` 只暴露 `selectPanel / toggleSidebar / openRightbar /
 * closeRightbar`，**没有 setSidebar**，改不了这个偏好；而 frame 的
 * `grid-template-columns` 是 React 内联 style（`${sidebar}px minmax(...)
 * minmax(...)`），样式表压不过（除非 `!important`）。
 *
 * 所以这里退一步：监听 frame 的 style 属性，只要 React 把第一条栅格轨写回
 * 280px，我们就按「当前视图」把它改写成目标值。写完之后值与目标相同就不再
 * 写，观察器自然收敛，不会自己触发自己。侧栏收起时（`data-sidebar-collapsed`）
 * 保持 0px，把「收起」原样交还给 DSH。
 *
 * 目标值分两档（用户要的行为：点房子才显示工作区列，点其它图标时让位）：
 *   · home 视图（activePanelId === null）→ 296px（52 rail + 240 面板 + 4 缝）；
 *   · 面板视图（插件 / 自动化任务 / …） → 52px（= rail 本身；**不留 4px 缝**：
 *     缝和 rail 同色，留了视觉上等于 rail 变宽 4px、图标整体右偏 2px，正是
 *     用户拍的「切页面后左栏变宽了」），同时在侧栏
 *     root 上打 `data-sk-rail-only`，CSS 里把品牌行、新会话、工作区列一起隐藏。
 */
const SIDEBAR_W = "296px";
const RAIL_W = "52px";
let frameEl = null;

/* 「只收工作区」：用户点原生折叠钮时，我们先把侧栏收到 52px 的纯图标栏，
 * 再点一次才真正收掉（0px）。这是插件自己的状态，不改 DSH 的 collapsed 语义。 */
let workspaceCollapsed = false;
/* installSidebarWidth 里那个重算函数，供「收工作区」的点击处理器调用。 */
let widthPass = null;
/* 点击热区的显隐同步（由 installSidebarWidth 每次重算后调用）。 */
let collapseSync = null;

/* 「工作区 + 会话」= activePanelId 为 null；取不到服务时按 home 处理 */
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
  // AppFrame 是唯一一个把三条栅格轨写在行内 style 里的元素
  frameEl =
    [...document.querySelectorAll('[class*="_frame"]')].find((el) =>
      el.style?.gridTemplateColumns?.includes("minmax("),
    ) ?? null;
  return frameEl;
}

function installSidebarWidth(ctx) {
  let queued = 0;
  let offPanel = null;

  const pass = () => {
    queued = 0;
    if (document.documentElement.getAttribute("data-platform") !== "darwin") return;
    const frame = findFrame();
    if (!frame) return;
    const cols = frame.style.gridTemplateColumns;
    if (!cols) return;

    const collapsed = frame.hasAttribute("data-sidebar-collapsed");
    const home = isHomeView(ctx);
    const root = document.querySelector('[data-slot="sidebar"] > [class*="_root"]');
    if (root) {
      // 面板视图本来就只有 rail；home 视图被用户「收工作区」后也是同一套 rail-only 样式
      const railOnly = !collapsed && (!home || workspaceCollapsed);
      if (railOnly && !root.hasAttribute("data-sk-rail-only")) {
        root.setAttribute("data-sk-rail-only", "");
      } else if (!railOnly && root.hasAttribute("data-sk-rail-only")) {
        root.removeAttribute("data-sk-rail-only");
      }
    }

    const target = collapsed
      ? "0px"
      : home && !workspaceCollapsed
        ? SIDEBAR_W
        : RAIL_W;
    const next = cols.replace(/^[\d.]+px/, target);
    if (next !== cols) frame.style.gridTemplateColumns = next;
    collapseSync?.();
  };

  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };

  widthPass = pass;

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "data-sidebar-collapsed"],
  });
  // 平台标记是桌面壳在 <html> 上打的；窗口缩放也会让 DSH 重算列宽
  const platformObserver = new MutationObserver(schedule);
  platformObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-platform"],
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

/**
 * 「收起侧边栏」= 先收工作区（52px 纯图标栏），再点一次才真正收掉。
 *
 * DSH 的折叠是「整根侧栏收掉」：首轨 0px，同时 SidebarRoot 切成 `_c` 变体，
 * `_panelList` / `_regionArea` / `_logoRow` 全部宽度 0 —— 连 rail 一起消失。
 * 所以我们不去改它的折叠语义，而是在**它折叠之前**拦一次点击：
 *
 *   · home 视图、已展开（296px）→ 拦下原生折叠钮的点击，改走「只收工作区」：
 *     首轨写 52px，rail 保留可点（复用下面这套 rail-only 样式）；
 *   · 已经是 52px → 放行，让 DSH 真正折叠到 0px；
 *   · 从 0px 用原生展开钮回来 → collapsed=false，`workspaceCollapsed` 仍是 true，
 *     于是回到 52px（回到折叠前的形态）；
 *   · 在 52px 时点 home 图标 → 取消「只收工作区」，回到 296px。
 *
 * 局限：⌘\ 之类的快捷键绕不过 DOM 点击，仍会直接收掉整根侧栏；状态也不持久化，
 * 重启回到「展开 + 未收工作区」。
 */
function installWorkspaceCollapse(ctx) {
  const COLLAPSE_LABEL = /收起侧边栏|Collapse sidebar/i;

  // rail-only 时原生折叠钮在 [88,11]，视觉可见但落在主区标题行下面（点击被吃掉），
  // 所以在这个坐标放一个体级透明热区，把点击接过来。
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

  const onClick = (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const btn = el.closest("button");
    if (!btn) return;

    const frame = findFrame();
    if (!frame) return;
    const collapsed = frame.hasAttribute("data-sidebar-collapsed");

    // 0) 热区：rail-only 下点折叠钮 → 真正收掉（交给 DSH）
    if (btn === hit) {
      event.preventDefault();
      event.stopPropagation();
      ctx.layout?.toggleSidebar?.();
      return;
    }

    // 1) 在「只收工作区」状态下点 home 图标 → 展开工作区
    if (btn.classList.contains("sk-home")) {
      if (workspaceCollapsed) {
        workspaceCollapsed = false;
        widthPass?.();
      }
      return;
    }

    // 2) home 视图、还没收过 → 拦下原生折叠钮，只收工作区
    const label = (btn.getAttribute("aria-label") || "").trim();
    if (!collapsed && !workspaceCollapsed && isHomeView(ctx) && COLLAPSE_LABEL.test(label)) {
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
    collapseSync = null;
    hit.remove();
  };
}

/**
 * 插件入口。
 *
 * 不 `inject` 任何服务：皮肤只碰 DOM 与 CSS 变量，不调 slots、不调 theme。
 * （令牌是直接写在样式表里的 —— 内置主题的 tokens 是空对象，没有内联 style
 * 需要去压，所以不需要 `ctx.theme.overrideTokens`。哪天用户装了会注册
 * override 的第三方主题，再改成 overrideTokens 也不迟，见 README。）
 *
 * @param {import("cordis").Context} ctx - Client 侧 cordis 上下文。
 */
/* ══════════════════════════════════════════════════════════════════════
 * 设置页：已归档的聊天
 *
 * DSH 本身有归档能力（侧栏会话菜单里的「归档」），但归档后的会话只能靠
 * 侧栏那个三态筛选（隐藏归档 / 全部会话 / 仅归档）去看，没有一个专门的管理页。
 * 这个 section 补上那一页：按项目分组列出归档会话，可搜索、可按项目过滤、
 * 可单条或批量恢复。
 *
 * 数据全部来自 Client 已有的两个服务，不新增 Host 接口：
 *   ctx.sessions.list      → { byId, ids }       每个会话的标题 / 更新时间 / blank
 *   ctx.workspaces.list    → { items, archivedSessionIds, pinnedSessionIds }
 *                            items[].sessionIds 就是成员关系，archived 是会话 id 数组
 * 恢复走 ctx.workspaces.unarchiveSession(id)（Host 侧的同一份归档集）。
 *
 * 页面注册进 ui-settings 声明的 `settings.section` 槽位（与「内置插件」「模型」
 * 等设置页同级），order 20 排在内置插件(15) 之后、Agent 循环(30) 之前。
 * ══════════════════════════════════════════════════════════════════════ */

/** locale 命名空间。 */
const ARCH_NS = "shell-kit.archived";

/** 词典。 */
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
    unlisted: "另有 {n} 条归档记录没有可显示的会话数据（所属工作区已不存在），无法在这里恢复。",
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
    confirmRemove: "Permanently delete this chat?\n\n\"{t}\" will be moved to the trash folder (dsh-delete-session-trash); it cannot be restored from the app.",
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
    unlisted: "{n} more archived records have no session data left (their workspace is gone), so they cannot be restored here.",
  },
};

/** 会话行标题：Host 还没生成标题时用占位。 */
function archivedRowTitle(summary) {
  const title = typeof summary?.title === "string" ? summary.title.trim() : "";
  if (title !== "") return title;
  const display = typeof summary?.displayTitle === "string" ? summary.displayTitle.trim() : "";
  return display;
}

/**
 * 把两个服务快照拼成「按项目分组」的归档列表。
 *
 * @returns {{groups: Array<{id: string, title: string, rows: Array<object>}>, total: number}}
 */
function readArchived(ctx) {
  const sessions = ctx.sessions?.list?.getSnapshot?.() ?? {};
  const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? {};
  const byId = sessions.byId ?? {};
  const items = Array.isArray(workspaces.items) ? workspaces.items : [];
  const archived = new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : []);

  const workspaceByPath = new Map();
  for (const workspace of items) {
    const path = typeof workspace.path === "string" ? workspace.path : "";
    if (path && !workspaceByPath.has(path)) workspaceByPath.set(path, workspace);
  }
  const workspaceKey = (workspace) => workspace?.workspaceId ?? workspace?.id ?? "";
  const workspaceOf = new Map();
  for (const workspace of items) {
    for (const sessionId of workspace.sessionIds ?? []) {
      if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, workspace);
    }
  }

  const groupOf = (id) => {
    const byMember = workspaceOf.get(id);
    if (byMember) return byMember;
    const cwd = byId[id]?.cwd;
    return typeof cwd === "string" ? workspaceByPath.get(cwd) : undefined;
  };

  const toRow = (id) => {
    const summary = byId[id];
    const workspace = groupOf(id);
    return {
      id,
      title: archivedRowTitle(summary),
      updatedAt: summary?.updatedAt ?? 0,
      workspaceId: workspaceKey(workspace),
    };
  };
  const byRecency = (a, b) => b.updatedAt - a.updatedAt;

  const buckets = new Map();
  for (const id of archived) {
    const summary = byId[id];
    if (summary === undefined) continue;
    // 子代理会话（parentId / origin: "subagent"）不是用户开的聊天，不进这个管理页
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

/** 16×16 folder，取自侧栏「工作区」行的原始图标。 */
function ArchivedFolderIcon() {
  return (
    <svg
      className="sk-arch__icon"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={1}
      aria-hidden="true"
    >
      <path
        d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z"
        stroke="currentColor"
      />
      <path d="M3.63501 7.66614H12.3647" stroke="currentColor" />
    </svg>
  );
}

/** 放大镜。 */
function ArchivedSearchIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx={7} cy={7} r={4.5} stroke="currentColor" strokeWidth={1} />
      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

/**
 * 已归档的聊天页面。
 *
 * 不消费 Host 新增接口：只在两个已有快照上做投影，所以页面在离线/冷启动时
 * 也能立刻画出上一份数据。
 */
/** Host 侧的删除通道（由 index-inject 注入的 `window.__SK_HOST`）；缺失时返回 null。 */
function deleteEndpoint() {
  const host = typeof window === "undefined" ? null : window.__SK_HOST;
  if (!host || typeof host.deleteUrl !== "string" || typeof host.token !== "string") return null;
  return host;
}

/** 请求 Host 把这条会话的磁盘目录移进回收站。 */
async function removeSessionViaHost(sessionId) {
  const host = deleteEndpoint();
  if (host === null) return { ok: false, reason: "no-endpoint" };
  try {
    const response = await fetch(`${host.deleteUrl}/delete-session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sk-token": host.token },
      body: JSON.stringify({ sessionId }),
    });
    return await response.json();
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

function createArchivedSection(ctx) {
  const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return function ArchivedChatsSection() {
    const t = ctx.locale.bind(ARCH_NS);
    const [, bump] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const [project, setProject] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    // 删掉的会话：磁盘目录已经移进回收站，但归档标记还留在 workspace.json 里，
    // 重启前列表仍会给出这一行 —— 本地先藏起来，重启后它自然解析不到。
    const [hidden, setHidden] = React.useState(() => new Set());
    const [notice, setNotice] = React.useState("");
    const canRemove = deleteEndpoint() !== null;

    React.useEffect(() => {
      const rerender = () => bump((n) => n + 1);
      const offs = [];
      try {
        offs.push(ctx.sessions.list.subscribe(rerender));
      } catch {
        /* 服务不可用时页面退化为一次性快照 */
      }
      try {
        offs.push(ctx.workspaces.list.subscribe(rerender));
      } catch {
        /* 同上 */
      }
      return () => {
        for (const off of offs) {
          try {
            off();
          } catch {
            /* 已经退订 */
          }
        }
      };
    }, []);

    const { groups, total, unlisted } = readArchived(ctx);
    const projects = groups.filter((group) => group.id !== "__ungrouped");
    const needle = query.trim().toLowerCase();
    const visible = groups
      .filter((group) => project === "" || group.id === project)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (hidden.has(row.id)) return false;
          if (needle === "") return true;
          return (
            (row.title || "").toLowerCase().includes(needle) ||
            group.title.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);
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

    return (
      <div className="sk-arch">
        <div className="sk-arch__head">
          <h2 className="sk-arch__title">{t("title")}</h2>
          <button
            type="button"
            className="sk-arch__action"
            disabled={busy || shown === 0}
            onClick={restoreAll}
          >
            {t("restoreAll")}
          </button>
        </div>

        <div className="sk-arch__bar">
          <div className="sk-arch__search">
            <ArchivedSearchIcon />
            <input
              type="search"
              value={query}
              placeholder={t("search")}
              aria-label={t("search")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="sk-arch__select"
            value={project}
            aria-label={t("project")}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">{t("allProjects")}</option>
            {projects.map((group) => (
              <option value={group.id} key={group.id}>
                {group.title}
              </option>
            ))}
          </select>
        </div>

        {visible.length === 0 ? (
          <div className="sk-arch__empty">
            <p className="sk-arch__emptyTitle">{total === 0 ? t("empty") : t("noMatch")}</p>
            {total === 0 ? <p className="sk-arch__emptyHint">{t("emptyHint")}</p> : null}
          </div>
        ) : (
          visible.map((group) => (
            <section className="sk-arch__group" key={group.id}>
              <div className="sk-arch__groupHead">
                <ArchivedFolderIcon />
                <span className="sk-arch__groupTitle">{group.title || t("ungrouped")}</span>
                <span className="sk-arch__groupCount">{`${group.rows.length} ${t("chats")}`}</span>
              </div>
              {group.rows.map((row) => (
                <div className="sk-arch__row" key={row.id}>
                  <div className="sk-arch__rowMain">
                    <span className="sk-arch__rowTitle" title={row.title || t("untitled")}>
                      {row.title || t("untitled")}
                    </span>
                    <span className="sk-arch__rowTime">
                      {row.updatedAt > 0 ? timeFormat.format(new Date(row.updatedAt)) : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sk-arch__btn"
                    disabled={busy}
                    onClick={() => restore(row.id)}
                  >
                    {t("restore")}
                  </button>
                  <button
                    type="button"
                    className="sk-arch__btn sk-arch__btn--danger"
                    disabled={busy || !canRemove}
                    title={canRemove ? undefined : t("removeFailed").replace("{reason}", "no-endpoint")}
                    onClick={() => remove(row)}
                  >
                    {t("remove")}
                  </button>
                </div>
              ))}
            </section>
          ))
        )}

        {notice !== "" ? <p className="sk-arch__note sk-arch__note--error">{notice}</p> : null}
        {canRemove ? <p className="sk-arch__note">{t("removeHint")}</p> : null}

        {unlisted > 0 ? (
          <p className="sk-arch__note">{t("unlisted").replace("{n}", String(unlisted))}</p>
        ) : null}
      </div>
    );
  };
}

/** 注册设置页 section（`settings.section` 是 ui-settings 声明的根槽位）。 */
function installArchivedSection(ctx) {
  const t = ctx.locale.bind(ARCH_NS);
  return ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "archived-chats",
        order: 20,
        label: () => t("nav"),
        locale: ARCH_NS,
      },
      createArchivedSection(ctx)
    )
  );
}

function apply(ctx) {
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
  factory: (require) => {
    React = require("react");
    const exports = {};
    exports.apply = apply;
    exports.inject = ["slots", "layout", "locale", "sessions", "workspaces"];
    return exports;
  },
});
