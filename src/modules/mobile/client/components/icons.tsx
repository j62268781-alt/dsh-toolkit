export function createIcons(React) {
  const h = React.createElement;
  // 入口 artwork 用固定蓝；tab 图标使用 currentColor 和更紧凑的留白。
  const ARTWORK_BLUE = "#539CFA";
  function MobileArtwork({ size = 36, className, color = ARTWORK_BLUE, dense = false }) {
    const BOX = 36;
    const fill = dense ? 0.761 : 0.564;
    const strokeWidth = BOX * (dense ? 1 / 16 : 2 / 36);
    const bodyHeight = BOX * fill;
    const bodyWidth = bodyHeight * 0.47;
    const center = BOX / 2;
    const top = center - bodyHeight / 2;
    return <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      fill="none"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      {
        /* 机身 */
      }
      <rect
        x={center - bodyWidth / 2}
        y={top}
        width={bodyWidth}
        height={bodyHeight}
        rx={bodyWidth * 0.22}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {
        /* 底部指示条：小尺寸下比一个圆点更容易认出是手机 */
      }
      <path
        d={`M${center - bodyWidth * 0.22} ${top + bodyHeight * 0.86}H${center + bodyWidth * 0.22}`}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>;
  }
  function makeIcon(name, children) {
    const Icon = ({ size = 16, className }) => <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children.map(([Tag, attributes], index) => <Tag key={index} {...attributes} />)}
    </svg>;
    Icon.displayName = name;
    return Icon;
  }
  const IconHome = makeIcon("IconHome", [
    ["path", { d: "M2.6 6.9 8 2.6l5.4 4.3" }],
    ["path", { d: "M3.7 6.5v6.1c0 .5.4.9.9.9h6.8c.5 0 .9-.4.9-.9V6.5" }]
  ]);
  const IconBack = makeIcon("IconBack", [
    ["path", { d: "M13 8H3.5" }],
    ["path", { d: "M6.9 4.6 3.5 8l3.4 3.4" }]
  ]);
  const IconRotate = makeIcon("IconRotate", [
    ["path", { d: "M13.1 8A5.1 5.1 0 1 1 11.5 4.2" }],
    ["path", { d: "M13.3 2.7v3.2h-3.2" }]
  ]);
  const IconRefresh = makeIcon("IconRefresh", [
    ["path", { d: "M2.9 8a5.1 5.1 0 1 1 1.6 3.8" }],
    ["path", { d: "M2.7 13.3v-3.2h3.2" }]
  ]);
  const IconFrame = makeIcon("IconFrame", [
    ["rect", { x: 4.5, y: 1.9, width: 7, height: 12.2, rx: 1.5 }],
    ["path", { d: "M6.9 12.2h2.2" }]
  ]);
  const IconFrameNone = makeIcon("IconFrameNone", [
    ["rect", { x: 4.5, y: 1.9, width: 7, height: 12.2, rx: 1.5, strokeDasharray: "2 1.5" }],
    ["path", { d: "M6.9 12.2h2.2" }]
  ]);
  return { MobileArtwork, IconHome, IconBack, IconRotate, IconRefresh, IconFrame, IconFrameNone };
}
