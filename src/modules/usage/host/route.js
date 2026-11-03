/**
 * Authenticated snapshot route for the usage dashboard.
 * Contract: docs/usage/README.md — `GET /_dsh/dsh-toolkit/usage/snapshot`,
 * `cache-control: no-store`, non-GET methods answer 404, failures answer 500
 * `{ ok: false, error }`, and the handler never throws to the server.
 */
import { sendJson } from "../../../host/http.js";
import { registerAuthenticatedRoute } from "../../../host/routes.js";
import { USAGE_SNAPSHOT_PATH } from "./paths.js";

/**
 * @param {object} ctx Cordis context that owns the route effect.
 * @param {() => object|Promise<object>} getSnapshot snapshot producer; read
 *   volatile config inside it so a settings save applies on the next poll.
 */
export function registerUsageRoute(ctx, getSnapshot) {
  return registerAuthenticatedRoute(ctx, {
    kind: "exact",
    path: USAGE_SNAPSHOT_PATH,
    handler(req, res) {
      res.setHeader("cache-control", "no-store");
      if (req.method !== "GET") {
        sendJson(res, 404, { ok: false, reason: "not-found" });
        return;
      }
      let pending;
      try {
        pending = getSnapshot();
      } catch (error) {
        sendJson(res, 500, { ok: false, error: message(error) });
        return;
      }
      return Promise.resolve(pending).then(
        (payload) => sendJson(res, 200, payload),
        (error) => sendJson(res, 500, { ok: false, error: message(error) }),
      );
    },
  });
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
