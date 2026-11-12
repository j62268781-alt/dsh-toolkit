/**
 * 弹出卡片的定位数学。
 *
 * 为什么单独抽成一个纯函数：这里只要四个数字（按钮盒、卡片盒、视口），不碰 DOM，
 * 所以能脱离浏览器逐条验证。之前的实现把卡片高度写死成常量 `430`，而卡片真实高度
 * 随登录状态变（未连接 187px、扫码 430px），纵向就再也贴不住按钮了。
 */

/** 卡片与视口边缘的最小间距。 */
export const POPOVER_MARGIN = 8

/**
 * 卡片与按钮**盒子**之间的缝隙。
 *
 * 为什么是 2 而不是 10：按钮盒子（32/36px）比里面的图标（18px）大，图标上下各留
 * 7~9px 的内缩。按盒子留 10px 时，人眼量到的「卡片 → 图标」距离是 17~19px，看起来
 * 卡片离按钮很远。改成 2px 后：codex 36px 盒 9+2≈11px、原生 32px 盒 7+2≈9px，
 * 视觉上正好贴住按钮。
 */
export const POPOVER_GAP = 2

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/**
 * 算出卡片的 fixed 定位。
 *
 * @param {object} input
 * @param {{ top: number, bottom: number, left: number, right: number } | undefined} input.anchor
 *   按钮的 `getBoundingClientRect()` 快照；`undefined` 表示还没量到（退化到左上角）。
 * @param {{ width: number, height: number } | undefined} input.size
 *   卡片的实测尺寸（`getBoundingClientRect()` 的宽高）。
 * @param {{ width: number, height: number }} input.viewport
 * @returns {{ left: number, top: number, maxHeight: number }}
 *   `maxHeight` 是视口内的可用高度上限，卡片比视口高时靠它内部滚动。
 */
export function placePopover({ anchor, size, viewport, gap = POPOVER_GAP, margin = POPOVER_MARGIN }) {
  const width = Math.max(0, size?.width ?? 0)
  const height = Math.max(0, size?.height ?? 0)
  const viewWidth = Math.max(0, viewport?.width ?? 0)
  const viewHeight = Math.max(0, viewport?.height ?? 0)
  const maxHeight = Math.max(0, viewHeight - margin * 2)

  // 量不到锚点（按钮还没挂上/已卸载）：给一个视口左上角的稳定落点，至少不会跑到屏幕外。
  if (anchor === undefined || anchor === null) return { left: margin, top: margin, maxHeight }

  // 横向：卡片左边从按钮的**右**边缘起，卡片整体落在按钮右侧那条竖线上；
  // 这样卡片不会压住按钮所在的侧栏（rail），视觉上是按钮右下角飞出来的一页。
  // 右侧放不下时整体左移，最多退到视口 margin 处（窄窗口下会盖住按钮，但不会越界）。
  const left = clamp(anchor.right, margin, Math.max(margin, viewWidth - margin - width))

  // 纵向：卡片长在按钮**上方**，与按钮之间留 gap。入口贴着侧栏底部，上方才是可用空间。
  // 只有上方连 margin 都放不下（视口被压得很矮、或卡片比上方空间还高）时才翻到按钮下方。
  const above = anchor.top - gap - height
  const placed = above >= margin ? above : anchor.bottom + gap

  // 再夹一次：卡片比视口还高时上一帧的实测高度会让它超出屏幕，此时贴住上边、交给 maxHeight 滚动。
  const top = clamp(placed, margin, Math.max(margin, viewHeight - margin - height))

  return { left, top, maxHeight }
}
