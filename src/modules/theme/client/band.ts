import { isDarwinDesktop } from "./platform.js";
import { watchConversation } from "./watch.js";

// Only macOS measures the title row; Windows keeps its native titlebar clearance.
const TITLE_ROW = '[class*="_titleRow"]';
const HEADER_ROW = '[class*="_header"] [class*="_titleRow"]';

export function installBandHeight() {
  const previous = document.body.style.getPropertyValue("--cx-band-h");
  const priority = document.body.style.getPropertyPriority("--cx-band-h");

  const pass = (root: Element) => {
    if (!isDarwinDesktop()) return;
    const row = root.querySelector(TITLE_ROW) ?? root.querySelector(HEADER_ROW);
    if (!row) return;
    const bottom = Math.round(row.getBoundingClientRect().bottom);
    if (bottom <= 0) return;
    const next = bottom + "px";
    if (document.body.style.getPropertyValue("--cx-band-h") !== next) {
      document.body.style.setProperty("--cx-band-h", next);
    }
  };

  const measure = () => {
    const root = document.querySelector('[data-slot="main.conversation"]');
    if (root !== null) pass(root);
  };

  // 聊天区是流式输出的落点：非 macOS 连 rAF 都不排，符合「Windows 不测量」的约定。
  const stop = watchConversation(pass, isDarwinDesktop);
  window.addEventListener("resize", measure);

  return () => {
    stop();
    window.removeEventListener("resize", measure);
    if (previous) document.body.style.setProperty("--cx-band-h", previous, priority);
    else document.body.style.removeProperty("--cx-band-h");
  };
}