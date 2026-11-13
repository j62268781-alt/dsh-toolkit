/**
 * Route paths the client calls.
 *
 * One hop to the host-owned constants instead of a second copy: a path that drifts
 * from the route table fails at runtime with a 404 the browser cannot explain.
 */
export { DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH } from "../host/constants.js";
