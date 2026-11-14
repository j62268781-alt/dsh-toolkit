import type { ContextFormed } from '@deepseek-ai/dsh-llm';
import type { HookHistory } from './history.js';
import type { HookStore, HookView } from './files.js';
import type { HookRunRequest, HookRunResult } from './exec.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dsh-toolkit-hooks': {
            kind: 'dsh-toolkit-hooks';
        } & ContextFormed;
    }
}
export interface HookRuntimeOptions {
    store: HookStore;
    history: HookHistory;
    enabled: () => boolean;
    /** hook 进程的工作目录与 `cwd` 载荷字段（固定目录的旧接口，测试与无会话场景用）。 */
    cwd?: () => string;
    /**
     * 按会话解析项目目录。桌面端 DSH 的 `process.cwd()` 是安装目录，项目级 hooks 必须
     * 跟着会话的 working directory 走，所以每个事件都按自己的 agent 求值一次。
     */
    directory?: (agent?: any) => string;
    env?: () => NodeJS.ProcessEnv;
    logger?: {
        warn(message: string): void;
    };
    /** 默认走真子进程；测试里换掉它就能只验证事件映射与决策转换。 */
    execute?: (request: HookRunRequest) => Promise<HookRunResult>;
}
export declare function createHookRuntime(ctx: any, options: HookRuntimeOptions): {
    /** 面板的「试跑」：按当前配置里的条目跑一次，不参与决策。 */
    runTest(hook: HookView, payload: Record<string, unknown>): Promise<HookRunResult>;
};
//# sourceMappingURL=runtime.d.ts.map