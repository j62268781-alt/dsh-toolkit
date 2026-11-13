export declare const RECONNECT_PATH = "/dsh-skills-mcp-manager/reconnect";
/**
 * Register the reconnect route.
 *
 * `run` is awaited: the response is the outcome (`{ ok, reason }`), so the panel can drop
 * its spinner on the answer instead of waiting for a projection round-trip. A global row can
 * legitimately take a few seconds (disable → wait for the Loader → enable); that time is the
 * command's duration, not a queue delay.
 */
export declare function registerReconnectRoute(ctx: any, { schema, run }: any): void;
//# sourceMappingURL=reconnect.d.ts.map