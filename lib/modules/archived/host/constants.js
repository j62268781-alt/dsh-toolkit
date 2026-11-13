/**
 * Route paths shared by the host route table and the client that calls them.
 *
 * No imports on purpose: the client bundle evaluates this file as well, so a
 * Node-only import here would be bundled into the browser and fail there.
 */
export const DELETE_SESSION_PATH = "/_dsh/dsh-toolkit/archived/delete-session";
export const DELETE_SESSIONS_PATH = "/_dsh/dsh-toolkit/archived/delete-sessions";
export const PENDING_DELETIONS_PATH = "/_dsh/dsh-toolkit/archived/pending-deletions";
//# sourceMappingURL=constants.js.map