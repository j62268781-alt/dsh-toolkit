/**
 * `src/task/candidates.ts`：候选枚举、按目标相关性排序、特殊动作面（按键/悬停/拖拽）注入。
 */
import type { Snapshot } from '../cli.js';
import { type ExtractedItem } from '../extract.js';
import { type TaskCandidate } from './types.js';
/** 候选预算：先按目标词面与结构信号统一排序，再为输入类保留一个首轮代表位。 */
export declare function headCandidates(clicks: readonly TaskCandidate[], inputs: readonly TaskCandidate[], goal: string): TaskCandidate[];
type GroupRole = 'username' | 'password' | 'submit' | 'search' | 'otp';
/** 从标准输入属性和 form/group 拓扑推导角色，不读取候选名称或附近文案。 */
export declare function inferGroupRoles(items: readonly ExtractedItem[]): ReadonlyMap<number, GroupRole>;
/** 页面内抽取（`extract()`）→ 候选：句柄 + 角色 + 名字 + 同簇/同控件序号，遮挡的默认不进池。 */
export declare function candidatesFromExtracted(items: readonly ExtractedItem[], goal?: string): TaskCandidate[];
/** 紧凑结构大纲：仅保留角色/物理类型/重复数量，不复制 action options 的文案。 */
export declare function groupOutlineOf(candidates: readonly TaskCandidate[]): string;
/**
 * 按弱词面信号与 DOM 结构排序（不推断自然语言意图）：
 * 1. goal 与候选原文的通用 token 重合仅作为软排序；
 * 2. 标准 role、物理输入槽位与 2–6 控件分组提供语言无关的结构先验；
 * 3. 主内容区、禁用状态和重复组多样性用于抑制噪声，不决定目标语义。
 */
export declare function rankByGoal<T extends TaskCandidate>(list: readonly T[], goal: string): T[];
/** 快照 → 候选。文本输入字段单独标注 `input:*`（让循环知道该交回宿主）。 */
export declare function candidatesOf(snapshot: Snapshot, goal?: string): TaskCandidate[];
/**
 * 目标明确"把「某商品」加入购物车"、且页面上恰好一个 add-to-cart 控件的
 * 名字/上下文对得上目标 → 返回它（确定性动作，不猜）。
 */
export declare function addToCartTarget(goal: string, candidates: readonly TaskCandidate[]): TaskCandidate | undefined;
/**
 * 动作面注入：goal 点名要按的键 / 悬停 / 拖拽 → 注入候选。
 *
 * 当目标明确要求 hover 或 drag 时，把注入的 `hover:*` / `drag:*` 排在候选最前，
 * 避免被 `JUDGE_OPTION_CAP = 10` 截掉或排在普通 `click` 后面（真机 ti-hover / drag）。
 */
export declare function withActionCandidates(base: readonly TaskCandidate[], goal: string, step: number, trace: string[]): TaskCandidate[];
export {};
//# sourceMappingURL=candidates.d.ts.map