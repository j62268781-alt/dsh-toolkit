import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { artifactSeed } from './classify.js';
export function absoluteArtifact(seed, cwd) {
    const path = seed.target;
    if (seed.kind !== 'artifact' || path === undefined || isAbsolute(path))
        return seed;
    if (typeof cwd !== 'string' || !isAbsolute(cwd))
        return seed;
    return artifactSeed(resolve(cwd, path));
}
export function workspaceArtifacts(summary) {
    if (!Array.isArray(summary?.files))
        return [];
    return summary.files.flatMap((file) => typeof file?.path === 'string' && file.path !== ''
        ? [absoluteArtifact(artifactSeed(file.path), summary.cwd)]
        : []);
}
/** Live disk metadata belongs in the snapshot, not the persisted event ledger. */
export async function withArtifactMetadata(entry, cwd) {
    if (entry.kind !== 'artifact' || entry.target === undefined)
        return entry;
    const path = absoluteArtifact(entry, cwd).target;
    // Legacy relative targets cannot be checked against the desktop process's cwd.
    if (path === undefined || !isAbsolute(path))
        return entry;
    try {
        const info = await stat(path);
        if (info.isFile())
            return { ...entry, modifiedAt: info.mtimeMs };
    }
    catch {
        // Deleted, inaccessible, or no longer a resolvable file.
    }
    return { ...entry, unavailable: true };
}
//# sourceMappingURL=artifacts.js.map