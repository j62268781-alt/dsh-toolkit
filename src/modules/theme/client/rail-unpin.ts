// Codex rail: the unpin affordance for pinned panels.
//
// DSH 0.2.2-rc.2 renders a 28x28 `_panelUnpin` button inside every panel entry the
// user pinned, and fades it in on hover. In the 52px rail that button lands on top
// of the panel icon and the entry wrapper carries its own inline borders, so the
// icon sits a few pixels off the column centre. The style sheet drops the wrapper
// chrome and hides the button; this module keeps unpinning reachable: hovering a
// pinnable entry shows the dark tooltip shape with a double-click hint, and a
// double-click forwards to that hidden button.
//
// Entries that cannot be unpinned are left alone, exactly like the native host.

const ENTRY = '[data-slot="sidebar"] > [class*="_root"] [class*="_panelEntry"]';
const UNPIN = '[class*="_panelUnpin"]';
const TITLE = '[class*="_panelTitle"]';
const ROW = '[class*="_panelRow"]';
// `rail.js` reads this marker to leave the row without a native `title` bubble:
// the browser tooltip would otherwise pop up underneath the dark hint.
const MARK = "data-sk-unpinnable";
const HINT = "双击取消固定";
const TIP_DELAY_MS = 450;
// Opening a panel is a single click; unpinning it is a double click. Both start with
// the same press, so a click on a pinnable entry is held for one double-click beat:
// if a second click lands inside that window the unpin owns it, otherwise the held
// click is replayed and the panel opens as usual. Keeping the beat short (300ms)
// means a single click still feels immediate.
const CLICK_DELAY_MS = 300;

const entryOf = (node) => (node instanceof Element ? node.closest(`[${MARK}]`) : null);

/** A tooltip clone shaped like the host bubble: dark plate, 6px radius, 13/20 text. */
function createTip() {
  const tip = document.createElement("div");
  tip.className = "sk-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  return tip;
}

function fillTip(tip, entry) {
  const name = entry.querySelector(TITLE)?.textContent?.trim() ?? "";
  const nodes = [];
  if (name) {
    const title = document.createElement("div");
    title.className = "sk-tip__name";
    title.textContent = name;
    nodes.push(title);
  }
  const hint = document.createElement("div");
  hint.className = "sk-tip__hint";
  hint.textContent = HINT;
  nodes.push(hint);
  tip.replaceChildren(...nodes);
}

/** Pin the bubble to the entry's bottom-right, clamped to the viewport. */
function placeTip(tip, entry) {
  const anchor = entry.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
  const below = anchor.bottom + 6;
  const above = anchor.top - box.height - 6;
  const top = below + box.height > window.innerHeight - 8 ? above : below;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

export function installRailUnpin() {
  let queued = 0;
  let tip = null;
  let tipTimer = 0;
  let tipEntry = null;
  let heldClick = 0;
  let replaying = false;
  let lastDoubleClick = 0;

  /** Mark entries that own an unpin button; the host renders that button last. */
  const pass = () => {
    queued = 0;
    for (const entry of document.querySelectorAll(ENTRY)) {
      const pinnable = entry.querySelector(UNPIN) !== null;
      if (pinnable === entry.hasAttribute(MARK)) continue;
      if (pinnable) entry.setAttribute(MARK, "");
      else entry.removeAttribute(MARK);
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(pass);
  };

  const hide = () => {
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = 0;
    tipEntry = null;
    if (tip) tip.hidden = true;
  };

  const show = (entry) => {
    hide();
    tipEntry = entry;
    tipTimer = setTimeout(() => {
      tipTimer = 0;
      if (tipEntry !== entry || !entry.isConnected) return;
      tip = tip ?? createTip();
      fillTip(tip, entry);
      if (!tip.isConnected) document.body.append(tip);
      tip.hidden = false;
      placeTip(tip, entry);
    }, TIP_DELAY_MS);
  };

  const onOver = (event) => {
    const entry = entryOf(event.target);
    if (!entry) return;
    if (event.relatedTarget instanceof Node && entry.contains(event.relatedTarget)) return;
    show(entry);
  };
  const onOut = (event) => {
    const entry = entryOf(event.target);
    if (!entry) return;
    if (event.relatedTarget instanceof Node && entry.contains(event.relatedTarget)) return;
    hide();
  };
  const onPress = (event) => {
    // The hint belongs to the hover only.
    if (entryOf(event.target)) hide();
  };
  /** Hold the activation click of a pinnable row until it is known to be a single click. */
  const onClick = (event) => {
    if (replaying) return;
    const entry = entryOf(event.target);
    if (!entry || !(event.target instanceof Element)) return;
    const row = event.target.closest(ROW);
    if (!row) return;
    // Keyboard activation (Enter/Space) has no second click to wait for.
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (heldClick) {
      clearTimeout(heldClick);
      heldClick = 0;
    }
    // A click right after an unpin belongs to that double click: drop it.
    if (Date.now() - lastDoubleClick < 600) return;
    heldClick = setTimeout(() => {
      heldClick = 0;
      replaying = true;
      const view = row.ownerDocument?.defaultView ?? window;
      try {
        row.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, view }));
      } finally {
        replaying = false;
      }
    }, CLICK_DELAY_MS);
  };
  const onDoubleClick = (event) => {
    const entry = entryOf(event.target);
    const unpin = entry?.querySelector(UNPIN);
    if (!unpin) return;
    lastDoubleClick = Date.now();
    if (heldClick) {
      clearTimeout(heldClick);
      heldClick = 0;
    }
    hide();
    unpin.click();
    // Keep the second click from bubbling into any host double-click handler.
    event.preventDefault();
    event.stopPropagation();
  };

  const Observer = MutationObserver;
  const observer = new Observer(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointerdown", onPress, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  pass();

  return () => {
    observer.disconnect();
    if (queued) cancelAnimationFrame(queued);
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("pointerdown", onPress, true);
    document.removeEventListener("click", onClick, true);
    if (heldClick) clearTimeout(heldClick);
    document.removeEventListener("dblclick", onDoubleClick, true);
    window.removeEventListener("scroll", hide, true);
    window.removeEventListener("resize", hide);
    hide();
    tip?.remove();
    tip = null;
    for (const entry of document.querySelectorAll(`[${MARK}]`)) entry.removeAttribute(MARK);
  };
}
