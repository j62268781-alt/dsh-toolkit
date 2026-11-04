/**
 * `src/task/loop.ts`：有界决策主循环（`runTask`）与有序子目标编排（`runSubgoals`）。
 *
 * 核心原则：
 * 1. **确定性门控优先**：URL 命中、弹层关闭、加购变成 Remove、下拉项命中、勾选态全部达成、填值生效，直接收尾为 `needs_verification`。
 * 2. **Jev 只做候选排序**：不猜文字，不越过安全门。
 * 3. **Jev 搞不定就干净、早停交回上游 LLM**：
 *    - 首选动作无效且次优候选概率 < `ALTERNATE_MIN_PROBABILITY`（0.25）→ 不乱点破坏现场，立即交回；
 *    - 所有交回状态（`ambiguous` / `no_progress` / `blocked` / `page_error` / `budget` / `input_required`）
 *      统一附带现场 `candidates`（含 `ref`）与 `pageText`，让上游 LLM 无需再调一次 `browser_snapshot` 即可直接用 `browser_act` 接管。
 */
import { type TaskDeps, type TaskResult, type TaskSubgoal } from './types.js';
export declare function runTask(goal: string, deps: TaskDeps): Promise<TaskResult>;
/** 顺序执行调用方明确给出的子目标。 */
export declare function runSubgoals(goal: string, subgoals: readonly TaskSubgoal[], deps: TaskDeps): Promise<TaskResult>;
//# sourceMappingURL=loop.d.ts.map