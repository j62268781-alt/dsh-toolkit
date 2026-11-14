import { Config } from './config.js';
export declare const name = "dsh-toolkit-hooks";
/** 不依赖任何宿主服务：钩子只监听事件，初始化权重为零。 */
export declare const inject: string[];
export { Config };
export declare function apply(ctx: any, config?: unknown): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        userFile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        includeProject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        projectDir: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        defaultTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxHistory: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        userFile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        includeProject: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        projectDir: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        defaultTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        maxHistory: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map