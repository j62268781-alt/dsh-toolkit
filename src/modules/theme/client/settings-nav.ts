/** Settings toolbar, search and grouped navigation; native rows still own page selection. */
import { createSettingsMotion } from './settings-motion.js';
import { installSettingsActions } from './settings-actions.js';
import { SHELL_MIN_WIDTH } from './platform.js';

const PANEL = '[data-shortcut-modal="settings"]';
const NAV_LIST = '[class*="_navList"]';
const NAV_CELL = '[class*="_navCell"]';
const NAV_ID = "sk-settings-nav";
/** 分组参照 Qoder 的设置导航：个人 / 集成 / 连接 / 归档管理。
 *  ids 的顺序就是组内顺序；没列到的 section 落进「其他设置」，新模块忘了登记也不会消失。 */
const GROUPS = [
  { title: "个人", ids: ["account", "general", "theme", "boot", "desktop-pet", "notification", "models"] },
  { title: "集成", ids: ["plugins", "agent-presets", "skills-mcp", "judgment", "hooks", "git", "browser"] },
  { title: "连接", ids: ["remote-connection", "mobile"] },
  { title: "归档管理", ids: ["archived-chats"] },
  { title: "其他设置", ids: [] },
];

const SEARCH_ICON =
  '<svg class="sk-setnav__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke-width="1.3">' +
  '<circle cx="7" cy="7" r="4.25" stroke="currentColor"></circle>' +
  '<path d="M10.25 10.25 13 13" stroke="currentColor" stroke-linecap="round"></path>' +
  '</svg>';

/** Use the native close path so modal disposal and focus restoration stay intact. */
function closeSettings() {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true,
  }));
}

function buildNavToggle() {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sk-setnav__toggle";
  toggle.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><rect x="2.25" y="3.25" width="11.5" height="9.5" rx="2"></rect><path d="M6.5 3.25v9.5"></path></svg>';
  return toggle;
}

function buildScrim() {
  const scrim = document.createElement("div");
  scrim.className = "sk-setnav__scrim";
  scrim.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  return scrim;
}

function buildBackButton(onClick: () => void) {
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sk-setnav__back";
  back.setAttribute("aria-label", "返回应用");
  back.title = "返回应用";
  back.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5M5 8h8"/></svg>';
  back.addEventListener("click", onClick);
  return back;
}

function buildBlock(onInput) {
  const block = document.createElement("div");
  block.className = "sk-setnav";
  block.setAttribute("data-sk-setnav", "");
  const search = document.createElement("div");
  search.className = "sk-setnav__search";
  search.innerHTML = SEARCH_ICON;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sk-setnav__input";
  input.placeholder = "搜索设置";
  input.setAttribute("aria-label", "搜索设置");
  input.addEventListener("input", onInput);
  search.append(input);
  block.append(search);
  return block;
}

