import s from '@deepseek-ai/schemastery';
/** Independent style packs; the two scenic packs use the original DSH shell. */
export declare const PALETTES: readonly string[];
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    palette: s<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    palette: s<string, string, "volatile-defined">;
}>>, "plain">;
/** Read one live value; the Host keeps the entry alive for volatile leaves. */
export declare function readThemeConfig(config: any): {
    palette: any;
};
//# sourceMappingURL=config.d.ts.map