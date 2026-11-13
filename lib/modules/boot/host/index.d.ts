import { Config } from "./config.js";
export declare const name = "toolkit-boot";
export declare const inject: string[];
export declare function apply(ctx: any, config?: any): void;
export { Config };
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        animation: import("@deepseek-ai/schemastery").default<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
        theme: import("@deepseek-ai/schemastery").default<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
        showWordmark: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        allowSkip: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        animation: import("@deepseek-ai/schemastery").default<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
        theme: import("@deepseek-ai/schemastery").default<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
        showWordmark: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        allowSkip: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    }>>, "plain">;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map