/** Never move React-owned buttons. Grouped buttons forward clicks to those original rows. */
function installGroupedMenu(ctx, nav, input) {
  const menu = document.createElement("div");
  menu.className = "sk-setnav__groups";
  const empty = document.createElement("div");
  empty.className = "sk-setnav__empty";
  empty.textContent = "没有匹配的设置";
  empty.hidden = true;
  let signature = "";
  let items = [];
  let sections = [];
  nav.append(menu, empty);

  const sync = () => {
    const list = nav.querySelector(NAV_LIST);
    const cells = list ? [...list.querySelectorAll(NAV_CELL)] : [];
    const rows = (ctx.slots?.entries("settings.section") ?? []).map(({ options }) => ({
      id: options.id,
      order: options.order ?? 0,
      label: (typeof options.label === "function" ? options.label() : options.label) ?? "",
    })).sort((a, b) => a.order - b.order);
    // Slot subscriptions may fire before React commits the new rows or locale.
    const matched = rows.length > 0 && rows.length === cells.length &&
      rows.every((row, i) => row.label.trim() === cells[i].textContent.trim());
    const query = input.value.trim().toLowerCase();
    nav.toggleAttribute("data-sk-settings-grouped", matched);
    menu.hidden = !matched;
    let hits = 0;
    if (matched) {
      const nextSignature = JSON.stringify(rows.map((row, i) => [row.id, row.label, cells[i].querySelector("svg")?.outerHTML]));
      if (nextSignature !== signature) {
        const focusedId = document.activeElement?.getAttribute("data-settings-id");
        const scroll = menu.scrollTop;
        items = [];
        sections = [];
        const groups = GROUPS.map((group) => ({ ...group, rows: [] }));
        rows.forEach((row, i) => {
          const group = groups.find((group) => group.ids.includes(row.id)) ?? groups.at(-1);
          group.rows.push({ ...row, index: i });
        });
        menu.replaceChildren();
        for (const group of groups) {
          if (!group.rows.length) continue;
          group.rows.sort((a, b) => group.ids.indexOf(a.id) - group.ids.indexOf(b.id));
          const section = document.createElement("section");
          section.className = "sk-setnav__group";
          section.setAttribute("aria-label", group.title);
          const heading = document.createElement("div");
          heading.className = "sk-setnav__heading";
          heading.textContent = group.title;
          section.append(heading);
          const groupItems = [];
          for (const row of group.rows) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "sk-setnav__item";
            button.setAttribute("data-settings-id", row.id);
            const icon = cells[row.index].querySelector("svg")?.cloneNode(true);
            if (icon) { icon.setAttribute("aria-hidden", "true"); button.append(icon); }
            const label = document.createElement("span");
            label.textContent = row.label;
            button.append(label);
            button.addEventListener("click", () => {
              // Resolve at click time: React may have replaced a row with the same ID.
              const cell = nav.querySelector(NAV_LIST)?.querySelectorAll(NAV_CELL)[row.index];
              cell?.click();
            });
            const item = { button, index: row.index, label: row.label.toLowerCase() };
            items.push(item);
            groupItems.push(item);
            section.append(button);
          }
          sections.push({ section, items: groupItems });
          menu.append(section);
        }
        signature = nextSignature;
        menu.scrollTop = scroll;
        const focused = items.find(({ button }) => button.getAttribute("data-settings-id") === focusedId)?.button;
        if (focusedId) (focused ?? input).focus();
      }
      for (const item of items) {
        const selected = cells[item.index].getAttribute("aria-current") === "true";
        if (selected && item.button.getAttribute("aria-current") !== "true") item.button.setAttribute("aria-current", "true");
        if (!selected && item.button.hasAttribute("aria-current")) item.button.removeAttribute("aria-current");
        const visible = query === "" || item.label.includes(query);
        if (!visible && document.activeElement === item.button) input.focus();
        item.button.hidden = !visible;
        if (visible) hits++;
        if (document.activeElement === cells[item.index]) item.button.focus();
      }
      for (const group of sections) group.section.hidden = group.items.every(({ button }) => button.hidden);
      for (const cell of cells) cell.style.removeProperty("display");
    } else {
      if (menu.contains(document.activeElement)) input.focus();
      // Keep the native menu usable if its registry and rendered rows are between commits.
      for (const cell of cells) {
        const visible = query === "" || cell.textContent.toLowerCase().includes(query);
        if (visible) { cell.style.removeProperty("display"); hits++; }
        else cell.style.setProperty("display", "none");
      }
    }
    empty.hidden = query === "" || hits > 0;
  };

  return {
    sync,
    dispose() {
      for (const cell of nav.querySelectorAll(NAV_CELL)) cell.style.removeProperty("display");
      nav.removeAttribute("data-sk-settings-grouped");
      menu.remove();
      empty.remove();
    },
  };
}

/** The host plugin context is a runtime object with no type in the client program;
 *  `any` keeps the slot/locale subscriptions honest instead of inventing a shape. */
