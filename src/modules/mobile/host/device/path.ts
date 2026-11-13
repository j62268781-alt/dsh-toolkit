import { findExecutableOnPath } from "../../../../host/executable.js";

/** Preserve the mobile native-executable lookup contract. */
export function findOnPath(command: string, pathValue = process.env.PATH ?? ""): string | null {
  return findExecutableOnPath(command, { pathValue });
}
