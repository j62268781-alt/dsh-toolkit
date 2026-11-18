import { DEVICE_WIDTH_FALLBACK } from "./adaptive.js";
// 与 styles.css 机身 padding:5px + border:1px 保持一致。
export const CHASSIS_INSET = 6;
// 与 200px 的「提前量」一致：面板滚出这么多才算不可见，避免临界处反复停/启。
const VISIBILITY_MARGIN = "200px";

function supportsContentVisibility() {
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
      CSS.supports("content-visibility", "auto") === true;
  } catch {
    return false;
  }
}

/** 被跳过时用 `auto` 记住最后一次真实尺寸，免得外壳被 contain 塌成 0。 */
function intrinsicSizeHint(element) {
  const width = typeof element.offsetWidth === "number" ? element.offsetWidth : 0;
  const height = typeof element.offsetHeight === "number" ? element.offsetHeight : 0;
  return width > 0 && height > 0 ? `auto ${width}px ${height}px` : "auto";
}

/**
 * 画面元素的可见性：文档隐藏 / 滚出视口 / content-visibility 跳过，任一成立即视为不可见。
 *
 * 三个信号任意一个拿不到就当作「可见」，所以不支持这些 API 的浏览器行为与改造前一致。
 * 事件必须直接挂在该元素上：`contentvisibilityautostatechange` 不冒泡，挂到别处收不到。
 *
 * 两个刻意的加固：
 * - 首次布局前的 `skipped: true` 是假的（画布还没渲染），确认过一次可见之后才信这个信号；
 * - `IntersectionObserver` 说它可见时顺手清掉 content 信号：宁可信「看得见」，
 *   否则一个陈旧的 skipped 就能让画面永远停住。
 */
export function watchCanvasVisibility(canvas, onChange) {
  const doc = typeof document === "undefined" ? null : document;
  const element = canvas !== null && canvas !== void 0 &&
    typeof canvas.addEventListener === "function" && typeof canvas.style === "object" ? canvas : null;
  if (element === null) return () => {
  };
  const signals = {
    document: doc === null || doc.visibilityState !== "hidden",
    intersect: true,
    content: true
  };
  let visible = true;
  // 见过一次「确实可见」的证据（IO 命中 或 事件报 skipped:false）才敢按 skipped:true 停流。
  let confirmed = false;
  const sync = () => {
    const next = signals.document && signals.intersect && signals.content;
    if (next === visible) return;
    visible = next;
    onChange(next);
  };
  const disposers = [];
  if (supportsContentVisibility()) {
    element.style.contentVisibility = "auto";
    element.style.containIntrinsicSize = intrinsicSizeHint(element);
    disposers.push(() => {
      element.style.contentVisibility = "";
      element.style.containIntrinsicSize = "";
    });
  }
  // canvas 是替换元素，content-visibility 不一定对它生效，事件也可能永远不来；
  // 下面的 IntersectionObserver 与 visibilitychange 就是那种情况下的兜底。
  if ("oncontentvisibilityautostatechange" in element) {
    const onState = (event) => {
      if (typeof event?.skipped !== "boolean") return;
      if (event.skipped === false) {
        confirmed = true;
        signals.content = true;
      } else if (confirmed) {
        signals.content = false;
      }
      sync();
    };
    element.addEventListener("contentvisibilityautostatechange", onState);
    disposers.push(() => element.removeEventListener("contentvisibilityautostatechange", onState));
  }
  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry === void 0) return;
      signals.intersect = entry.isIntersecting === true;
      if (signals.intersect) {
        confirmed = true;
        signals.content = true;
      }
      sync();
    }, { rootMargin: VISIBILITY_MARGIN });
    observer.observe(element);
    disposers.push(() => observer.disconnect());
  }
  if (doc !== null && typeof doc.addEventListener === "function") {
    const onDocumentVisibility = () => {
      signals.document = doc.visibilityState !== "hidden";
      sync();
    };
    doc.addEventListener("visibilitychange", onDocumentVisibility);
    disposers.push(() => doc.removeEventListener("visibilitychange", onDocumentVisibility));
  }
  // 挂载时页面已经隐藏（切到别的 tab 再回来会重新挂载）也不能开始解码。
  sync();
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

