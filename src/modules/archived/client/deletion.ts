import { DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH } from "./constants.js";
import { fetchJson } from "../../../client/http.js";

/**
 * 一次删除的回执。
 *
 * 宿主只回稳定的 `code`（`../../host/trash/deletion.js` 是唯一来源），`detail` 是系统
 * 原始错误、只用来显示。传输层自己失败（网络、坏 JSON）时给 `code: "unknown"`，让
 * 调用方永远只需要认识一套 code。
 */
function failure(code, detail) {
  return detail === undefined ? { ok: false, code } : { ok: false, code, detail };
}

export async function removeSessionViaHost(sessionId) {
  try {
    const response = await fetchJson(DELETE_SESSION_PATH, { method: "POST", json: { sessionId } });
    const result = await response.json();
    if (!response.ok) return failure(String(result?.code ?? "unknown"), result?.detail);
    return result;
  } catch (error) {
    return failure("unknown", String(error?.message ?? error));
  }
}

/**
 * Delete a page of rows in one round trip.
 *
 * The host still decides each session alone (loaded, running, half-moved), so the
 * answer is a receipt per id rather than one verdict for the call: a row that
 * cannot go must not take the rest of the batch with it.
 */
export async function removeSessionsViaHost(sessionIds) {
  try {
    const response = await fetchJson(DELETE_SESSIONS_PATH, { method: "POST", json: { sessionIds } });
    const result = await response.json();
    if (!response.ok) return failure(String(result?.code ?? "unknown"), result?.detail);
    return { ok: true, results: Array.isArray(result?.results) ? result.results : [] };
  } catch (error) {
    return failure("unknown", String(error?.message ?? error));
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
