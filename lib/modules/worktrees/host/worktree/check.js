import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { makeWorktreeGit } from './git.js';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_INDEX_ENTRIES = 10_000;
function isWithin(parent, child) {
    const rel = relative(parent, child);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function metadata(path) {
    try {
        return await lstat(path, { bigint: true });
    }
    catch (error) {
        if (error?.code !== 'ENOENT')
            throw error;
    }
}
function nulFields(text) {
    if (!text)
        return [];
    if (!text.endsWith('\0'))
        throw new Error('incomplete Git output');
    return text.slice(0, -1).split('\0');
}
function validPath(path) {
    return isAbsolute(path) && resolve(path) === path && !/[\0\r\n\ufffd]/.test(path);
}
export const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export async function checkoutPresence(record) {
    const { repositoryRoot: root, path, branch, baseCommit } = record;
    if (!validPath(root) || !validPath(path) || !isWithin(root, path) || !commitId.test(baseCommit)
        || !branch || /[\x00-\x20\x7f]/.test(branch))
        return 'checkout-mismatch';
    if (!await metadata(path))
        return 'checkout-missing';
}
/** Advisory only; the result is not permission to remove a checkout. */
export async function checkManagedCheckout(ctx, record, signal) {
    const checked = await verifyManagedCheckout(ctx, record, signal);
    return typeof checked === 'string' ? checked : 'clean';
}
export async function verifyManagedCheckout(ctx, record, signal) {
    const { repositoryRoot: root, path, branch, baseCommit } = record;
    try {
        signal.throwIfAborted();
        if (!validPath(root) || !validPath(path) || !isWithin(root, path) || !commitId.test(baseCommit)
            || !branch || /[\x00-\x20\x7f]/.test(branch))
            return 'checkout-mismatch';
        const target = await metadata(path);
        if (!target)
            return 'checkout-missing';
        if (!target.isDirectory() || await realpath(path) !== path || !(await metadata(root))?.isDirectory()
            || await realpath(root) !== root || !(await metadata(join(path, '.git')))?.isFile())
            return 'checkout-mismatch';
        const git = await makeWorktreeGit(ctx, { mode: 'read-only', workspaceRoot: root }, signal);
        const identity = (cwd) => git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--show-object-format']);
        const source = (await identity(root)).text.split('\n');
        const checkout = (await identity(path)).text.split('\n');
        const common = source[2] ?? '';
        const admin = checkout[1] ?? '';
        const algorithm = checkout[3];
        if (source.length !== 5 || checkout.length !== 5 || source[0] !== root || checkout[0] !== path
            || checkout[2] !== common || !validPath(common) || !validPath(admin) || !isWithin(join(common, 'worktrees'), admin)
            || await realpath(common) !== common || await realpath(admin) !== admin || source[1] === admin
            || (algorithm !== 'sha1' && algorithm !== 'sha256'))
            return 'checkout-mismatch';
        const registration = async () => {
            const { text } = await git(root, ['worktree', 'list', '--porcelain', '-z']);
            const matches = text.split('\0\0').map(nulFieldsWithEnd).filter(fields => fields[0] === `worktree ${path}`);
            if (!text.endsWith('\0\0') || matches.length !== 1)
                return 'checkout-mismatch';
            const fields = matches[0];
            if (fields.some(field => field === 'locked' || field.startsWith('locked ')))
                return 'locked';
            if (fields.some(field => field === 'prunable' || field.startsWith('prunable ')))
                return 'prunable';
            if (fields.length !== 3 || fields[2] !== `branch refs/heads/${branch}` || !fields[1]?.startsWith('HEAD ')
                || !commitId.test(fields[1].slice(5)))
                return 'checkout-mismatch';
            const ref = (await git(path, ['symbolic-ref', 'HEAD'])).text;
            const head = fields[1].slice(5);
            const actualHead = (await git(path, ['rev-parse', '--verify', 'HEAD'])).text;
            return ref === `refs/heads/${branch}\n` && actualHead === `${head}\n` ? { head } : 'checkout-mismatch';
        };
        const registered = await registration();
        if (typeof registered === 'string')
            return registered;
        const { head } = registered;
        // Git's registered path plus the target's admin directory are not sufficient if
        // someone repointed the .git file at another registered checkout's admin dir.
        const gitdir = join(admin, 'gitdir');
        if ((await metadata(gitdir))?.isFile() !== true || await realpath(gitdir) !== gitdir)
            return 'checkout-mismatch';
        if (!await pointsBack(gitdir, join(path, '.git')))
            return 'checkout-mismatch';
        if ((await git(path, ['merge-base', '--is-ancestor', baseCommit, head], { allowedCodes: [0, 1] })).code !== 0)
            return 'checkout-mismatch';
        const adminIdle = async () => {
            for (const name of ['modules', 'index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge', 'sequencer', 'BISECT_LOG']) {
                if (await metadata(join(admin, name)))
                    return false;
            }
            return true;
        };
        const indexPath = join(admin, 'index');
        const index = await metadata(indexPath);
        if (!index?.isFile() || !await adminIdle())
            return 'check-unavailable';
        const readOthers = () => git(path, ['ls-files', '--others', '--directory', '-z']);
        const readEntries = () => git(path, ['ls-files', '-v', '--stage', '-z']);
        if ((await git(path, ['diff-index', '--cached', '--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', head, '--'], { allowedCodes: [0, 1] })).code !== 0
            || (await readOthers()).text !== '')
            return 'dirty';
        const indexEntries = (await readEntries()).text;
        const entries = nulFields(indexEntries);
        const checked = [];
        if (entries.length > MAX_INDEX_ENTRIES)
            return 'check-unavailable';
        let checkedBytes = 0;
        for (const entry of entries) {
            signal.throwIfAborted();
            const match = /^H (100644|100755|120000) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([\s\S]+)$/.exec(entry);
            // Anything that Git could hide or that needs a separate repository check
            // (assume-unchanged, skip-worktree, conflicts, submodules) fails closed.
            if (!match)
                return 'check-unavailable';
            const [, mode, hash, name] = match;
            const file = resolve(path, name);
            if (!isWithin(path, file) || relative(path, file) !== name)
                return 'check-unavailable';
            const info = await metadata(file);
            if (!info || (mode === '120000' ? !info.isSymbolicLink() : !info.isFile()))
                return 'dirty';
            if (await realpath(resolve(file, '..')) !== resolve(file, '..'))
                return 'checkout-mismatch';
            if (mode !== '120000' && Boolean(info.mode & 64n) !== (mode === '100755'))
                return 'dirty';
            checkedBytes += Number(info.size);
            if (info.size > MAX_FILE_BYTES || checkedBytes > MAX_TOTAL_BYTES)
                return 'check-unavailable';
            const bytes = mode === '120000' ? await readlink(file, { encoding: 'buffer' }) : await readBounded(file, info);
            if (bytes.length !== Number(info.size) || createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== hash)
                return 'dirty';
            checked.push([file, info]);
        }
        signal.throwIfAborted();
        if (!unchanged(target, await metadata(path)) || await realpath(path) !== path
            || (await identity(root)).text !== source.join('\n') || (await identity(path)).text !== checkout.join('\n')
            || !await pointsBack(gitdir, join(path, '.git')))
            return 'checkout-mismatch';
        const final = await registration();
        if (typeof final === 'string')
            return final;
        if ((await readOthers()).text !== '')
            return 'dirty';
        if (final.head !== head || (await readEntries()).text !== indexEntries
            || !unchanged(index, await metadata(indexPath)) || !await adminIdle())
            return 'check-unavailable';
        for (const [file, before] of checked) {
            signal.throwIfAborted();
            if (!unchanged(before, await metadata(file)))
                return 'check-unavailable';
        }
        return { head, commonDir: common, objectFormat: algorithm };
    }
    catch {
        return 'check-unavailable';
    }
}
function nulFieldsWithEnd(record) { return record.split('\0'); }
function unchanged(before, after) {
    return after?.dev === before.dev && after.ino === before.ino && after.mode === before.mode
        && after.size === before.size && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs;
}
async function pointsBack(file, expected) {
    const info = await metadata(file);
    if (!info?.isFile() || info.size > 8192n)
        return false;
    return (await readBounded(file, info)).equals(Buffer.from(`${expected}\n`));
}
async function readBounded(path, info) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await file.stat({ bigint: true });
        if (!unchanged(info, before))
            throw new Error('file changed before read');
        const size = Number(info.size);
        const bytes = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
            if (bytesRead === 0)
                break;
            offset += bytesRead;
        }
        const after = await file.stat({ bigint: true });
        if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size || offset !== size) {
            throw new Error('file changed during read');
        }
        return bytes.subarray(0, offset);
    }
    finally {
        await file.close();
    }
}
