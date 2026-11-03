import { isDarwinDesktop } from "./platform.js";

// Only macOS measures the title row; Windows keeps its native titlebar clearance.
const TITLE_ROW = '[data-slot="main.conversation"] [class*="_titleRow"]';

export function installBandHeight() {
  let queued = 0;

  const pass = () => {
    queued = 0;

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
