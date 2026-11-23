export interface RawMcpTool {
    name: string;
    inputSchema: Record<string, unknown>;
    [key: string]: unknown;
}
export interface McpCatalog {
    tools: RawMcpTool[];
    ttlMs: number | null;
    capturedAt: number;
    cacheScope: 'public' | 'private' | null;
    authorizationIdentity: 'anonymous' | null;
}
export interface CatalogAuth {
    token(): Promise<string | undefined>;
}
export interface CatalogReadOptions {
    signal?: AbortSignal;
    /** Undefined means the real mount's authorization cannot be verified. */
    auth?: CatalogAuth | null;
}
interface CatalogReaderDeps {
    hostUrl: string;
    normalizeConfig: (config: any) => any;
    loadRuntime?: () => ReturnType<typeof loadRuntime>;
}
/** Identity is deliberately not derived from credential material or inherited process state. */
export declare function catalogAuthorizationIdentity(mountConfig: any, { auth }?: Pick<CatalogReadOptions, 'auth'>): 'anonymous' | null;
declare function loadRuntime(hostUrl: string): {
    sdk: any;
    stdio: () => {
        StdioClientTransport: any;
        scrubbedParentEnv: any;
    };
};
/** Uses a disposable transport and requests metadata only. Never mounts a plugin or invokes a tool. */
export declare function createCatalogReader(deps: CatalogReaderDeps): {
    read(_ctx: any, mountConfig: any, options?: CatalogReadOptions): Promise<McpCatalog>;
};
export {};
//# sourceMappingURL=catalog.d.ts.map