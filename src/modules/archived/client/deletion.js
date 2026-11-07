import { DELETE_SESSION_PATH, PENDING_DELETIONS_PATH } from "../host/paths.js";
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

/**
 * How long an archived row may stay hidden after a reload.
 *
 * The host keeps deleted-but-still-loaded sessions in memory, so their archive
 * registration only disappears after a restart; the list must keep filtering them
 * out until then. A failed lookup returns an empty set: showing a row that no
 * longer has files is far less harmful than hiding one that does.
 */
export async function readPendingDeletions() {
  try {
    const response = await fetchJson(PENDING_DELETIONS_PATH, { method: "GET" });
    if (!response.ok) return new Set();
    const result = await response.json();
    return new Set(Array.isArray(result?.sessionIds) ? result.sessionIds : []);
  } catch {
    return new Set();
  }
}
