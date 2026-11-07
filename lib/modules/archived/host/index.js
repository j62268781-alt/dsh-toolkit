import { registerDeleteSessionRoute, registerPendingDeletionsRoute } from "./route.js";

export const name = "toolkit-archived";
export const inject = ["sessions", "agents", "workspaceRegistry", "webServer", "connection"];

export function apply(ctx) {
  registerDeleteSessionRoute(ctx);
  // Retiring leftover tombstones happens lazily when the list asks for the markers,
  // so plugin startup stays free of filesystem I/O it cannot order against.
  registerPendingDeletionsRoute(ctx);
}

export default { name, inject, apply };
