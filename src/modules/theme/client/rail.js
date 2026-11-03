import HOUSE_SVG from "./assets/house.svg";

// Keep the home entry at activePanelId === null and restore it after host DOM updates.
const RAIL_ROW = '[data-slot="sidebar"] > [class*="_root"] [class*="_panelRow"]';

export function installRailTitles() {
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


const RAIL_LIST = '[data-slot="sidebar"] > [class*="_root"] [class*="_panelList"]';

export function installHomeRail(ctx) {
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
