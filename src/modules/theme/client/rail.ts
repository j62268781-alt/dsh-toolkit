import HOUSE_SVG from "./assets/house.svg";
import { watchSidebar } from "./watch.js";

// Keep the home entry at activePanelId === null and restore it after host DOM updates.
// 选择器相对侧栏根节点：真正的观察器挂在 `[data-slot="sidebar"]` 上，
// 不再因为聊天区流式输出而扫描整篇文档。
const RAIL_ROW = '[class*="_root"] [class*="_panelRow"]';

export function installRailTitles() {
  const titles = new Map();

  const pass = (root: Element) => {
    for (const row of root.querySelectorAll(RAIL_ROW)) {
      // A pinnable entry owns its hint (see rail-unpin): the native bubble would
      // pop up underneath the dark one, so leave those rows without a `title`.
      if (row.closest("[data-sk-unpinnable]")) {
        if (row.hasAttribute("title")) row.removeAttribute("title");
        continue;
      }
      const label = row.querySelector('[class*="_panelTitle"]');
      const text = label?.textContent?.trim();
      if (text && row.getAttribute("title") !== text) {
        if (!titles.has(row)) titles.set(row, row.getAttribute("title"));
        row.setAttribute("title", text);
      }
    }
  };

  const stop = watchSidebar(pass);

  return () => {
    stop();
    for (const [row, title] of titles) {
      if (title === null) row.removeAttribute("title");
      else row.setAttribute("title", title);
    }
    titles.clear();
  };
}


const RAIL_LIST = '[class*="_root"] [class*="_panelList"]';

export function installHomeRail(ctx) {
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

    }
    sync();
  };

  const ensure = (root: Element) => {
    const list = root.querySelector(RAIL_LIST);
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

  const info = ctx.layout?.panelInfo;
  if (info && typeof info.subscribe === "function") offPanel = info.subscribe(sync);

  const stop = watchSidebar(ensure);

  return () => {
    stop();
    if (typeof offPanel === "function") offPanel();
    if (home) {
      home.removeEventListener("click", onClick);
      home.remove();
      home = null;
    }
  };
}
