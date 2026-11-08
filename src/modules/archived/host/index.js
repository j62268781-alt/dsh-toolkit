import {
  registerDeleteSessionRoute,
  registerDeleteSessionsRoute,
  registerPendingDeletionsRoute,
} from "./route.js";

export const name = "toolkit-archived";
export const inject = ["sessions", "agents", "workspaceRegistry", "webServer", "connection"];

export function apply(ctx) {
  registerDeleteSessionRoute(ctx);
  registerDeleteSessionsRoute(ctx);
  registerPendingDeletionsRoute(ctx);
}

export default { name, inject, apply };
