/**
 * Reading the harness tool registry.
 *
 * The MCP client registers every server's tools on the harness registry under
 * `mcp__<serverName>__<rawName>`, so that registry — not a second connection — is
 * the source of truth for "what did this server actually connect with". A Loader
 * row is mounted by the harness in the root scope, which carries no scope tag, so
 * the unscoped `schemas()` view is exactly where its tools land.
 *
 * Failure is reported as a *reason*, not as a bare empty result. "The registry is
 * unreachable" and "this server exposes nothing" look identical in the UI if the
 * reader only returns a list, and the first one is actionable (restart, or fix the
 * conflict) while the second is just a fact. The panel shows the reason verbatim.
 *
 * Kept free of any host import so it can be unit-tested directly (the `ctx` is the
 * only dependency, and it is passed in).
 */
/** Every reason the inventory can be unreadable, in the order they are checked. */
export declare const TOOL_READ_REASONS: {
    /** `ctx.get('tools')` threw: cordis throws on a bare access before injection. */
    lookupFailed: string;
    /** The tools service is not mounted in this profile at all. */
    serviceMissing: string;
    /** The service exists but exposes no `schemas()` (an older or different build). */
    apiMissing: string;
    /** `schemas()` threw — typically a visible tool whose parameters are not JSON. */
    readFailed: string;
    /** `schemas()` returned something that is not an array. */
    badShape: string;
};
export declare function toolReasonText(reason: any): string;
/**
 * Tools currently registered for each given server.
 *
 * ## Why a scope is needed
 *
 * `tools.register()` files a definition under **the registering context's scope**, and
 * `schemas()` reads the **global** view when called without one. A `mcp-client` row the
 * Loader mounts at the root registers globally, so the unscoped read sees it. A *project*
 * server is mounted by this plugin into an agent's scope (see `src/project/mount.js`), so
 * its tools live in that agent's layer and are simply **absent** from the global view.
 *
 * Reading unscoped for both tiers therefore reports every project server as having no tools
 * — and because "no tools" and "not mounted" look the same in a list, the panel showed an
 * empty tool list for a server that was mounted and connected. Passing the agent's own scope
 * (`scopeKey`, the very object the scope was minted with) asks the registry the question the
 * user is actually asking: what does the model see in *that* workspace.
 *
 * @param ctx - cordis context; `ctx.get('tools')` is the harness tool registry.
 * @param serverNames - the server names to report on, in order.
 * @param scope - optional scope key (an agent) selecting the view; omitted = global view.
 * @returns `{ ok: true, servers: [{ serverName, tools }] }` when the registry was
 *   read, or `{ ok: false, reason, detail }` when it was not. The two are never
 *   conflated: `ok: true` with an empty `tools` array is a real answer.
 */
export declare function toolsByServer(ctx: any, serverNames: any, scope?: any): {
    ok: boolean;
    reason: string;
    detail: string;
    servers?: undefined;
    total?: undefined;
} | {
    ok: boolean;
    servers: {
        serverName: any;
        tools: {
            name: any;
            description: string;
        }[];
    }[];
    total: number;
    reason?: undefined;
    detail?: undefined;
};
//# sourceMappingURL=tools.d.ts.map