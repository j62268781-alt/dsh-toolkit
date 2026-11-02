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
    // 只有 macOS 需要「量标题行」来定色带高度。Windows 的色带高度是 0：
    // 顶部那条由 DSH 自己的 frame `padding-top: var(--dsh-windows-titlebar-height)`
    // 让位，量标题行反而会把原生标题栏高度一起算进去。所以这里比
    // isDesktopShell() 更严，只认 darwin。
    if (!isDarwinDesktop()) return;
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

