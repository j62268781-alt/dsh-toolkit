import { readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(homedir(), ".dsh");
}

export async function deleteSessionFiles(sessionId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    return { ok: false, reason: "invalid-session-id" };
  }

  const home = dshHome();
  const sessionsRoot = join(home, "sessions");
  const trashRoot = join(home, "dsh-delete-session-trash");

  let found = null;
  let entries = [];
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
    await rename(found, trashPath);
  } catch (error) {
    return { ok: false, reason: `move-failed: ${error.message}` };
  }

  const cache = join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
  try {
    await rename(cache, join(trashRoot, `${stamp}-${sessionId}.projcache.json`));
  } catch {

  }

  return { ok: true, moved: trashPath };
}
