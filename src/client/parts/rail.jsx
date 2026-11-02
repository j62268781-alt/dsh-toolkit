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
/** rail 最上面「工作区」入口的房子图标；源文件 src/client/assets/house.svg，
 * 构建期由 scripts/build-client.mjs 内联成字符串（运行时仍是内联 SVG，不发请求）。 */
const HOUSE_SVG = "__SVG:house__";

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

