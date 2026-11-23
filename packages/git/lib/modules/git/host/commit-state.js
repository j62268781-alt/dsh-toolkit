import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
/** These operations can change the parents or interpretation of an otherwise identical staged tree. */
export async function hasCommitInProgress(gitDir) {
    const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge', 'sequencer'];
    const present = await Promise.all(markers.map(async (marker) => {
        try {
            await lstat(join(gitDir, marker));
            return true;
        }
        catch (error) {
            // Fail closed if the repository state cannot be read.
            return error.code !== 'ENOENT';
        }
    }));
    return present.some(Boolean);
}
