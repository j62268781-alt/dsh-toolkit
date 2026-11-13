import s from '@deepseek-ai/schemastery';
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    animation: s<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
    theme: s<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
    showWordmark: s<boolean, boolean, "volatile-defined">;
    allowSkip: s<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    animation: s<"draw" | "water" | "abyss", "draw" | "water" | "abyss", "volatile-defined">;
    theme: s<"auto" | "light" | "dark", "auto" | "light" | "dark", "volatile-defined">;
    showWordmark: s<boolean, boolean, "volatile-defined">;
    allowSkip: s<boolean, boolean, "volatile-defined">;
}>>, "plain">;
export declare function readBootConfig(config: any): {
    animation: any;
    theme: any;
    showWordmark: boolean;
    allowSkip: boolean;
};
//# sourceMappingURL=config.d.ts.map