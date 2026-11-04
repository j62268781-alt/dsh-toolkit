import { findExecutableOnPath } from "../../../../host/executable.js";

/** Preserve the mobile native-executable lookup contract. */
export function findOnPath(command, pathValue = process.env.PATH ?? "") {
  return findExecutableOnPath(command, { pathValue });
}
