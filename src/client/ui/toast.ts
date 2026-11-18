/**
 * 整个工具箱共用的一条 toast 通道。
 *
 * 为什么不是直接用宿主的 `Toast` 组件：那是**受控的单实例**组件（一次只能挂在某个
 * slot 里），没有队列、没有服务端入口，`onDone` 之后还得自己清状态。挂在
 * `settings.section` 里的那次，用户一切面板就跟着卸载；挂在 `shell.overlay` 里则每
 * 个模块（以及每个独立包）各挂一个，同一个 bundle id 会在同一个 list slot 里撞车。
 *
 * 所以这里自己拿一个 DOM 节点：`document.body` 上的一个栈，与 React 树无关。
 * 这三个当时列出来的坑因此都不存在了：
 *   1. 队列 —— `MAX_VISIBLE` 之外的按到达顺序把最老的挤掉，多条不会叠在同一像素上；
 *   2. 清理 —— 进场/退场是 CSS 过渡，节点一定会从 DOM 里走（见 `dismiss` 的三重兜底）；
 *   3. 寿命 —— 节点在 body 上，切面板、切路由都不影响它。
 *
 * 支持 popover 的宿主里，栈本身是一个 `popover="manual"`：进 top layer，不再和宿主的
 * 弹层抢 z-index；manual 是刻意的——toast 不该因为用户点到别处就消失。不支持 popover
 * 的环境（jsdom、老宿主）完全不声明这个属性，退回改造前的 `position:fixed` 栈。
 *
 * 单例放在 `globalThis` 上还有一个原因：`scripts/build-client.mjs` 把 `src/client/**`
 * 分别内联进聚合包和每个独立包，同一份代码在页面里可能有多个实例。实例各有一个
 * 模块作用域变量，但共用同一个 host —— 于是「聚合包 + 某个独立包同时装」也只有一个
 * 栈，不会出现两列互相重叠的 toast。
 */
import toastCss from "./toast.css";
import { installStylesheet } from "./stylesheet.js";

export type ToastTone = "info" | "success" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  /** 毫秒。默认 error 6000、success 2400、info 4000；给 0 表示不自动消失。 */
  holdMs?: number;
}

interface ToastEntry {
  tone: ToastTone;
  text: string;
  el: HTMLElement;
  timer: any;
}

interface ToastHost {
  root: HTMLElement;
  entries: ToastEntry[];
  /** 栈容器是不是一个 `popover="manual"`（按元素能力判断，jsdom 里为 false）。 */
  popover: boolean;
  /** 我们自己的 popover 开关状态；不用 `:popover-open` 是因为那是选择器，异常代价太大。 */
  shown: boolean;
}

const HOST_KEY = "__dshToolkitToast__";
const STYLE_ID = "dsh-toolkit-toast";
const MAX_VISIBLE = 3;
const MAX_TEXT = 300;
const EXIT_MS = 180;
const HOLD_MS: Record<ToastTone, number> = { info: 4000, success: 2400, error: 6000 };

/** 同一个页面里有几份 bundle 就有几份模块实例，host 只能有一个。 */
function resolveHost(): ToastHost | null {
  // 单测（node 环境）与 SSR 里没有 document：静默丢弃，绝不抛错。
  // `createElement` 也要探一下：报错通道自己抛异常会顶掉调用方的 catch 分支，
  // 比少一条提示严重得多（测试里的 document 桩就只给了 visibilityState）。
  if (typeof document === "undefined" || document.body == null || typeof document.createElement !== "function") return null;
  const scope = globalThis as any;
  const existing = scope[HOST_KEY] as ToastHost | undefined;
  // 文档也要对得上：jsdom 每个用例换一份 document，而 host 挂在 globalThis 上会跨用例存活。
  // 只认 `isConnected` 的话 toast 会写进上一个用例的文档里，当前页面一条也看不见。
  if (existing !== undefined && existing.root.isConnected && existing.root.ownerDocument === document) return existing;
  const root = document.createElement("div");
  root.className = "sk-toast-stack";
  // 栈是「一块区域」，不是 live region：逐条的 role=status/alert 已经带给读屏播报语义，
  // 容器再挂 aria-live 会让同一条文案被念两遍。
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "通知");
  // 能力在元素上判断：`'popover' in HTMLElement.prototype` 在 jsdom 里是 false，但宿主
  // 换过 document 时全局构造器也可能不是当前文档的，直接问元素最可靠。
  const popover = typeof (root as any).showPopover === "function";
  if (popover) root.setAttribute("popover", "manual");
  document.body.appendChild(root);
  const created: ToastHost = { root, entries: [], popover, shown: false };
  scope[HOST_KEY] = created;
  return created;
}

/** 样式只插一次；别的 bundle 实例插过了就跳过（按 `data-plugin-css` 认，与宿主回收约定一致）。 */
function ensureStyles(): void {
  try {
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}/styles.css"]`) !== null) return;
  } catch {
    /* querySelector 在极端老宿主上可能抛，拦不到就退化成插一次。 */
  }
  installStylesheet(toastCss, STYLE_ID);
}

