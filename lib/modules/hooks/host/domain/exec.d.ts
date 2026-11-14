export type HookDecision = 'allow' | 'deny' | 'ask';
export interface HookRunResult {
    decision: HookDecision;
    reason: string;
    additionalContext: string[];
    code: number | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
    error: string;
}
export interface HookRunRequest {
    /** 本次运行归属的事件名（只用于解码提示与历史记录）。 */
    event: string;
    command: string;
    timeoutMs: number;
    payload: Record<string, unknown>;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    platform?: NodeJS.Platform;
    now?: () => number;
}
/** 把一条命令交给平台 shell：POSIX 用 `sh -c`，Windows 用 `cmd.exe /d /s /c`。 */
export declare function shellInvocation(command: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): {
    command: string;
    args: string[];
};
/**
 * 解码一次运行结果。`event` 只影响提示文案（Stop 的 `block` 读作「继续」）。
 */
export declare function decodeHookRun(event: string, run: {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError?: Error;
}): Pick<HookRunResult, 'decision' | 'reason' | 'additionalContext' | 'error'>;
export declare function runHookCommand(request: HookRunRequest): Promise<HookRunResult>;
export interface MergedHookOutcome {
    decision: HookDecision;
    reason: string;
    additionalContext: string[];
}
/** 多条 hook 的决策合并：拒绝 > 询问 > 放行，上下文按顺序拼接。 */
export declare function mergeHookOutcomes(runs: readonly HookRunResult[]): MergedHookOutcome;
//# sourceMappingURL=exec.d.ts.map