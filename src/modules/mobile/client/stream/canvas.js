import { DEVICE_WIDTH_FALLBACK } from "./adaptive.js";
// 与 styles.css 机身 padding:5px + border:1px 保持一致。
export const CHASSIS_INSET = 6;
// 每个 createClient 独立持有 WeakMap 和宽度，禁止模块级共享状态。
export function createCanvasRuntime() {
  const stageLayout = new WeakMap();
  const mediaContexts = new WeakMap();
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
    getMediaContext,
    getPanelCssWidth: () => panelCssWidth,
    setDevicePixelWidth(width) {
      devicePixelWidth = width;
    }
  };
}
