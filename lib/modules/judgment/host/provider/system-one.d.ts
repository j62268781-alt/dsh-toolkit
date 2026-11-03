/**
 * TypeSafe **SystemOne**（协议里的 `noul`）线格式：编码 + 严格解码。
 *
 * 线格式不是猜的，是 P0′ 探针实测确定的（`tests/protocol.test.mjs` 里的固件就是
 * 真实端点回的原样 JSON）：
 *
 * ```jsonc
 * // 请求：POST <baseUrl>，Authorization: Bearer <key>
 * { "model": "decision-model-preview", "state": <Json>,
 *   "questions": { "<id>": { "type": "noul", "instructions": "...", "criteria": {"true": "…", "false": "…"} },
 *                  "<id>": { "type": "choice", "instructions": "...", "criteria": { "<optionId>": "说明" } },
 *                  "<id>": { "type": "score", "instructions": "...", "criteria": ["很小", "一般", "很大"] } } }
 *
 * // 响应：
 * { "model": "decision-model-preview",
 *   "answers": { "<id>": { "type": "noul", "noul": 0.98 },
 *                "<id>": { "type": "choice", "choice": "a2", "confidence": 0.18, "probabilities": {"a0":0.35,"a1":0.19,"a2":0.46} },
 *                "<id>": { "type": "score", "score": 0.84, "legend": {"0":"很小","1":"一般","2":"很大"},
 *                          "probabilities": {"0":0.45,"1":0.26,"2":0.29}, "confidence": 0.58 } },
 *   "usage": { "input_tokens": 99, "output_tokens": 0 }, "request_id": "…", "latency_ms": 53.2 }
 * ```
 *
 * 实测要点（写进契约的三条校准）：
 * - `score` 是**连续位置**（= 级别分布的期望值 `Σ i·p_i`，实测 0.84 / 1.42 / 1.09），不是整数下标；
 * - `noul` 不带 `confidence`，`confidence`/`legend` 都**绝不合成**（协议没给就留空）；
 * - `state` 可以是纯字符串，不限于对象。
 *
 * 解码**失败即拒**：结构非法一律抛 {@link ResponseRejected}（整批拒绝，不修复），
 * 而"结构合法地没有判断"（`null` 答案 / `type:'refusal'`）是 `abstain` **值**，不是异常。
 */
import type { JudgmentQuestions, JudgmentState } from '../contract/index.js';
import { ARGMAX_TOLERANCE, NORMALIZATION_TOLERANCE, ResponseRejected, knownUsage, type DecodedResponse, type DecodedUsage } from './wire.js';
export { ARGMAX_TOLERANCE, NORMALIZATION_TOLERANCE, ResponseRejected, knownUsage };
export type { DecodedResponse, DecodedUsage };
/** 一批问题 → SystemOne 请求体。 */
export declare function encodeBody(model: string, state: JudgmentState, questions: JudgmentQuestions): Record<string, unknown>;
/** 严格解码一整批答案：任何结构问题都整批拒绝。 */
export declare function decodeResponse(raw: unknown, questions: JudgmentQuestions, expectedModel: string): DecodedResponse;
//# sourceMappingURL=system-one.d.ts.map