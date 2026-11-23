export interface StarPoint {
    x: number;
    y: number;
}
/**
 * 沿 `d` 的轮廓按弧长均匀取 `count` 个星点，返回 viewBox 坐标。
 * 每颗星在均分位置上带 ±21% 间距的抖动、每条轮廓有随机相位，避免看起来像
 * 一条机械的虚线；`random` 由调用方注入，同一 seed 必得同一张星图。
 */
export declare function sampleMarkOutline(d: string, count: number, random: () => number): StarPoint[];
