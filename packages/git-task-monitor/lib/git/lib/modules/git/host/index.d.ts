import { Config } from './config.js';
export declare const name = "dsh-toolkit-git";
/**
 * 唯一必需依赖：系统提示词服务。没有它就无可作为（不注册路由、不留空转的监听），
 * 所以直接声明成 inject 而不是在 `apply` 里 `ctx.inject` 里套一层。
 */
export declare const inject: string[];
export { Config };
export declare function apply(ctx: any, config?: unknown): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        branchPrefix: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        alwaysForcePush: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        commitInstructions: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        branchPrefix: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        alwaysForcePush: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        commitInstructions: import("@deepseek-ai/schemastery").default<string, string, "defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map