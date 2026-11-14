import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { dshHome } from "../../../../host/dsh-home.js";
import { DELETION_CODE } from "../constants.js";
import type { DeletionResult } from "./deletion.js";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

/**
 * Move one session's directory out of `sessions/` and into the trash.
 *
 * Answers the same result vocabulary as the domain (`./deletion.js`): moving to the
 * trash *is* the deletion, so success is `DELETION_CODE.deleted`. A held handle or a denied
 * permission surfaces as `move-failed` with the system text in `detail` — the caller
 * branches on the code and never has to parse that message.
 */
export async function deleteSessionFiles(sessionId: string): Promise<DeletionResult> {
  if (!SESSION_ID.test(sessionId)) {
    return { ok: false, code: DELETION_CODE.invalidSessionId };
  }

  const home = dshHome();
  const sessionsRoot = join(home, "sessions");
  const trashRoot = join(home, "dsh-delete-session-trash");

  let found: string | null = null;
  let entries: Dirent[] = [];
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return { ok: false, code: DELETION_CODE.noSessionsDirectory };
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
  if (found === null) return { ok: false, code: DELETION_CODE.notFound };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashPath = join(trashRoot, `${stamp}-${sessionId}`);
  try {
    await mkdir(trashRoot, { recursive: true });
    await rename(found, trashPath);
  } catch (error) {
    return { ok: false, code: DELETION_CODE.moveFailed, detail: String((error as Error | undefined)?.message ?? error) };
  }

  const cache = join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
  try {
    await rename(cache, join(trashRoot, `${stamp}-${sessionId}.projcache.json`));
  } catch {

  }

  return { ok: true, code: DELETION_CODE.deleted, moved: trashPath };
}
