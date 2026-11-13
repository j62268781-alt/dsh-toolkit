/** 同一个映射，但直接吃一个 fiber 对象 —— 本插件自己挂载的那些项目级服务器用这个。 */
export declare const fiberPhaseOf: (fiber: any) => string;
/** Workspaces the registry knows, reduced to what the project picker needs. */
export declare function configuredWorkspaces(ctx: any): any;
/** The Loader service, reached without depending on injection timing. */
export declare function loaderOf(ctx: any): any;
/** The active profile's `cordis.patch.yml`, or '' when the profile is not injected yet. */
export declare function patchFileOf(ctx: any): string;
export declare function setPatchRowsRefreshed(listener: any): void;
/** Read the patch file once and cache the entries together with its mtime. */
export declare function refreshPatchRows(file: any, { force }?: any): Promise<any>;
/**
 * Every configured `mcp-client` entry: the file is the config fact, the Loader adds runtime.
 *
 * **文件优先，Loader 补运行态。** The file already contains the row we just wrote, while the
 * Loader may need seconds to reload it; reading the Loader first is what made a saved edit
 * appear only after "a while". `phase` still comes from the Loader, because only it knows
 * the fiber state. When it has not caught up, `phase` is empty and the card says 「连接中」,
 * which is the truth.
 */
export declare function configuredEntries(ctx: any): {
    loaderFound: boolean;
    entries: any[];
};
/** The mount path's view (real server fields) — same source as the panel list. */
export declare function configuredServers(ctx: any): {
    entryId: string;
    id: string;
    serverName: any;
    scope: any;
    transport: any;
    url: any;
    command: any;
    args: any;
    env: any;
    headers: any;
    target: any;
    failOnStartupError: boolean;
    reconnect: any;
    toolCallTimeoutMs: any;
    allowInsecureTokenEndpoint: boolean;
    enabled: boolean;
    runtime: string;
    phase: string;
    loaderManaged: boolean;
}[];
/**
 * The panel's view of every configured server, in the form its forms need.
 *
 * Built on {@link serverRows} so there is exactly one projection from rows to servers —
 * the panel used to receive a differently-shaped object than the mount path did, from a
 * different source (rows for global, `config.servers` for project), which is how the two
 * tiers drifted apart in the first place.
 *
 * `args`/`env`/`headersText` are the *form* shapes (one string, one `KEY=VALUE` per line);
 * `scope` travels with the row so the panel can split one list into its two tabs instead of
 * merging two arrays.
 */
export declare function configuredMcpRows(ctx: any): {
    loaderFound: boolean;
    rows: any[];
    error?: undefined;
} | {
    loaderFound: boolean;
    rows: any[];
    error: string;
};
/**
 * Every MCP server name this panel can speak for.
 *
 * A filter may only judge names whose server the panel can actually see configured;
 * anything else is left alone, because the panel has no standing to drop a tool
 * belonging to a server it does not manage. The union covers both tiers: the
 * profile's own rows (Loader entries) and the panel's in-memory entries (global and
 * per-project).
 */
export declare function configuredServerNames(ctx: any, memoryServers?: any): unknown[];
//# sourceMappingURL=rows.d.ts.map