/**
 * 公共骨架的样式只插一次。
 *
 * `apply` 是每个插件各自跑的，同一份 CSS 若每个模块都 `installStylesheet` 一遍，
 * 页面上会叠出十来个 `<style>`；这里按 id + 文档去重并引用计数：
 * 第一个加载的模块负责插，后来的只加计数，最后一个卸载时才真正删掉
 * （否则先卸载的模块会把别人还在用的样式一起带走）。
 */
import { installStylesheet } from "../../stylesheet.js";
import css from "./style.css";

export const SETTINGS_PARTS_ID = "dsh-toolkit-settings-parts";

export const SETTINGS_PARTS_CSS: string = css;

interface SheetRef {
  count: number;
  /** 这一份 `<style>` 是本模块插的；别人插的同 id 样式不归我们删。 */
  owned: boolean;
}

const sheets = new WeakMap<Document, Map<string, SheetRef>>();

function refFor(doc: Document, id: string): Map<string, SheetRef> {
  let map = sheets.get(doc);
  if (map === undefined) {
    map = new Map<string, SheetRef>();
    sheets.set(doc, map);
  }
  return map!;
}

export function installSharedStylesheet(text: string, id: string): () => void {
  // 测试里的假 document 可能只有 createElement，没有 querySelector（宿主真实 DOM 两者都有）。
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return () => {};

  const map = refFor(document, id);
  const selector = `style[data-plugin="${id}"]`;
  const existing = document.querySelector(selector);
  let ref = map.get(id);
  if (ref === undefined) {
    ref = { count: 0, owned: existing === null };
    map.set(id, ref);
  }
  ref.count += 1;
  // 文档换了（测试里每例一个 jsdom）或样式被宿主清掉时补插一份。
  if (existing === null && ref.owned) installStylesheet(text, id);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    ref!.count -= 1;
    if (ref!.count > 0) return;
    map.delete(id);
    if (ref!.owned) document.querySelector(selector)?.remove();
  };
}

/** 在 client 的 apply 里调用：`ctx.effect(() => installSettingsParts(), "...:settings-parts")`。 */
export function installSettingsParts(): () => void {
  return installSharedStylesheet(SETTINGS_PARTS_CSS, SETTINGS_PARTS_ID);
}