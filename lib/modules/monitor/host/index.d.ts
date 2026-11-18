import { Config } from './config.js';
export declare const name = "dsh-toolkit-monitor";
/** 事件监听不需要声明 inject；webServer/connection 走下面的可选注入。 */
export declare const inject: string[];
export { Config };
export declare function apply(ctx: any, config?: unknown): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map