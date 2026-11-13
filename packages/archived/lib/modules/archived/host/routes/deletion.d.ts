import type { JsonRouteSpec } from "../../../../host/routes.js";
/**
 * The three archived routes, as data.
 *
 * Everything protocol-shaped lives in `jsonRoute` (method guard, body cap, bad JSON,
 * thrown errors); this file only says which field to read and what the domain
 * answers. The bulk route is the same work as N single calls, one round trip: a row
 * that cannot go (loaded, running, half-moved) fails alone and the rest completes.
 */
export declare function createDeletionRoutes(): JsonRouteSpec[];
//# sourceMappingURL=deletion.d.ts.map