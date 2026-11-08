/**
 * 弹出卡片的定位数学。
 *
 * 为什么单独抽成一个纯函数：这里只要四个数字（按钮盒、卡片盒、视口），不碰 DOM，
 * 所以能脱离浏览器逐条验证。之前的实现把卡片高度写死成常量 `430`，而卡片真实高度
 * 随登录状态变（未连接 187px、扫码 430px），纵向就再也贴不住按钮了。
 */

/** 卡片与视口边缘的最小间距。 */
export const POPOVER_MARGIN = 8

/** 卡片与按钮之间的横向缝隙。 */
export const POPOVER_GAP = 10

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

  // 横向：默认贴在按钮右侧；右侧放不下就翻到按钮左侧；两边都不够时夹在视口内（宁可与按钮重叠）。
  const atRight = anchor.right + gap
  const atLeft = anchor.left - gap - width
  const flipped = atRight + width > viewWidth - margin && atLeft >= margin
  const left = clamp(
    flipped ? atLeft : atRight,
    margin,
    Math.max(margin, viewWidth - margin - width),
  )

  // 纵向：卡片底边与按钮底边对齐。入口固定在侧栏底部，向下展开必然出屏，只能往上长；
  // 高度取实测值，所以登录状态切换（卡片长高/变矮）后依然贴着。
  const top = clamp(anchor.bottom - height, margin, Math.max(margin, viewHeight - margin - height))

  return { left, top, maxHeight }
}