function normalizeHold(tone: ToastTone, holdMs: number | undefined): number {
  if (typeof holdMs !== "number" || !Number.isFinite(holdMs) || holdMs < 0) return HOLD_MS[tone];
  return holdMs;
}

function clamp(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** 第一条 toast 入栈时把 popover 打开（元素已经连在 document 上）。 */
function openStack(host: ToastHost): void {
  if (!host.popover || host.shown) return;
  try {
    (host.root as any).showPopover();
    host.shown = true;
  } catch {
    /* 已经在 top layer 里、或元素被宿主摘走：保持可用比状态精确更重要 */
  }
}

/** 栈里一条都不剩时才关 popover：还有离场动画在播时关掉会让它直接消失。 */
function closeStack(host: ToastHost): void {
  if (!host.popover || !host.shown) return;
  host.shown = false;
  try {
    (host.root as any).hidePopover();
  } catch {
    /* 已经关掉了 */
  }
}

function dismiss(host: ToastHost, entry: ToastEntry): void {
  if (host.entries.indexOf(entry) === -1) return;
  host.entries = host.entries.filter((item) => item !== entry);
  if (entry.timer !== undefined) clearTimeout(entry.timer);
  entry.el.classList.add("sk-toast--leaving");
  let done = false;
  function finish(): void {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    entry.el.removeEventListener("transitionend", onEnd);
    entry.el.removeEventListener("animationend", onEnd);
    entry.el.remove();
    // 节点真的离开 DOM 之后才谈「清空」：离场过渡期间还要留在 top layer 里播完。
    if (host.root.childElementCount === 0) closeStack(host);
  }
  function onEnd(event: Event): void {
    if (event.target !== entry.el) return;
    finish();
  }
  entry.el.addEventListener("transitionend", onEnd);
  entry.el.addEventListener("animationend", onEnd);
  // 纯过渡路径也会失手：`prefers-reduced-motion: reduce` 下过渡根本不跑，
  // `transitionend` 永不触发；jsdom 里更是两个事件都没有。兜底定时器保证节点一定走。
  const timeout = setTimeout(finish, EXIT_MS);
  // 过渡被媒体查询关掉时 getAnimations() 是空的：这时不必等满 180ms，直接收尾。
  // getAnimations 自己会先把样式更新到最新，所以刚加上的 `--leaving` 类已经算进去了。
  if (typeof entry.el.getAnimations === "function") {
    try {
      if (entry.el.getAnimations().length === 0) finish();
    } catch {
      /* 拿不到动画列表就交给兜底定时器 */
    }
  }
}

function arm(host: ToastHost, entry: ToastEntry, holdMs: number): void {
  if (entry.timer !== undefined) clearTimeout(entry.timer);
  if (holdMs === 0) {
    entry.timer = undefined;
    return;
  }
  entry.timer = setTimeout(() => dismiss(host, entry), holdMs);
}

/** 展示一条 toast。空文本直接忽略（面板里 `error !== ''` 之类的前置判断因此可以删掉）。 */
export function showToast(text: unknown, options: ToastOptions = {}): void {
  const message = clamp(String(text ?? "").trim());
  if (message === "") return;
  const host = resolveHost();
  if (host === null) return;
  ensureStyles();

  const tone = options.tone ?? "info";
  const holdMs = normalizeHold(tone, options.holdMs);

  // 同一条文案已经在屏幕上：只续命，不再叠一条（轮询类失败一秒一条，叠起来会糊满屏幕）。
  const duplicate = host.entries.find((entry) => entry.tone === tone && entry.text === message);
  if (duplicate !== undefined) {
    arm(host, duplicate, holdMs);
    return;
  }

  const el = document.createElement("div");
  el.className = `sk-toast sk-toast--${tone}`;
  el.dataset.tone = tone;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  if (tone !== "info") {
    const icon = document.createElement("span");
    icon.className = "sk-toast__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tone === "error" ? "!" : "✓";
    el.appendChild(icon);
  }
  const body = document.createElement("span");
  body.className = "sk-toast__text";
  body.textContent = message;
  el.appendChild(body);
  host.root.appendChild(el);
  openStack(host);

  const entry: ToastEntry = { tone, text: message, el, timer: undefined };
  host.entries.push(entry);
  // 超出上限就把最老的请出去：宁可少看见一条，也不让整层糊住界面。
  while (host.entries.length > MAX_VISIBLE) dismiss(host, host.entries[0]);
  arm(host, entry, holdMs);
}

/** 清空整个栈（卸载与测试用；正常使用不需要调）。 */
export function clearToasts(): void {
  const host = resolveHost();
  if (host === null) return;
  for (const entry of [...host.entries]) dismiss(host, entry);
}

export const toast = {
  show: showToast,
  info: (text: unknown, options: Omit<ToastOptions, "tone"> = {}) => showToast(text, { ...options, tone: "info" }),
  success: (text: unknown, options: Omit<ToastOptions, "tone"> = {}) => showToast(text, { ...options, tone: "success" }),
  error: (text: unknown, options: Omit<ToastOptions, "tone"> = {}) => showToast(text, { ...options, tone: "error" }),
};
