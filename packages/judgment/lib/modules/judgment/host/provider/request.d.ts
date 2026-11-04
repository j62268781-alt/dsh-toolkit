/**
 * 发包前的请求校验：**零成本拒绝**——不合规的请求不该花掉一次网络往返。
 *
 * 规则清单见契约的 `ValidationRule`。这里只产出结构化的 `ValidationFailure`，
 * 由 Service 包成 `invalid-request`（`ask`）或写进 `health().failure`。
 * **失败即拒、绝不"修复"**（§9.5）。
 */
import type { JudgmentQuestions, JudgmentState, ValidationFailure } from '../contract/index.js';
import { isJsonValue as isJson } from './wire.js';
export { isJson };
/** 协议硬边界（与契约 `JudgmentLimits` 同源；改这里必须同时改契约的文档）。 */
export declare const LIMITS: {
    readonly choiceOptions: {
        readonly min: 2;
        readonly max: 255;
    };
    readonly scoreLevels: {
        readonly min: 2;
        readonly max: 10;
    };
};
/** 校验一批问题；返回第一个失败，全部通过则返回 undefined。 */
export declare function validateRequest(state: JudgmentState, questions: JudgmentQuestions): ValidationFailure | undefined;
//# sourceMappingURL=request.d.ts.map