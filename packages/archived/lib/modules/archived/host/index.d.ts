export declare const name = "toolkit-archived";
/**
 * `webServer` and `connection` are hard dependencies: without both there is nowhere
 * to register and no identity gate, so the module waits instead of half-loading.
 */
export declare const inject: string[];
export declare function apply(ctx: any): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map