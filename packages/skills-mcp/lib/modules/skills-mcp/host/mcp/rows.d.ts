export declare const ROWS_PATH = "/dsh-toolkit-skills-mcp/rows";
/**
 * Register the command route.
 *
 * `apply` is injected rather than imported so this module stays free of the patch writer and
 * a test can drive the full request/response cycle without a profile on disk. It receives an
 * **already validated** op.
 */
export declare function registerRowRoute(ctx: any, { schema, apply }: any): void;
//# sourceMappingURL=rows.d.ts.map