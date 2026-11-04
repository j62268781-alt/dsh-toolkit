/**
 * 多协议归一化的**共用核心**：容差、严格校验的判据、以及"信号/计量"的解码。
 *
 * 为什么单独一个文件：两套协议（SystemOne 的 `noul` 与 OpenAI-Decisions 的 `predicate`）
 * 的**线格式不同**（一个用对象装分布、一个用数组），但**校验纪律完全相同**。
 * 契约明确警告过"留给消费者就会出现多份实现并必然漂移"（§13.2），所以容差与判据只允许
 * 有一份。协议模块只负责"把各自的线格式翻译成这里的判据"。
 */
import type { JudgmentAnswer, JudgmentJson, Probability, ValidationFailure, ValidationRule } from '../contract/index.js';
/** 容差定稿：`|Σp − 1|` 与 argmax 容差（契约 `ValidationTolerance` 的运行期对应物）。 */
export declare const NORMALIZATION_TOLERANCE = 0.02;
export declare const ARGMAX_TOLERANCE = 0.000001;
/** 严格校验失败。Service 把它转成 `invalid-response`（整批拒绝，不修复）。 */
export declare class ResponseRejected extends Error {
    readonly validation: ValidationFailure;
    readonly name = "ResponseRejected";
    constructor(validation: ValidationFailure);
}
export interface DecodedUsage {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
}
/** 一套协议解码出一批答案后的**归一化结果**：所有协议都收敛到这个形状。 */
export interface DecodedResponse {
    readonly answers: Record<string, JudgmentAnswer>;
    /** 响应返回的模型快照（协议回显时是快照，不回显时见各协议模块的说明）。 */
    readonly model: string;
    readonly usage?: DecodedUsage;
    /** 上游的请求 id（有的话），供审计 ledger 对齐。 */
    readonly requestId?: string;
}
/** 一批响应里可选的信号，原样透传（协议没给就**绝不合成**，§13.2 铁律）。 */
export interface DecodedSignals {
    readonly confidence?: Probability;
    readonly legend?: JudgmentJson;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function isProbability(value: unknown): value is Probability;
/**
 * 可选的结构化数值，随 {@link ValidationFailure} 一起交给消费者。
 *
 * 为什么不只给字符串：消费者要做的是**确定性决策**（缩到多少候选重采），
 * 从 `detail` 里正则抠数字既脆又等价于让每个消费者各写一份解析。
 */
export interface ValidationNumbers {
    readonly optionCount?: number;
    readonly sum?: number;
    readonly tolerance?: number;
}
export declare function reject(rule: ValidationRule, detail: string, questionId?: string, numbers?: ValidationNumbers): never;
/**
 * 分布校验：键集合必须与候选/级别完全一致、每个都是 [0,1] 的概率、Σp = 1（容差 0.02）；
 * 对 choice 另查"选中的候选必须是众数"（容差 1e-6）。
 *
 * `values` 是协议模块翻译后的 `键 → 概率` 映射（键序按 `allowed` 重新输出）。
 */
export declare function validateDistribution(values: ReadonlyMap<string, unknown>, allowed: readonly string[], questionId: string, argmaxOf?: string): Record<string, number>;
/**
 * 模型快照校验。
 *
 * 响应里的 `model` 必须是非空字符串；与配置**逐字相同**才算通过——唯一的例外是配置用了
 * 移动别名（`…-latest`），那时允许快照落到具体版本上（§13.4：pin 并记录快照）。
 */
export declare function decodeModel(value: unknown, expected: string): string;
/** `confidence` / `legend` 原样透传；协议没给就绝不合成。 */
export declare function decodeSignals(source: Record<string, unknown>, questionId: string, options?: {
    readonly requireConfidence?: boolean;
}): DecodedSignals;
/** 可 JSON 序列化且有限的载荷（与契约 `JudgmentJson` 同构的运行时判据）。 */
export declare function isJsonValue(value: unknown): boolean;
/** 计量：缺项即"未知"，**不当作 0**；非法计数直接忽略并让 `complete` 报 false。 */
export declare function decodeUsage(value: unknown): DecodedUsage | undefined;
/**
 * 独立于答案校验地读出已知计数。
 *
 * 用途：响应被严格校验拒绝时，这次调用**钱已经花了**，计量必须留住（§12.5 的
 * `knownUsage` 纪律——拒绝响应时仍保留 usage）。
 */
export declare function knownUsage(raw: unknown): DecodedUsage | undefined;
//# sourceMappingURL=wire.d.ts.map