export function installSettingsNav(ctx: any = {}) {
  let panel = null;
  let overlay = null;
  let block = null;
  let toolbar: HTMLDivElement | null = null;
  let back = null;
  let toggle = null;
  let scrim = null;
  let nav = null;
  let grouped = null;
  let actions = null;
  let narrow = false;
  let navOpen = true;
  let ownsNavId = false;
  const motion = createSettingsMotion();
  const applyViewport = () => {
    if (!panel) return;
    panel.setAttribute("data-sk-settings-nav", narrow ? (navOpen ? "open" : "collapsed") : (navOpen ? "wide" : "wide-collapsed"));
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(navOpen));
      const label = navOpen ? "收起设置导航" : "展开设置导航";
      if (toggle.getAttribute("aria-label") !== label) toggle.setAttribute("aria-label", label);
      if (toggle.title !== label) toggle.title = label;
    }
    if (scrim) scrim.hidden = !(narrow && navOpen);
  };
  const syncViewport = () => {
    const next = (window.innerWidth || 0) < SHELL_MIN_WIDTH;
    if (next !== narrow) {
      narrow = next;
      if (narrow && nav?.contains(document.activeElement)) toggle?.focus();
      navOpen = !narrow;
    }
    applyViewport();
  };
  const openNav = () => {
    if (navOpen) return;
    navOpen = true;
    applyViewport();
    if (narrow) block?.querySelector("input")?.focus();
  };
  const closeNav = (restoreFocus = false) => {
    if (!navOpen) return;
    navOpen = false;
    applyViewport();
    if (restoreFocus && toggle?.isConnected) toggle.focus();
  };
  const onNavClick = (event) => {
    if (!narrow || !navOpen) return;
    // Search, headings and empty hints keep the drawer open; only a destination closes it.
    if (!(event.target as Element | null)?.closest?.(".sk-setnav__item, " + NAV_CELL)) return;
    closeNav(true);
  };
  const onEscape = (event) => {
    if (!narrow || !navOpen || event.key !== "Escape") return;
    // Escape closes the drawer before the native modal sees it and closes settings.
    event.preventDefault();
    event.stopImmediatePropagation();
    closeNav(true);
  };
  const onResize = () => syncViewport();
  const teardown = () => {
    actions?.dispose();
    grouped?.dispose();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onEscape, true);
    nav?.removeEventListener("click", onNavClick);
    if (ownsNavId && nav?.id === NAV_ID) nav.removeAttribute("id");
    panel?.removeAttribute("data-sk-settings-toolbar");
    panel?.removeAttribute("data-sk-settings-nav");
    overlay?.removeAttribute("data-sk-settings-overlay");
    block?.remove();
    toolbar?.remove();
    toolbar = null;
    scrim?.remove();
    panel = overlay = block = back = toggle = scrim = nav = grouped = actions = null;
    ownsNavId = false;
  };
  const scan = () => {
    const next = document.querySelector(PANEL);
    if (panel && !panel.isConnected) motion.leave(panel);
    if (!next) { if (panel) teardown(); return; }
    // Class hashes are build-specific; the native nav is the panel's direct
    // child, which is stable across releases and platforms.
    const navElement = [...next.children].find((child) => child.localName === "nav") ?? null;
    if (!navElement) return;
    if (panel !== next || !block?.isConnected || !back?.isConnected) {
      teardown();
      panel = next;
      overlay = next.closest('[role="presentation"]') ?? next.parentElement;
      overlay?.setAttribute("data-sk-settings-overlay", "");
      nav = navElement;
      // Keep a native id if one exists; only claim the attribute when it is ours.
      ownsNavId = !nav.id;
      if (ownsNavId) nav.id = NAV_ID;
      // A cloned panel (motion exit copy or a native remount) can carry our
      // nodes; remove them before installing a fresh set.
      for (const stale of next.querySelectorAll(":scope > .sk-setnav__toolbar, :scope > .sk-setnav__scrim")) stale.remove();
      block = buildBlock(() => grouped?.sync());
      back = buildBackButton(() => {
        if (narrow) closeNav();
        closeSettings();
      });
      toggle = buildNavToggle();
      toggle.setAttribute("aria-controls", nav.id);
      scrim = buildScrim();
      nav.prepend(block);
      // Keep the titlebar controls inside the native modal's focus trap.
      toolbar = document.createElement("div");
      toolbar.className = "sk-setnav__toolbar";
      toolbar.append(back, toggle);
      panel.prepend(toolbar);
      panel.append(scrim);
      toggle.addEventListener("click", () => navOpen ? closeNav(true) : openNav());
      scrim.addEventListener("click", () => closeNav(true));
      nav.addEventListener("click", onNavClick);
      window.addEventListener("resize", onResize);
      window.addEventListener("keydown", onEscape, true);
      narrow = (window.innerWidth || 0) < SHELL_MIN_WIDTH;
      navOpen = !narrow;
      applyViewport();
      panel.setAttribute("data-sk-settings-toolbar", "");
      grouped = installGroupedMenu(ctx, nav, block.querySelector("input"));
      actions = installSettingsActions(panel, toolbar);
      motion.enter(panel);
    }
    grouped.sync();
    actions.sync();
  };
  const observer = new MutationObserver((records) => {
    // 设置面板只在模态打开时存在。面板既不在状态里也不在 DOM 里时，这一批记录
    // 一条都不用看 —— 绝大多数时间（正常聊天）就是这个分支，连 closest 都不做。
    if (panel === null && document.querySelector(PANEL) === null) return;
    // 聊天区流式输出每批 token 都会产生记录；设置面板不可能在里面，
    // 直接跳过，别为每个 token 做一次全文档 querySelector。
    const chatOnly = (record) => {
      // 不用 `instanceof Element`：宿主/测试环境不一定会挂这个全局，
      // throw 一次就足以让整个 MutationObserver 静默失效。
      const target = record.target;
      const element = target.nodeType === 1 ? target : target.parentElement;
      return element?.closest?.('[data-slot="main.conversation"]') != null;
    };
    if (records.every(chatOnly)) return;
    // Ignore our own menu updates; watch the original rows for React/locale changes.
    if (records.some(({ target }) => !target.parentElement?.closest(".sk-setnav__groups,.sk-setnav__empty") &&
      !(target as Element).closest?.(".sk-setnav__groups,.sk-setnav__empty"))) scan();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-current", "class", "disabled"] });
  const offSlots = ctx.slots?.subscribe("settings.section", scan);
  const offLocale = ctx.locale?.subscribe(scan);
  scan();
  return () => {
    observer.disconnect();
    offSlots?.();
    offLocale?.();
    teardown();
    motion.dispose();
  };
}
