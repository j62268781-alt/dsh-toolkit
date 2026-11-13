// 吸收分辨率量化误差：升档持续 600ms、降档 3s，失败冷却最多 60s。
export const REGRANT_UPSCALE_RATIO = 1.02;
export const REGRANT_DOWNSCALE_RATIO = 1.05;
export const REGRANT_UPSCALE_HOLD_MS = 600;
export const REGRANT_DOWNSCALE_HOLD_MS = 3000;
export const REGRANT_MIN_INTERVAL_MS = 5000;
export const REGRANT_COOLDOWN_MAX_MS = 60000;
export const REGRANT_TICK_MS = 250;
export const REGRANT_STABLE_PX = 1;
export const DEVICE_WIDTH_FALLBACK = 1080;
export function newRegrantStreak() {
  return { direction: "none", since: 0 };
}
export function nextCooldownMs(prev) {
  if (!(prev > 0)) return REGRANT_MIN_INTERVAL_MS;
  return Math.min(prev * 2, REGRANT_COOLDOWN_MAX_MS);
}
export function nextCooldownAfterGrant(cooldown, requestedPx, effectivePx) {
  if (!(requestedPx > 0) || !(effectivePx > 0)) return REGRANT_MIN_INTERVAL_MS;
  if (effectivePx >= requestedPx) return REGRANT_MIN_INTERVAL_MS;
  const stillTooSmall = requestedPx / effectivePx > REGRANT_UPSCALE_RATIO;
  return stillTooSmall ? nextCooldownMs(cooldown) : REGRANT_MIN_INTERVAL_MS;
}
export function decideRegrant(streak, needPx, framePx, now, lastAt, cooldownMs = REGRANT_MIN_INTERVAL_MS) {
  if (!(needPx > 0) || !(framePx > 0)) {
    streak.direction = "none";
    return false;
  }
  let direction = "none";
  if (needPx / framePx > REGRANT_UPSCALE_RATIO) direction = "up";
  else if (framePx / needPx > REGRANT_DOWNSCALE_RATIO) direction = "down";
  if (direction === "none") {
    streak.direction = "none";
    return false;
  }
  if (direction !== streak.direction) {
    streak.direction = direction;
    streak.since = now;
    return false;
  }
  const hold = direction === "up" ? REGRANT_UPSCALE_HOLD_MS : REGRANT_DOWNSCALE_HOLD_MS;
  if (now - streak.since < hold) return false;
  if (lastAt > 0 && now - lastAt < cooldownMs) return false;
  return true;
}
export function shouldAttemptRegrant({ fixed, streak, needPx, framePx, now, lastAt, cooldown }) {
  // 固定 scale 不发重取；旧 Host 缺字段时继续走自适应。
  if (fixed === true) return false;
  return decideRegrant(streak, needPx, framePx, now, lastAt, cooldown);
}
export function widthIsUnsettled(prevPx, needPx) {
  return prevPx > 0 && Math.abs(needPx - prevPx) > REGRANT_STABLE_PX;
}
export function tickRegrant({ fixed, streak, prevPx, needPx, framePx, now, lastAt, cooldown }) {
  // 拖拽未稳定时清空持续计时，避免动画中间反复重建流。
  if (widthIsUnsettled(prevPx, needPx)) {
    streak.direction = "none";
    streak.since = 0;
    return false;
  }
  return shouldAttemptRegrant({ fixed, streak, needPx, framePx, now, lastAt, cooldown });
}
export function neededPixelWidth(cssWidth, dpr, deviceWidth) {
  if (!(cssWidth > 0) || !(dpr > 0)) return 0;
  const raw = Math.round(cssWidth * dpr);
  if (!(raw > 0)) return 0;
  const limit = deviceWidth > 0 ? deviceWidth : DEVICE_WIDTH_FALLBACK;
  return Math.min(raw, limit);
}
