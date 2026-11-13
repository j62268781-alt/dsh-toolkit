/**
 * The one place MCP servers come from: the profile patch's `mcp-client` rows.
 *
 * ## Why this module exists
 *
 * The plugin used to keep two kinds of configuration in two different places:
 *
 *   · **global** servers were written as `mcp-client` rows in the profile patch and let
 *     the Loader connect them;
 *   · **project** servers were written into this plugin's own `config.servers` field, and
 *     mounted by hand at runtime.
 *
 * Same feature, two storage formats, two lifecycles, two code paths — and the panel had to
 * merge two arrays to render one list. That asymmetry produced a stream of confusing
 * behaviour: project tools invisible to a scope-less registry read, a `serverStatus` that
 * had to special-case them, and a config field whose contents looked nothing like the rows
 * next to it in the same file.
 *
 * Both tiers are rows now. A row's `scope` says where it belongs, and that is the *only*
 * difference between the tiers:
 *
 *   scope: 'global' (or absent)  →  the Loader connects it; every agent sees the tools
 *   scope: '/abs/project/path'   →  this plugin mounts it into a matching agent's scope
 *
 * ## Why project rows are still mounted by this plugin
 *
 * A patch row is static: the Loader instantiates it once at load, and `!!js` expressions
 * are evaluated against the *Loader's* context, which has no notion of an agent or a
 * working directory (verified: `disabledOf()` → `evaluate(this.ctx, …)`, once, at load).
 * So no row can decide "only load me for the agent sitting in /work/api". Making a project
 * server apply exactly when someone opens a session in that project therefore needs a
 * runtime orchestrator — which is this plugin's actual job, not a workaround.
 *
 * ## On `scope` in the row's config
 *
 * `dsh-mcp-client`'s `Config` is a strict union that does **not** list `scope`, so the
 * first question was whether the key survives. It does: zod drops unknown keys only in
 * `.strict()` mode, and this schema is not strict — verified directly against the shipped
 * schema, where `Config({…base, scope: '/p'}).scope === '/p'`. `Config` also parses from a
 * *copy*, so the original `options.config` we read here keeps every key regardless.
 *
 * Pure: rows in, servers out. No cordis, no IO, so the two-tier rules are testable.
 *
 * @module dsh-skills-mcp-manager/mcp/serverRows
 */
/** The scope value that means "every agent". */
export declare const GLOBAL_SCOPE = "global";
/**
 * One row's config reduced to the shape the rest of the plugin works with.
 *
 * `entryId` is the Loader entry id: it is what a row op targets, and the panel shows it
 * when a server name alone would be ambiguous.
 */
export declare function serverFromRow(entry: any): {
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
    /**
     * stdio 用哪个 npm 家族。
     *
     * **只从行里读**，缺省即 `system` —— 与 `allowInsecureTokenEndpoint` 同一条规矩：
     * 一份没有这个键的旧配置要按新的（可靠的）默认走，而不是意外打开 pnpx。
     *
     * 少了这一行，面板上那个「运行时」下拉就是个装饰：选择写进 draft、却不落盘、也不被读回，
     * 用户选什么都没用。这类「字段清单漏带一项」本仓库已经出过三次，所以新增连接相关字段时
     * 这里与 `serverSetKey` 必须一起改。
     */
    runtime: string;
    phase: string;
    /** True for rows the Loader connects itself (global scope). */
    loaderManaged: boolean;
};
/**
 * The phase the Loader reports for an entry.
 *
 * `fiber.state` is the authoritative value (`dsh-host-plugin-inventory` derives its
 * `fiberPhase` from it); reading a `fiberPhase` property off a raw entry yields `''`
 * forever, which is why the panel used to be unable to tell "connected with no tools" from
 * "never loaded".
 */
export declare function phaseOf(entry: any): "" | "active" | "failed" | "loading";
/**
 * Every MCP row the profile configures, both tiers, in the order the patch lists them.
 *
 * **Insertion order, not alphabetical.** The panel is the only place these rows are
 * managed, so the order a user sees must be the order they created them in — a server
 * added a minute ago belongs at the end of the list, where they will look for it.
 * Sorting by name instead made every newly added server jump to the top (whichever name
 * happened to sort first), which reads as "it replaced my first server".
 *
 * Patch order is the stable source of that intent: `insert` entries are appended by
 * `applyRowOp`, and the Loader reports them in file order.
 *
 * Grouped entries (`options.group !== undefined`) are skipped: they exist for patch
 * indexing, not as servers.
 */
export declare function serverRows(ctxLoaderEntries: any): {
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
    /**
     * stdio 用哪个 npm 家族。
     *
     * **只从行里读**，缺省即 `system` —— 与 `allowInsecureTokenEndpoint` 同一条规矩：
     * 一份没有这个键的旧配置要按新的（可靠的）默认走，而不是意外打开 pnpx。
     *
     * 少了这一行，面板上那个「运行时」下拉就是个装饰：选择写进 draft、却不落盘、也不被读回，
     * 用户选什么都没用。这类「字段清单漏带一项」本仓库已经出过三次，所以新增连接相关字段时
     * 这里与 `serverSetKey` 必须一起改。
     */
    runtime: string;
    phase: string;
    /** True for rows the Loader connects itself (global scope). */
    loaderManaged: boolean;
}[];
/** Whether a project scope covers a working directory (a scope is a directory prefix). */
export declare function scopeCovers(scope: any, cwd: any): boolean;
/**
 * The project servers that apply to one working directory.
 *
 * Unchanged in substance from the version that read `config.servers` — only its input
 * moved from a plugin field to the rows — because the matching rule was never the problem.
 */
export declare function projectServersFor(servers: any, cwd: any): any[];
/**
 * The servers the Loader connects on its own: global scope and enabled.
 *
 * Everything else is either project-scoped (mounted per agent) or disabled (kept for its
 * configuration, deliberately not connected).
 */
export declare function loaderManagedServers(servers: any): any[];
/**
 * Whether two configurations describe the same set of servers.
 *
 * Used to decide whether a mount pass is needed at all. Deliberately ignores `phase`, which
 * the Loader updates on its own schedule: a phase change is not a reason to tear down and
 * rebuild a working connection.
 */
export declare function serverSetKey(servers: any): string;
//# sourceMappingURL=serverRows.d.ts.map