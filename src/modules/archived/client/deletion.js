import { DELETE_SESSION_PATH } from "../host/paths.js";
import { fetchJson } from "../../../client/http.js";

export async function removeSessionViaHost(sessionId) {
  try {
    const response = await fetchJson(DELETE_SESSION_PATH, { method: "POST", json: { sessionId } });
    const result = await response.json();
    if (!response.ok) return { ok: false, reason: String(result?.reason ?? `HTTP ${response.status}`) };
    return result;
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}
