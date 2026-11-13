import { registerJsonRoutes } from "../../../host/routes.js";
import { createDeletionRoutes } from "./routes/deletion.js";

export const name = "toolkit-archived";
/**
 * `webServer` and `connection` are hard dependencies: without both there is nowhere
 * to register and no identity gate, so the module waits instead of half-loading.
 */
export const inject = ["sessions", "agents", "workspaceRegistry", "webServer", "connection"];

export function apply(ctx: any): void {
  registerJsonRoutes(ctx, createDeletionRoutes());
}

export default { name, inject, apply };
