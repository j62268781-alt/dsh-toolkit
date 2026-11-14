/**
 * Route paths the client calls.
 *
 * One hop to the host-owned constants instead of a second copy: a path that drifts
 * from the route table fails at runtime with a 404 the browser cannot explain.
 */
export { DELETE_SESSION_PATH, DELETE_SESSIONS_PATH, PENDING_DELETIONS_PATH, DELETION_CODE } from "../host/constants.js";

/** The deletion code table itself lives in the host constants: one number per meaning,
 *  read by both sides. Re-exported here so client code imports from one place. */
export type { DeletionCode, DeletionFailureCode, DeletionSuccessCode } from "../host/constants.js";
