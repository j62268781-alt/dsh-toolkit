export declare const IMPORT_PATH: string;
/**
 * Register the import-scan route.
 *
 * `scan` receives an already validated request and returns the preview payload; it never
 * writes anything. Failures are reported as `{ ok: false, error }` in the response, not as a
 * dropped request the panel would wait for forever.
 */
export declare function registerImportRoute(ctx: any, { schema, scan }: any): void;
//# sourceMappingURL=route.d.ts.map