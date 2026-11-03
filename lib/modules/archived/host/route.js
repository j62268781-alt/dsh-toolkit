import { sendJson } from "../../../host/http.js";
import { registerAuthenticatedRoute } from "../../../host/routes.js";
import { DELETE_SESSION_PATH } from "./paths.js";
import { deleteSessionFiles } from "./files.js";

export function registerDeleteSessionRoute(ctx) {
  return registerAuthenticatedRoute(ctx, {
    kind: "exact",
    path: DELETE_SESSION_PATH,
    handler(req, res) {
      const send = (status, payload) => sendJson(res, status, payload);
      res.setHeader("cache-control", "no-store");
      if (req.method !== "POST") {
        send(404, { ok: false, reason: "not-found" });
        return;
      }

      let raw = "";
      let oversized = false;
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
        // Preserve the original limit on the decoded raw input, including Unicode.
        if (raw.length > 8_192) {
          oversized = true;
          req.destroy();
        }
      });
      req.on("end", () => {
        if (oversized) return;
        let sessionId;
        try {
          sessionId = JSON.parse(raw)?.sessionId;
        } catch {
          send(400, { ok: false, reason: "bad-json" });
          return;
        }
        if (typeof sessionId !== "string" || sessionId === "") {
          send(400, { ok: false, reason: "bad-session-id" });
          return;
        }

        const live = ctx.sessions?.get?.(sessionId);
        if (live !== undefined && live !== null) {
          send(409, { ok: false, reason: "session-loaded" });
          return;
        }
        deleteSessionFiles(sessionId)
          .then((result) => send(result.ok ? 200 : 404, result))
          .catch((error) => send(500, { ok: false, reason: error.message }));
      });
    },
  });
}
