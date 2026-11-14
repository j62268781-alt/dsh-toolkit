/**
 * 三条只读/低风险路由：读快照、重读配置、试跑一条 hook。
 *
 * 快照把「文件状态 + 合并后的条目 + 静态诊断 + 最近执行」一次给全，面板不需要再拼接口；
 * 试跑是给用户自己验证命令用的——面板上验证一条 hook 能不能跑，比去翻日志快得多。
 */
import type { JsonRouteSpec } from '../../../../host/routes.js';
import type { HookHistory } from '../domain/history.js';
import type { HookStore } from '../domain/files.js';
export interface HookRouteDeps {
    store: HookStore;
    history: HookHistory;
    /** 试跑一条 hook（由 runtime 提供：同一套 cwd/env/超时）。 */
    runTest: (hookId: string) => Promise<unknown>;
    /** 试跑时给 hook 的合成载荷（按事件挑字段，见 `syntheticPayload`）。 */
    testPayload?: (event: string) => Record<string, unknown>;
}
/** 试跑载荷：字段名沿用 Claude Code 的 hook 输入，让现成脚本不改就能测。 */
export declare function syntheticPayload(event: string): Record<string, unknown>;
export declare function createHookRoutes(deps: HookRouteDeps): JsonRouteSpec[];
//# sourceMappingURL=hooks.d.ts.map