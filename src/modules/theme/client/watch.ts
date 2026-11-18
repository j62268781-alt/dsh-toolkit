/**
 * 只盯目标子树的 DOM 观察器。
 *
 * 宿主每渲染一批消息都会改写聊天区，旧实现让五个安装器各自监听
 * `document.body` 的 childList+subtree，于是流式输出时每一批 token 都会
 * 触发一轮 `document.querySelectorAll`。这里把真正的观察器挂到目标元素上；
 * body 观察器只负责发现「宿主把根节点换掉了」，热路径只做一次 `isConnected`
 * 检查，不查 DOM。
 *
 * `find` 比 `selector` 贵（例如在 frame 里找 `_frame` 并读 inline grid），
 * 所以根节点还连着时不会重复调用它。
 */

export interface WatchOptions {
  /** 缺省用 `document.querySelector(selector)` 找根。 */
  selector?: string;
  /** 自定义查找（比 selector 贵时仍只在根断开后调用）。 */
  find?: () => Element | null;
  /** 挂到根上的观察参数；缺省 childList+subtree。 */
  observe?: MutationObserverInit;
  /** 返回 false 时不排 rAF（例如只在 macOS 生效的测量）。 */
  enabled?: () => boolean;
}

export type WatchPass = (root: Element) => void;

/** 侧栏：会话列表、标题、面板行都在这棵子树里。 */
export const SIDEBAR_SELECTOR = '[data-slot="sidebar"]';

/** 聊天区：流式输出全部落在这里，侧栏观察器不该被它唤醒。 */
export const CONVERSATION_SELECTOR = '[data-slot="main.conversation"]';

export function watchSidebar(pass: WatchPass): () => void {
  return watchElement(pass, {
    selector: SIDEBAR_SELECTOR,
    observe: { childList: true, subtree: true, characterData: true },
  });
}

export function watchConversation(pass: WatchPass, enabled?: () => boolean): () => void {
  return watchElement(pass, {
    selector: CONVERSATION_SELECTOR,
    observe: { childList: true, subtree: true, characterData: true },
    ...(enabled === undefined ? {} : { enabled }),
  });
}

export function watchElement(pass: WatchPass, options: WatchOptions): () => void {
  const find = options.find ?? (() => document.querySelector(options.selector ?? ""));
  const observeOptions: MutationObserverInit = options.observe ?? { childList: true, subtree: true };
  const enabled = options.enabled ?? (() => true);
  let root: Element | null = null;
  let inner: MutationObserver | null = null;
  let frameHandle = 0;
  let probeHandle = 0;
  let active = true;

  const schedule = () => {
    if (!active || frameHandle !== 0 || !enabled()) return;
    frameHandle = requestAnimationFrame(() => {
      frameHandle = 0;
      if (!active) return;
      const node = ensure();
      if (node !== null) pass(node);
    });
  };

  const ensure = (): Element | null => {
    if (root !== null && root.isConnected) return root;
    const next = find();
    if (next === null) {
      root = null;
      return null;
    }
    root = next;
    inner?.disconnect();
    inner = new MutationObserver(schedule);
    inner.observe(next, observeOptions);
    return next;
  };

  const outer = new MutationObserver(() => {
    // 热路径：根还在，只是聊天区在流式输出 —— 立刻返回，不查 DOM。
    if (!active || (root !== null && root.isConnected)) return;
    if (probeHandle !== 0) return;
    probeHandle = requestAnimationFrame(() => {
      probeHandle = 0;
      if (active && ensure() !== null) schedule();
    });
  });
  outer.observe(document.body, { childList: true, subtree: true });

  const node = ensure();
  if (node !== null && enabled()) pass(node);

  return () => {
    active = false;
    outer.disconnect();
    inner?.disconnect();
    inner = null;
    if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
    if (probeHandle !== 0) cancelAnimationFrame(probeHandle);
    frameHandle = 0;
    probeHandle = 0;
  };
}