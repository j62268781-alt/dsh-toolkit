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
    // 桌面壳两端都要锁首轨宽度。以前这里只认 darwin，于是 Windows 上首轨停在
    // 用户偏好的 280px，而皮肤需要 52(rail) + 240(面板) —— 面板被裁掉一截，
    // rail 也不再是那条 52px，是 Windows 上「没完全居中」的根。
    if (!isDesktopShell()) return;
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

  // 两种变动分开处理，目的是消掉「一帧横移」：
  //   · React 重新写了 frame 的首轨（用户的侧栏偏好宽度）→ **就地立刻**改回来。
  //     MutationObserver 回调在绘制前的微任务里跑，所以浏览器不会先按 280px
  //     画一帧再跳回 296px —— 这种闪一下正是「鼠标划过时面板/标题左移」的来源。
  //   · 其余变动（hover 换类、列表增删、窗口缩放）→ 仍然 rAF 去抖，避免频繁重算。
  const observer = new MutationObserver((mutations) => {
    const frameRewritten = mutations.some(
      (m) => m.type === "attributes" && m.attributeName === "style" && m.target === frameEl,
    );
    if (frameRewritten) pass();
    else schedule();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "data-sidebar-collapsed"],
  });
  // 平台标记是桌面壳在 <html> 上打的（darwin 用 data-platform、Windows 用
  // data-windows-titlebar）；窗口缩放也会让 DSH 重算列宽
  const platformObserver = new MutationObserver(schedule);
  platformObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-platform", "data-windows-titlebar"],
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
 *   · 从 0px 展开 → 不去猜点的是哪个按钮，而是观察 `data-sidebar-collapsed`
 *     从有到无，收到就清掉 workspaceCollapsed → **回到完整展开 296px**。
 *     于是三档循环：296 → 52 → 0 → 296；
 *   · 在 52px 时点 home 图标 → 取消「只收工作区」，回到 296px。
 *
 * 判据一律用「结构 + 状态」，不用 aria-label 文案：文案来自词典，换语言或改
 * 措辞就静默失效。折叠钮的识别用 class 里的 `_toggle` 局部名。
 *
 * 局限：⌘\ 之类的快捷键不经过 DOM 点击，收起方向会直接跳过 52px 收到 0px
 * （展开方向仍由 stateObserver 兜住，会回到 296px）；状态也不持久化。
 */
function installWorkspaceCollapse(ctx) {
  // 折叠钮的识别用**结构**，不用文案：DSH 的折叠钮是 `_iconButton _toggle`
  // （CSS Modules 局部名 `_toggle` 是稳定的那一层，见 styles/10-tokens.css 的说明）。
  // 早先版本这里是拿 aria-label 正则匹配「收起侧边栏 / Collapse sidebar」——
  // 那是错的：文案来自词典，换语言（日文等）或改措辞就静默失效。
  const isToggleButton = (btn) =>
    [...btn.classList].some((name) => name.includes("_toggle"));

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

  // 「展开」不猜按钮，直接看状态：`data-sidebar-collapsed` 从有到无就是展开了。
  // 这样不管用户是用折叠钮、快捷键还是别的入口展开的，都能把「只收工作区」
  // 一起清掉、回到完整展开。观察 body 子树，frame 被重建也不会漏。
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
    subtree: true,
  });

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

    // 2) home 视图、还没收过 → 拦下原生折叠钮，只收工作区。
    //    判据用结构（`_toggle` class），不看 aria-label 文案 —— 文案会随语言变。
    //    「展开」那一侧不在这里处理：交给上面的 stateObserver 观察状态变化，
    //    这样快捷键等其它入口展开时也能正确回到 296px。
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

