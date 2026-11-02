/**
 * 一次真实发包。**恰好一次**——provider 不静默重试（"重试 = 新采样"，§10.2），
 * 所以每次调用的计量与审计记录都精确对应一次网络往返。
 *
 * 传输层只负责三件事：超时/取消、HTTP 状态 → 类型化失败、JSON 解析。
 * 线格式与响应校验分别在 `system-one.ts` 与 `request.ts`。
 */
export interface DispatchInput {
    /** 归一化后的端点（不含凭据、query、hash）。 */
    readonly url: string;
    readonly body: unknown;
    /** 密钥明文，只进请求头；**永不进错误信息**（§13.2）。 */
    readonly credential: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
}
export interface DispatchOutput {
    readonly status: number;
    readonly body: unknown;
    readonly rawText: string;
}
/** 发一封信，拿回状态与 JSON 体；任何失败都抛类型化 `JudgmentError`。 */
export declare function dispatch(input: DispatchInput): Promise<DispatchOutput>;
//# sourceMappingURL=dispatch.d.ts.map