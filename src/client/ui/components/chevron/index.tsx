/**
 * 展开/收起的 chevron。
 *
 * 设置页里 skills & mcp 的卡片、钩子面板的事件行等都要这一枚图标，尺寸/描边/收起时
 * 转向右的规则完全一样，所以只留这一份实现——各面板不再各自 hand-write `<svg>`。
 * 颜色交给 `.sk-ui-chevron`（三级灰），`data-open=false` 时 -90° 指向右侧。
 */
export interface ChevronProps {
  open?: boolean;
  className?: string;
  size?: number;
}

export function Chevron({ open, className = "sk-ui-chevron", size = 16 }: ChevronProps) {
  return (
    <svg
      className={className}
      data-open={String(open === true)}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
