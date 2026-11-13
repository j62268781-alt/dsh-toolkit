/** Mount a service whose config was already validated by the root schema. */
export declare function configuredService<T extends new (...args: any[]) => object>(Service: T): any;
/** Keep a function plugin's dependencies while skipping duplicate validation. */
export declare function configuredPlugin(plugin: {
    name?: string;
    inject?: unknown;
    apply?: unknown;
}): any;
//# sourceMappingURL=plugins.d.ts.map