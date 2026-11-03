/**
 * 入口 `"."`：组件 `judgment/provider`，注册 `ctx.judgment`。
 *
 * **零工具**（§13.5）——工具面是另一个组件 `judgment/llm-face`，默认关，首版不做。
 * provider 只做四件"单例"事：凭据、多协议归一化、严格校验、审计与计量；加了指纹。
 * 它不观察、不枚举、不寻址、不门控、不做 fallback、不碰 loop（§13.2「绝不」列）。
 *
 * 里程碑：
 * - M2：Service 注册、两层配置解析、`status()`、`fingerprint()`（纯本地）。
 * - M3（当前）：**SystemOne 协议层跑通**——`ask()` / `health()` 真的发包。
 *   线格式来自 §13.7 的 P0′ 探针实测（`provider/system-one.ts` 顶部记了原样固件）。
 *   仍待：严格校验之外的计量/审计 ledger（现在 usage 只在返回值里）、
 *   `openai-decisions`（`predicate`）协议、工具面。
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { ApiVersion, AskOptions, Fingerprint, FingerprintOptions, HealthOptions, Judge, JudgeHealth, JudgeStatus, JudgmentQuestions, JudgmentResult, JudgmentState } from './contract/index.js';
import { type JudgmentConfig } from './config.js';
export { Config } from './config.js';
export { JudgmentError, isJudgmentError } from './provider/error.js';
export { NORMALIZATION_TOLERANCE, ARGMAX_TOLERANCE } from './provider/wire.js';
export { PROTOCOLS, implementedProtocols } from './provider/protocols.js';
export type { JudgmentConfig, ConnectionConfig, PurposeConfig, Connections, Purposes } from './config.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** 结构化判断能力。它判断，消费者决定（§13.1）。 */
        judgment: JudgmentService;
    }
}
/** 契约版本：与 contract 的 `ApiVersion` 对齐（消费者本地 `EXPECTED` 也写 1）。 */
export declare const API_VERSION: ApiVersion;
export declare class JudgmentService extends TypertRemoteService implements Judge {
    private readonly config;
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        connections: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            protocol?: string | null | undefined;
            baseUrl?: string | null | undefined;
            model?: string | null | undefined;
            credentialRef?: string | null | undefined;
            timeoutMs?: number | null | undefined;
            quota?: ({
                callsPerHour?: number | null | undefined;
                inputTokensPerHour?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        purposes: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            connection?: string | null | undefined;
            quota?: ({
                callsPerHour?: number | null | undefined;
                inputTokensPerHour?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        defaultConnection: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        ledger: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        connections: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            protocol?: string | null | undefined;
            baseUrl?: string | null | undefined;
            model?: string | null | undefined;
            credentialRef?: string | null | undefined;
            timeoutMs?: number | null | undefined;
            quota?: ({
                callsPerHour?: number | null | undefined;
                inputTokensPerHour?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            protocol: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            baseUrl: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            model: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            credentialRef: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        purposes: import("@deepseek-ai/schemastery").default<NoInfer<import("@deepseek-ai/cosmokit").Dict<{
            connection?: string | null | undefined;
            quota?: ({
                callsPerHour?: number | null | undefined;
                inputTokensPerHour?: number | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict, string>>, NoInfer<import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
            connection: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            quota: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, Schemastery.ObjectT<NoInfer<{
                callsPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
                inputTokensPerHour: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            }>>, "defined">;
        }>>, string>>, "volatile-defined">;
        defaultConnection: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
        ledger: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            path: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, "plain">;
    readonly apiVersion: ApiVersion;
    /**
     * 最近一次从凭据服务读到的"是否已设值"快照（`status()` 是同步的，不能做 I/O）。
     * 由 `health()` / `ask()` 刷新；只存布尔，永不存密钥值（§13.2）。
     */
    private readonly credentialPresent;
    /** 最近一次 `health()` **成功**的连接 → 时刻（ISO 8601）。`status()` 据此报 `verified`。 */
    private readonly verified;
    /** 审计 ledger（按配置签名缓存：路径或开关一变就换一个实例）。 */
    private ledger;
    private ledgerSignature;
    constructor(ctx: Context, config: JudgmentConfig);
    /**
     * 启动时**播种**一次"凭据是否已设值"的快照（只存在性，不读值）。
     *
     * 为什么需要：`status()` 同步零 I/O，只能读内存快照；而用户在页面上填密钥是
     * **直接写凭据服务**的，本 Service 收不到通知。若只在 `ask()` / `health()` 里刷新，
     * "刚配好、还没调用过"时 `credentialPresent` 会一直是 `false`——
     * 真机复现过：一条**实际可用**的连接被显示成"未配置"，并连带把依赖它的
     * 用途判成不可用（消费方据此拒绝开启功能，属于**假否定**）。
     *
     * 失败时**不写 false**：凭据服务暂时不可用时保持"未知"，别再制造一个假否定。
     */
    [Service.init](): Promise<void>;
    /**
     * 解析 用途/连接 → 连接层条目。
     *
     * **未知用途绝不静默换连接**（§13.3 第 4 项：降级必须显式可见）；
     * 没指定连接时：`defaultConnection` 优先；为空则取**配置顺序的第一条**（用户不需要再指定一次）。
     */
    private resolve;
    /** 解析凭据明文。**只在发包这一刻取**，绝不缓存值、绝不写日志（§13.2）。 */
    private readCredential;
    /**
     * 计量。缺项**不当作 0**：`complete` 明确告知计数是否完整。
     * 网关没有公布价目，所以 `estimatedCostUsd` 省略——**不填 0**（§12.5）。
     */
    private usageOf;
    /**
     * 本地状态快照（零 I/O）：`configured` 与 `remoteVerified` 分开——
     * "本地显示已配置不代表密钥已验证"（§13.3 第 4 项）。
     */
    /**
     * 暴露给设置页：页面刷新后仍能显示「已验证」（这是 host 内存里的记忆，不是实时探测）。
     * 零参数方法 → 客户端调 `status()` 不传参。
     */
    status(): JudgeStatus;
    /**
     * 执行侧的新鲜度原语：动作前比对"当前快照"与产生答案的那个快照（不变量 1）。
     * 纯本地、同步、零 I/O。
     */
    fingerprint(state: JudgmentState, questions: JudgmentQuestions, options?: FingerprintOptions): Fingerprint;
    /**
     * 一次批量判断：**恰好一次请求**，不静默重试（重试是消费者的新采样决策，§10.2）。
     *
     * 顺序即纪律：解析 → 请求侧校验（零成本拒绝）→ 指纹 → 取凭据 → 发包 →
     * 响应严格校验（失败即拒，不修复）→ 组装溯源。
     */
    ask<Q extends JudgmentQuestions>(state: JudgmentState, questions: Q, options?: AskOptions): Promise<JudgmentResult<Q>>;
    /**
     * Atomically check both quota dimensions and reserve any call slots before credential access.
     * Token usage is checked from settled measurements only; it is never forecast.
     */
    private reserveQuota;
    /** ledger 实例按配置缓存（路径/开关变了就换一个）。 */
    private ledgerFor;
    /** 失败也要在账上留一笔（含类型化失败的代码与校验规则、以及校验的实测数值）。 */
    private settleFailure;
    /**
     * 远端健康探测：**真发一次最小请求**（一个问题的一句话判断）。
     *
     * 预期失败以 `ok: false` 返回，不抛异常——"已配置"不等于"已验证"，
     * 探测结果是诊断而不是判断失败（§13.3 第 4 项）。
     */
    health(options?: HealthOptions): Promise<JudgeHealth>;
}
export default JudgmentService;
//# sourceMappingURL=index.d.ts.map