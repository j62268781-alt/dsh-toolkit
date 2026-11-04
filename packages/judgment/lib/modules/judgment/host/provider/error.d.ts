/**
 * 类型化失败的运行期形态。
 *
 * `contract` 里 `JudgmentError` 只是**形状**（契约零运行时值，§13.9）；
 * 运行期的类与类型守卫属于根入口这一侧。`implements` 把两侧钉在一起：
 * 契约改形状，这里编译报错。
 */
import type { Fingerprint, JudgmentError as JudgmentErrorShape, JudgmentErrorCode, JudgmentFailure, JudgmentPhase, JudgmentUsage, ValidationFailure } from '../contract/index.js';
/** provider 只抛这个类；`abstain` 不走异常（它是答案的一种）。 */
export declare class JudgmentError extends Error implements JudgmentErrorShape {
    readonly name: "JudgmentError";
    readonly code: JudgmentErrorCode;
    readonly phase: JudgmentPhase;
    readonly retryable: boolean;
    readonly validation?: ValidationFailure;
    readonly fingerprint?: Fingerprint;
    readonly usage?: JudgmentUsage;
    constructor(failure: JudgmentFailure & {
        fingerprint?: Fingerprint;
        usage?: JudgmentUsage;
    });
}
export declare function isJudgmentError(value: unknown): value is JudgmentError;
/** 把任意抛出物收敛成契约的失败形状；非类型化失败一律归到 `internal`。 */
export declare function failureOf(error: unknown): JudgmentFailure;
//# sourceMappingURL=error.d.ts.map