// 每个 createClient 独立持有 WeakMap 和宽度，禁止模块级共享状态。
export function createCanvasRuntime() {
  const stageLayout = new WeakMap();
  const mediaContexts = new WeakMap();
  // 面板尺寸变化只由下面这一个 ResizeObserver 派发，panel 不再每 250ms 量一次。
  const stageSubscribers = new Set<() => void>();
  let devicePixelWidth = 0;
  let panelCssWidth = 0;
  function maxMediaCssWidth(dpr) {
    const native = devicePixelWidth > 0 ? devicePixelWidth : DEVICE_WIDTH_FALLBACK;
    return Math.max(1, Math.round(native / Math.max(1, dpr)));
  }
  function newStageLayout() {
    return {
      manual: false,
      availWidth: Number.NaN,
      availHeight: Number.NaN,
      cssWidth: 0,
      cssHeight: 0,
      bufferWidth: 0,
      bufferHeight: 0,
      // 机身圆角（CSS px），随 CSS 宽度算出来，只在变化时才写进 CSS 变量。
      radius: 0
    };
  }
  function measureStage(parent) {
    const style = getComputedStyle(parent);
    const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    return {
      availWidth: parent.clientWidth - (Number.isFinite(paddingX) ? paddingX : 0),
      availHeight: parent.clientHeight - (Number.isFinite(paddingY) ? paddingY : 0)
    };
  }
  function fitCanvasToFrame(canvas, frameWidth, frameHeight) {
    if (!(frameWidth > 0) || !(frameHeight > 0)) return null;
    // 必须量 .mbm-stage；机身会跟随 canvas，量机身会形成循环依赖。
    const parent = canvas.parentElement;
    if (parent === null) return null;
    const stage = parent.parentElement ?? parent;
    let layout = stageLayout.get(canvas);
    if (layout === void 0) {
      layout = newStageLayout();
      stageLayout.set(canvas, layout);
    }
    // 0 是隐藏容器，NaN 才表示尚未测量；无 ResizeObserver 时逐帧兜底。
    if (layout.manual || Number.isNaN(layout.availWidth) || Number.isNaN(layout.availHeight)) {
      const measured = measureStage(stage);
      layout.availWidth = measured.availWidth;
      layout.availHeight = measured.availHeight;
    }
    const frameMode = stage.getAttribute("data-frame");
    const chassisInset = frameMode === "device" ? CHASSIS_INSET * 2 : 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const availWidth = Math.max(0, Math.min(
      layout.availWidth - chassisInset,
      maxMediaCssWidth(dpr)
    ));
    const availHeight = Math.max(0, layout.availHeight - chassisInset);
    if (availWidth <= 0 || availHeight <= 0) return null;
    const scale = Math.min(availWidth / frameWidth, availHeight / frameHeight);
    const cssWidth = Math.max(1, Math.round(frameWidth * scale));
    const cssHeight = Math.max(1, Math.round(frameHeight * scale));
    if (cssWidth !== layout.cssWidth || cssHeight !== layout.cssHeight) {
      layout.cssWidth = cssWidth;
      layout.cssHeight = cssHeight;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }
    const bufferWidth = Math.max(1, Math.round(cssWidth * dpr));
    const bufferHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (bufferWidth !== layout.bufferWidth || bufferHeight !== layout.bufferHeight) {
      layout.bufferWidth = bufferWidth;
      layout.bufferHeight = bufferHeight;
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    panelCssWidth = cssWidth;
    const radius = Math.round(Math.min(28, Math.max(8, cssWidth * 0.045)));
    if (radius !== layout.radius) {
      layout.radius = radius;
      parent.style.setProperty("--mbm-device-radius", `${radius}px`);
    }
    return { width: cssWidth, height: cssHeight, downscale: frameWidth / bufferWidth };
  }
  /**
   * 订阅「可见面板尺寸变了」。拿不到 ResizeObserver 时返回 `null`，
   * 调用方据此退回自己的定时取尺寸（与改造前一致）。
   */
  function watchStageResize(listener) {
    if (typeof ResizeObserver === "undefined") return null;
    stageSubscribers.add(listener);
    return () => {
      stageSubscribers.delete(listener);
    };
  }
  function notifyStageResize() {
    // 先复制一份：订阅者在回调里退订不该影响这一轮派发。
    for (const listener of [...stageSubscribers]) {
      try {
        listener();
      } catch {
        // 订阅者的异常不能打断 ResizeObserver 的同一批派发。
      }
    }
  }
  function watchStageSize(canvas) {
    const parent = canvas.parentElement;
    if (parent === null) return () => {
    };
    const stage = parent.parentElement ?? parent;
    if (typeof ResizeObserver === "undefined") {
      let layout = stageLayout.get(canvas);
      if (layout === void 0) {
        layout = newStageLayout();
        stageLayout.set(canvas, layout);
      }
      layout.manual = true;
      return () => {
      };
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry === void 0) return;
      let layout = stageLayout.get(canvas);
      if (layout === void 0) {
        layout = newStageLayout();
        stageLayout.set(canvas, layout);
      }
      layout.availWidth = entry.contentRect.width;
      layout.availHeight = entry.contentRect.height;
      notifyStageResize();
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }
  function getMediaContext(canvas, heavilyDownscaled) {
    let ctx = mediaContexts.get(canvas);
    if (ctx === void 0) {
      ctx = canvas.getContext("2d", { alpha: false });
      if (ctx === null) return null;
      mediaContexts.set(canvas, ctx);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = heavilyDownscaled ? "low" : "high";
    return ctx;
  }
  return {
    maxMediaCssWidth,
    measureStage,
    fitCanvasToFrame,
    watchStageSize,
    watchStageResize,
    watchCanvasVisibility,
    getMediaContext,
    getPanelCssWidth: () => panelCssWidth,
    setDevicePixelWidth(width) {
      devicePixelWidth = width;
    }
  };
}
