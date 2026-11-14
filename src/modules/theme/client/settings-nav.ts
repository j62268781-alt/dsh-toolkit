/** Settings toolbar, search and grouped navigation; native rows still own page selection. */
import { createSettingsMotion } from './settings-motion.js';
import { installSettingsActions } from './settings-actions.js';

const PANEL = '[data-shortcut-modal="settings"]';
const NAV_LIST = '[class*="_navList"]';
const NAV_CELL = '[class*="_navCell"]';
const GROUPS = [
  { title: "基础设置", ids: ["account", "general", "theme", "boot", "notification"] },
  { title: "模型与 Agent", ids: ["models", "agent-presets", "judgment"] },
  { title: "工具与扩展", ids: ["skills-mcp", "browser", "plugins"] },
  { title: "会话与数据", ids: ["archived-chats"] },
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

function buildBackButton() {
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sk-setnav__back";
  back.setAttribute("aria-label", "返回应用");
  back.title = "返回应用";
  back.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5M5 8h8"/></svg>';
  back.addEventListener("click", closeSettings);
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
  let back = null;
  let grouped = null;
  let actions = null;
  const motion = createSettingsMotion();
  const teardown = () => {
    actions?.dispose();
    grouped?.dispose();
    panel?.removeAttribute("data-sk-settings-toolbar");
    overlay?.removeAttribute("data-sk-settings-overlay");
    block?.remove();
    back?.remove();
    panel = overlay = block = back = grouped = actions = null;
  };
  const scan = () => {
    const next = document.querySelector(PANEL);
    if (panel && !panel.isConnected) motion.leave(panel);
    if (!next) { if (panel) teardown(); return; }
    // Class hashes are build-specific; the native nav is the panel's direct
    // child, which is stable across releases and platforms.
    const nav = [...next.children].find((child) => child.localName === "nav") ?? null;
    if (!nav) return;
    if (panel !== next || !block?.isConnected || !back?.isConnected) {
      teardown();
      panel = next;
      overlay = next.closest('[role="presentation"]') ?? next.parentElement;
      overlay?.setAttribute("data-sk-settings-overlay", "");
      block = buildBlock(() => grouped?.sync());
      back = buildBackButton();
      nav.prepend(block);
      // Keep the titlebar arrow inside the native modal's focus trap.
      panel.prepend(back);
      panel.setAttribute("data-sk-settings-toolbar", "");
      grouped = installGroupedMenu(ctx, nav, block.querySelector("input"));
      actions = installSettingsActions(panel);
      motion.enter(panel);
    }
    grouped.sync();
    actions.sync();
  };
  const observer = new MutationObserver((records) => {
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
