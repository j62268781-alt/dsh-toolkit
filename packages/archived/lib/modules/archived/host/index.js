import { registerDeleteSessionRoute } from "./route.js";

export const name = "toolkit-archived";
export const inject = ["sessions", "webServer", "connection"];

export function apply(ctx) {
  registerDeleteSessionRoute(ctx);
}

export default { name, inject, apply };
