/**
 * `src/task/utils.ts`：纯工具方法（签名哈希、快照 diff、键名/词元解析、文本截断）。
 */
import type { Snapshot } from '../cli.js';
import { type LastChange, type TaskCandidate } from './types.js';
/** 小而不依赖 crypto 的稳定哈希（FNV-1a 32 位）：只用来比较"变没变"。 */
export declare function stableHash(text: string): string;
/** 交互结构指纹：origin + 所有 ref 的 role/name（排序后）。 */
export declare function interactionSignature(snapshot: Snapshot): string;
/** 页面"真的变了"吗：交互结构变了，或者文本实质变化（Jaccard 相似度 < 0.93）。 */
export declare function stateChanged(before: Snapshot, after: Snapshot): boolean;
/** 页面语义状态签名：无障碍角色 + 可访问名 + 压缩后文本哈希，忽略 ref 编号这类易变的标记。 */
export declare function stateSignature(snapshot: Snapshot): string;
/** 两份候选快照的语义 diff（纯函数，可单测）。 */
export declare function diffCandidates(before: readonly TaskCandidate[], after: readonly TaskCandidate[], beforeText: string, afterText: string, beforeOrigin: string, afterOrigin: string): LastChange | undefined;
/** 字段名归一：小写 + 下划线/连字符/多余空白都当空格。 */
export declare function fieldName(value: string): string;
/** goal 里用于相关性的词（ASCII 词 + 中文 2 字 n-gram）。 */
export declare function goalTokensOf(goal: string): string[];
/** 轻量英文词干归一（复数/时态还原），不引入外部依赖。 */
export declare function stemToken(token: string): string[];
/**
 * 用于候选相关性排序的扩展目标词（过滤虚词 + 英文词干 + 跨语言 UI 同义词）。
 */
export declare function expandedGoalTokensOf(goal: string): string[];
/** ASCII 词按词边界匹配（`text` 不命中 `Textarea`），中文按子串匹配。 */
export declare function hasTokenBoundary(haystack: string, token: string): boolean;
/**
 * goal 是否点名了这个字段名：ASCII 词按词边界匹配（`text` 不命中 `Textarea`），
 * 中文按子串；排除 `the`/`and` 等虚词（避免 "walk the dog" 因 "the" 命中任何含 "the" 的目标）。
 */
export declare function goalMentions(name: string, goal: string): boolean;
/** 目标里点名要按的键（press Escape / 按 Enter / 按 Control+a）。 */
export declare function keysWantedByGoal(goal: string): string[];
/** 白名单：只认真实键盘键名。 */
export declare function normalizeKey(raw: string): string | undefined;
/** 目标是不是要"悬停/鼠标移上去"。 */
export declare function wantsHover(goal: string): boolean;
/** 目标是不是要"拖拽"。 */
export declare function wantsDrag(goal: string): boolean;
/** 去掉 `--content-boundaries` 加的包裹。 */
export declare function stripContentBoundaries(text: string): string;
export declare function truncate(text: string, limit: number): string;
/** 长文本截断：保留开头 + 结尾。 */
export declare function clipHeadTail(text: string, cap: number): string;
export { sleep } from '../../../../host/time.js';
/** 毫秒级计时（分项账用）。 */
export declare const now: () => number;
export declare function message(error: unknown): string;
//# sourceMappingURL=utils.d.ts.map