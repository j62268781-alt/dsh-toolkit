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

/* ══════════════════════════════════════════════════════════════════════════
 * 平台判定：CSS 与 JS 共用同一条判据
 * ──────────────────────────────────────────────────────────────────────────
 * DSH 的桌面壳会在 <html> 上打两个不同的标记，二者互斥：
 *   · macOS  → data-platform="darwin"          （ui-layout 用 --dsh-frame-top-clearance:48px）
 *   · Windows→ data-windows-titlebar           （ui-layout 用 frame 的 padding-top 让位）
 * 网页端两个都没有。
 *
 * 皮肤里 90% 的规则两端通用，只有三处必须分叉（色带高度、折叠钮锚点、三灯
 * 让位），它们都收敛成 styles/10-tokens.css 里的变量。为了让 CSS 不用把
 * 「darwin 或 windows-titlebar」这串判据抄 24 遍（那样加平台就要改 24 处），
 * 这里把判据落成 <html data-sk-desktop> 一个属性，CSS 统一读它。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 桌面壳标记：由 installDesktopMarker() 维护，CSS 全表读它。 */
const DESKTOP_MARK = "data-sk-desktop";

/** @returns {boolean} 是否是 macOS 桌面壳（只有它渲染 `_topStrip`、有三灯）。 */
function isDarwinDesktop() {
  return document.documentElement.getAttribute("data-platform") === "darwin";
}

/** @returns {boolean} 是否是桌面壳（macOS 或 Windows），网页端为 false。 */
function isDesktopShell() {
  const root = document.documentElement;
  return isDarwinDesktop() || root.hasAttribute("data-windows-titlebar");
}

/**
 * 维护 `<html data-sk-desktop>`：属性是桌面壳就打上，否则摘掉。
 *
 * 为什么用 observer 而不是「apply 时算一次」：`data-platform` /
 * `data-windows-titlebar` 由外壳在启动过程中写入，时机早于或晚于本插件都有可能。
 * 观察这两个属性的变化，标记永远跟着真实平台走，也让 HMR / profile 切换不残留。
 *
 * @returns {() => void} disposer
 */
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
    attributeFilter: ["data-platform", "data-windows-titlebar"],
  });
  sync();
  return () => {
    observer.disconnect();
    root.removeAttribute(DESKTOP_MARK);
  };
}

