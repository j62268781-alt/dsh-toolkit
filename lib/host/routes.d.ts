import type { IncomingMessage, ServerResponse } from 'node:http';
/** A route as the host's webServer understands it; the context is Cordis's. */
export interface Route {
    kind?: string;
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): unknown;
}
/** Register a route in its owning module's effect scope. */
export declare function registerRoute(ctx: any, route: Route): unknown;
/** Ordinary HTTP routes always use the host's identity and origin policy. */
export declare function registerAuthenticatedRoute(ctx: any, route: Route): unknown;
/**
 * A rejected input the route answers itself, instead of a 500.
 *
 * Validation lives in the route's own `check`, but the status it maps to (`404` for
 * a bad id, `400` for a bad shape) is protocol knowledge — it belongs next to the
 * handler skeleton, not in every domain module.
 */
export declare class HttpFailure extends Error {
    readonly status: number;
    readonly reason: string;
    constructor(status: number, reason: string);
}
/** What one JSON route declares: transport policy here, domain decisions in `run`. */
export interface JsonRouteSpec {
    path: string;
    kind?: string;
    method?: string;
    limit?: number;
    /** Leave `auth: false` only for endpoints a browser reaches by redirect. */
    auth?: boolean;
    pick?(body: any): unknown;
    check?(value: any): boolean;
    reason?: string;
    run(ctx: any, value: any): Promise<[number, unknown]> | [number, unknown];
}
/**
 * The handler skeleton every JSON route used to spell out again.
 *
 * Six modules and thirty-one routes each had to: set `cache-control`, answer the
 * wrong method with the same 404, cap the body, turn bad JSON into 400, check one
 * field and map a domain failure onto a status, and keep a thrown error from
 * becoming an unhandled rejection. None of that is route-specific, and the copies
 * had already drifted (a byte limit here, a character limit there).
 *
 * `run` answers `[status, payload]`; everything the route decides about its own
 * domain stays in the module.
 */
export declare function jsonRoute(ctx: any, spec: JsonRouteSpec): Route;
/**
 * Register a module's JSON routes, one effect each.
 *
 * One effect per route is what keeps unload honest: a module that registers three
 * routes reports three cleanups, and a reload cannot leave a duplicate behind.
 * `auth: false` is for the one endpoint a browser reaches by redirect (the OAuth
 * callback), where the host identity check would reject the caller that must reach it.
 */
export declare function registerJsonRoutes(ctx: any, specs: readonly JsonRouteSpec[]): unknown[];
//# sourceMappingURL=routes.d.ts.map