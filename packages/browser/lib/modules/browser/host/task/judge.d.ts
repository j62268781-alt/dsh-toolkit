/**
 * `src/task/judge.ts`：Jev 判断层问题构造、调用封装、二阶段选值与独立确认。
 */
import type { Judge, JudgmentAnswer, JudgmentQuestions } from '../../../judgment/host/contract/index.js';
import type { Snapshot } from '../cli.js';
import { type LastChange, type TaskCandidate, type TaskDeps, type ValidationNumbers } from './types.js';
/** 值 → 给判断层看的描述（敏感值只给名字）。 */
export declare function valueOptionDescription(key: string, value: string): string;
/** 这个字段该用哪个调用方给的值？（有多个候选值时由判断层选） */
export declare function valueQuestionOf(inputs?: Readonly<Record<string, string>>): {
    kind: 'choice';
    prompt: string;
    options: Record<string, string>;
} | undefined;
/** 原生 select 的二阶段问题：调用方没给值时，让判断层在选项标签里选一个。 */
export declare function selectOptionQuestion(field: string, goal: string, options: readonly {
    readonly label: string;
    readonly value: string;
}[]): {
    kind: 'choice';
    prompt: string;
    options: Record<string, string>;
};
/** 候选 → 一个批次的问题。状态随这批问题只问一次（dsh-judgment §1.2 的批量经济学）。 */
export declare function questionsOf(goal: string, candidates: readonly TaskCandidate[], inputs?: Readonly<Record<string, string>>, options?: {
    hasLastChange?: boolean;
    askTargetMatch?: boolean;
}): JudgmentQuestions;
/** 一次判断：优先按用途问；用途没配置就退回默认连接。 */
export declare function askJudge(judge: Judge, state: Parameters<Judge['ask']>[0], questions: Parameters<Judge['ask']>[1], purpose: string, trace?: string[]): Promise<Awaited<ReturnType<Judge['ask']>>>;
/** 二阶段选选项：返回要执行的值（value 优先，空 value 用 label）。 */
export declare function pickSelectOption(judge: Judge, deps: TaskDeps, goal: string, candidate: TaskCandidate, snapshot: Snapshot, step: number, usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
}, trace: string[]): Promise<string | undefined>;
/**
 * 独立确认：拿页面可见正文再问一次"目标要求的最终结果真的看得见吗"。
 * 注意：上一步若是 `control:*`（如 `control:press_enter`），它是键盘/浏览器控制项而非页面元素，
 * 不问 `target_match`（否则模型会因为"Enter 键不是目标条目"而误否决确认，见 wiki-search / todomvc-fine）。
 */
export declare function confirmGoal(judge: Judge, deps: TaskDeps, snapshot: Snapshot, goal: string, usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
}, trace: string[], context?: {
    lastAction?: string;
    lastActionDescription?: string;
    lastChange?: LastChange;
    existingPageText?: string;
    existingPageTitle?: string;
}): Promise<{
    confirmed: boolean;
    probability: number;
}>;
/** dsh-judgment 的「响应结构不合法」错误：只换一次采样，不修复答案本身。 */
export declare function isInvalidResponse(error: unknown): boolean;
export declare function validationOf(error: unknown): ValidationNumbers;
/** 下一次重采用多少个候选。 */
export declare function nextJudgeOptionCap(error: unknown, askedCount: number): number;
export type { JudgmentAnswer };
//# sourceMappingURL=judge.d.ts.map