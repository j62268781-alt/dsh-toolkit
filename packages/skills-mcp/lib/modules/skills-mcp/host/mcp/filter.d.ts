/**
 * Per-server MCP tool filtering.
 *
 * ## Why this exists here
 *
 * `@deepseek-ai/dsh-mcp-client` registers every tool a connected server lists,
 * unconditionally, and its `Config` has no allowlist field — verified against the
 * shipped zod union for both transports (`allowedTools`, `includeTools`,
 * `excludeTools`: no occurrences). The neighbouring `ctx.tools.restrict()` cannot
 * stand in: it requires a **scoped** context and throws on a global one by design
 * ("a context-global restriction would mask every agent"), and it only *masks* a
 * definition that stays registered and introspectable.
 *
 * So the only seam that keeps a tool out of the registry is `register` itself. This
 * panel is a **bundle-layer** plugin while the MCP rows live in the profile's own
 * patch, and the profile composes bundle patches first, then the profile's patches.
 * That ordering is what lets the shadow be installed before any MCP client
 * registers its first generation.
 *
 * ## What it deliberately does not do
 *
 * It never talks to a server, so it never changes what a server lists — only what
 * this process registers. It judges by name at registration only; it never inspects
 * a schema or an argument. It never throws into a registration: a name it cannot
 * judge is forwarded unchanged, because the safe direction for a filter is to leave
 * a tool it cannot place alone.
 *
 * @module dsh-skills-mcp-manager/mcp/filter
 */
/** The namespace every MCP tool's public name starts with. */
export declare const MCP_PREFIX = "mcp__";
/** The separator between the server name and the raw tool name. */
export declare const SERVER_SEPARATOR = "__";
/** How a server's tool list is narrowed. */
export declare const FILTER_MODES: string[];
/** Name of the setting that turns filtering into a per-agent-scoped one. */
export declare const MODE_OFF = "off";
export declare const MODE_ALLOW = "allow";
export declare const MODE_DENY = "deny";
/** Whether a tool name is in the MCP namespace at all. */
export declare function isMcpName(name: any): boolean;
/**
 * Attribute a public tool name to the server that owns it.
 *
 * `mcp-client` registers each tool as `mcp__<serverName>__<rawName>`, so the server
 * is recoverable from the prefix. Two servers where one name is a `__`-separated
 * extension of the other (`github` and `github__enterprise`) both prefix the same
 * name, so the **longest** matching prefix wins — the only assignment that keeps a
 * tool with the server that most specifically named it.
 *
 * @param name - a public tool name.
 * @param serverNames - candidate server names.
 * @returns the owning server name and the leaf, or `undefined` when none match.
 */
export declare function matchServer(name: any, serverNames: any): {
    serverName: string;
    leaf: any;
};
/**
 * Decide whether one registration is admitted.
 *
 * Pure and total: every input yields a verdict, and every path that cannot judge
 * admits. That is the fail-open direction — a filter that drops a tool it could not
 * classify would turn its own bug into a missing capability.
 *
 * @param name - the value read off the definition (any type).
 * @param rules - the panel's per-server rules: `{ [serverName]: { mode, tools } }`.
 * @param serverNames - every configured MCP server name (needed to attribute names).
 * @returns `{ admit: true }`, or `{ admit: false, serverName, leaf, reason }`.
 */
export declare function judge(name: any, rules: any, serverNames: any): {
    admit: boolean;
    reason: string;
    serverName?: undefined;
    leaf?: undefined;
} | {
    admit: boolean;
    serverName: string;
    leaf: any;
    reason: string;
};
/**
 * Install the registry shadow and return its disposer.
 *
 * The shadow goes on the tool service **instance**, never on the prototype: a
 * prototype belongs to whichever copy of the package happened to be imported, and
 * a caller that reaches the registry by name lookup at call time — which
 * `syncTools` does — only sees a write to the instance.
 *
 * @param ctx - a cordis context carrying the `tools` service.
 * @param decide - maps a tool name to a verdict; called inside a guard.
 * @param log - `{ warn }`, for the paths that must be reported rather than thrown.
 * @returns `{ installed, restore, reason }`; `installed` is false when the service
 *   is absent or its `register` cannot be shadowed (a frozen or sealed provider).
 */
export declare function installShadow(ctx: any, decide: any, log: any): {
    installed: boolean;
    restore: () => void;
    reason: string;
};
/**
 * The tool names currently in the registry, or an empty list when it cannot be read.
 *
 * Used to report what was already registered before the shadow went in — a name
 * that arrived too early can never be filtered, because a plugin cannot unregister
 * another plugin's tools.
 */
export declare function liveToolNames(ctx: any): string[];
//# sourceMappingURL=filter.d.ts.map