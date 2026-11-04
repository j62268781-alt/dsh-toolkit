/**
 * 快照指纹：`hash(规则版本 + 脱敏版本 + 连接身份 + 请求体)`。
 *
 * 直接抄 `dsh-jev-plugin` 的「指纹三件套」（§12.5），不重写：规则或脱敏版本一变，
 * 旧指纹自然作废。**不含**本次尝试的血缘（`inputVersion` 属于 ledger，不属于指纹），
 * 所以执行侧算出的指纹与答案携带的指纹可以逐字比较（不变量 1，§10.2）。
 *
 * 纯本地、同步、零 I/O：不读凭据明文、不发网络请求。
 */
import type { Fingerprint, JudgmentQuestions, JudgmentState } from '../contract/index.js';
/** 规则版本：判定规则或校验容差变化时必须递进。 */
export declare const RULE_VERSION = "judgment-v1";
/** 脱敏版本：送出去的状态经过哪些脱敏处理。 */
export declare const REDACTION_VERSION = "none-v1";
/** 进入指纹的连接身份（协议身份必须在内，§12.6）。 */
export interface FingerprintIdentity {
    readonly connection: string;
    readonly protocol: string;
    readonly baseUrl: string;
    readonly model: string;
}
export declare function fingerprint(identity: FingerprintIdentity, state: JudgmentState, questions: JudgmentQuestions): Fingerprint;
//# sourceMappingURL=fingerprint.d.ts.map