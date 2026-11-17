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
 *   2. 清理 —— 计时器到点先加 `--leaving` 动画类，动画结束再 `remove()`，DOM 里不留
 *      尸体（宿主那个 `forwards` 动画会停在 opacity:0 但元素还挂着）；
 *   3. 寿命 —— 节点在 body 上，切面板、切路由都不影响它。
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
  if (typeof document === "undefined" || document.body === null) return null;
  const scope = globalThis as any;
  const existing = scope[HOST_KEY] as ToastHost | undefined;
  // 文档也要对得上：jsdom 每个用例换一份 document，而 host 挂在 globalThis 上会跨用例存活。
  // 只认 `isConnected` 的话 toast 会写进上一个用例的文档里，当前页面一条也看不见。
  if (existing !== undefined && existing.root.isConnected && existing.root.ownerDocument === document) return existing;
  const root = document.createElement("div");
  root.className = "sk-toast-stack";
  root.setAttribute("aria-live", "polite");
  document.body.appendChild(root);
  const created: ToastHost = { root, entries: [] };
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

function dismiss(host: ToastHost, entry: ToastEntry): void {
  if (host.entries.indexOf(entry) === -1) return;
  host.entries = host.entries.filter((item) => item !== entry);
  if (entry.timer !== undefined) clearTimeout(entry.timer);
  entry.el.classList.add("sk-toast--leaving");
  const remove = () => entry.el.remove();
  // jsdom 没有动画事件，兜底计时器保证元素一定会走。
  const timeout = setTimeout(remove, EXIT_MS);
  entry.el.addEventListener("animationend", () => {
    clearTimeout(timeout);
    remove();
  }, { once: true });
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
