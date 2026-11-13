import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { Dirent } from "node:fs";
import { join } from "node:path";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** What moving a session to the trash can answer; the route interprets the leftovers. */
export interface TrashFailure {
  ok: false;
  reason: string;
}
export interface TrashSuccess {
  ok: true;
  moved: string;
}
export type TrashResult = TrashSuccess | TrashFailure;

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".dsh");
}

function pendingDir() {
  return join(dshHome(), "dsh-delete-session-trash", "pending");
}

/**
 * Remember a session whose files were moved while the host still held it in memory.
 *
 * Such a session keeps its archive registration on purpose (that is what hides the
 * record once the host can no longer be asked to drop it), so the deletion needs a
 * marker to survive a restart: the list filters marked ids out, and the next start
 * retires both the marker and the registration.
 */
export async function markPendingDeletion(sessionId: string): Promise<boolean> {
  try {
    await mkdir(pendingDir(), { recursive: true });
    await writeFile(join(pendingDir(), sessionId), "");
    return true;
  } catch {
    return false;
  }
}

/** Marked ids. An unreadable directory means "nothing to hide", never a crash. */
export async function listPendingDeletions(): Promise<string[]> {
  try {
    const entries = await readdir(pendingDir(), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function clearPendingDeletion(sessionId: string): Promise<boolean> {
  try {
    await unlink(join(pendingDir(), sessionId));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSessionFiles(sessionId: string): Promise<TrashResult> {
  if (!SESSION_ID.test(sessionId)) {
    return { ok: false, reason: "invalid-session-id" };
  }

  const home = dshHome();
  const sessionsRoot = join(home, "sessions");
  const trashRoot = join(home, "dsh-delete-session-trash");

  let found: string | null = null;
  let entries: Dirent[] = [];
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return { ok: false, reason: "no-sessions-directory" };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(sessionsRoot, entry.name, sessionId);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        found = candidate;
        break;
      }
    } catch {

    }
  }
  if (found === null) return { ok: false, reason: "not-found" };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashPath = join(trashRoot, `${stamp}-${sessionId}`);
  try {
    await mkdir(trashRoot, { recursive: true });
    await rename(found, trashPath);
  } catch (error) {
    return { ok: false, reason: `move-failed: ${(error as Error).message}` };
  }

  const cache = join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
  try {
    await rename(cache, join(trashRoot, `${stamp}-${sessionId}.projcache.json`));
  } catch {

  }

  return { ok: true, moved: trashPath };
}
