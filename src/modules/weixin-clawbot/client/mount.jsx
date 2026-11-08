/**
 * 把入口图标挂到侧栏账户行里。
 *
 * 为什么不走插槽：账户按钮由宿主 `settings.launcher` 渲染，那是 `kind: "single"`
 * 插槽且已被 AccountMenu 独占，第三方注册不进去。所以这里和 theme 模块的
 * `installHomeRail` 一样，直接在宿主容器 `_triggerRow` 里追加自己的节点。
 *
 * 为什么同一个锚点能同时满足两种皮肤：`_triggerRow` 的 DOM 顺序恒为
 * [账户按钮, 连接指示器, 更新指示器]，只是排布不同 ——
 *   - 原生皮肤是 `display:flex` 行排布，账户按钮 `flex:1` 占满剩余宽度，
 *     追加到末尾即「账户行最右侧」；
 *   - codex 皮肤把该行改成 `flex-direction:column-reverse`，主轴反转，
 *     追加到末尾即视觉最上，也就是「更新 logo 上方」。
 */

const TRIGGER_ROW = '[data-slot="sidebar"] > [class*="_root"] [class*="_triggerRow"]';

/**
 * 安装入口；返回卸载函数。
 * @param ctx 宿主上下文（只用来取 disposer 语义，本函数不读任何服务）。
 * @param options.React  宿主注入的 React。
 * @param options.createRoot react-dom/client 的 createRoot；拿不到时不安装。
 * @param options.Entry   要渲染的组件。
 */
export function installEntry(ctx, { React, createRoot, Entry }) {
  // 浏览器环境之外（例如注册冒烟测试的假 document）直接放弃安装。
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return () => {};
  if (typeof createRoot !== "function" || typeof React?.createElement !== "function") return () => {};

  let queued = 0;
  let container = null;
  let root = null;
  let observer = null;

  const ensure = () => {
    const row = document.querySelector(TRIGGER_ROW);
    if (!row) return;
    // React 重渲染会把我们追加的节点踢掉；重新挂回同一位置即可。
    if (container?.parentElement === row) return;
    if (container === null) {
      container = document.createElement("div");
      container.className = "wc-mount";
      container.dataset.wcEntry = "";
      root = createRoot(container);
      root.render(React.createElement(Entry));
    }
    row.append(container);
  };

  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      ensure();
    });
  };

  if (typeof MutationObserver === "function" && typeof document.body === "object" && document.body !== null) {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  ensure();

  return () => {
    if (observer !== null) observer.disconnect();
    if (queued) cancelAnimationFrame(queued);
    queued = 0;
    if (root !== null) {
      // 卸载要同步做完：延迟到下一帧会让 React 在节点已摘除后再去提交。
      root.unmount();
      root = null;
    }
    if (container !== null) {
      container.remove();
      container = null;
    }
  };
}
