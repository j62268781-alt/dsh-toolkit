import { pluginApiPath } from "../../../host/paths.js";

/**
 * Route paths shared by the host route table and the client that calls them.
 *
 * Only `/api/plugins/toolkit/<module>/…` is generated here; the client bundle
 * evaluates this file too, so a Node-only import would break the browser.
 */
const API_PREFIX = pluginApiPath("archived");

export const DELETE_SESSION_PATH = `${API_PREFIX}/delete-session`;
export const DELETE_SESSIONS_PATH = `${API_PREFIX}/delete-sessions`;
export const PENDING_DELETIONS_PATH = `${API_PREFIX}/pending-deletions`;
