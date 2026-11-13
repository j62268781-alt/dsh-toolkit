import { readCharBody, sendJson } from './http.js';
/** Register a route in its owning module's effect scope. */
export function registerRoute(ctx, route) {
    if (typeof ctx.webServer?.register !== 'function') {
        throw new Error('dsh-toolkit: route registration requires webServer');
    }
    return ctx.effect(() => {
        const registered = ctx.webServer.register(route);
        // Cordis awaits async setup before disposal, including teardown during setup.
        return registered && typeof registered.then === 'function'
            ? Promise.resolve(registered).then(once)
            : once(registered);
    }, `web route ${route.kind} ${route.path}`);
}
/** Ordinary HTTP routes always use the host's identity and origin policy. */
export function registerAuthenticatedRoute(ctx, route) {
    if (typeof ctx.connection?.requestRejection !== 'function') {
        throw new Error('dsh-toolkit: authenticated route registration requires connection.requestRejection');
    }
    return registerRoute(ctx, {
        ...route,
        handler(req, res) {
            const rejection = ctx.connection.requestRejection(req);
            if (rejection !== undefined) {
                res.statusCode = rejection;
                res.end();
                return;
            }
            return route.handler(req, res);
        },
    });
}
/**
 * A rejected input the route answers itself, instead of a 500.
 *
 * Validation lives in the route's own `check`, but the status it maps to (`404` for
 * a bad id, `400` for a bad shape) is protocol knowledge — it belongs next to the
 * handler skeleton, not in every domain module.
 */
export class HttpFailure extends Error {
    status;
    reason;
    constructor(status, reason) {
        super(reason);
        this.status = status;
        this.reason = reason;
    }
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
export function jsonRoute(ctx, spec) {
    const { path, kind = 'exact', method = 'POST', limit = 0, pick, check, reason, run } = spec;
    return {
        kind,
        path,
        handler(req, res) {
            const send = (status, payload) => sendJson(res, status, payload);
            res.setHeader('cache-control', 'no-store');
            if (req.method !== method) {
                send(404, { ok: false, reason: 'not-found' });
                return;
            }
            const execute = async (value) => {
                try {
                    const [status, payload] = await run(ctx, value);
                    send(status, payload);
                }
                catch (error) {
                    // The request was accepted, so it has to be answered: a rejected flush or
                    // a failed rename is a 500 carrying the host's message, never a dropped
                    // socket and never an unhandled rejection.
                    send(500, { ok: false, reason: String(error?.message ?? error) });
                }
            };
            if (limit <= 0) {
                void execute(undefined);
                return;
            }
            readCharBody(req, limit, (raw) => {
                let body;
                try {
                    body = JSON.parse(raw);
                }
                catch {
                    send(400, { ok: false, reason: 'bad-json' });
                    return;
                }
                const value = pick === undefined ? body : pick(body);
                if (check !== undefined && check(value) !== true) {
                    send(400, { ok: false, reason });
                    return;
                }
                void execute(value);
            });
        },
    };
}
/**
 * Register a module's JSON routes, one effect each.
 *
 * One effect per route is what keeps unload honest: a module that registers three
 * routes reports three cleanups, and a reload cannot leave a duplicate behind.
 * `auth: false` is for the one endpoint a browser reaches by redirect (the OAuth
 * callback), where the host identity check would reject the caller that must reach it.
 */
export function registerJsonRoutes(ctx, specs) {
    return specs.map((spec) => {
        const route = jsonRoute(ctx, spec);
        return spec.auth === false ? registerRoute(ctx, route) : registerAuthenticatedRoute(ctx, route);
    });
}
function once(dispose) {
    if (typeof dispose !== 'function')
        return undefined;
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        return dispose();
    };
}
//# sourceMappingURL=routes.js.map