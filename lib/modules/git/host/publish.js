import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { runProcess } from '../../../host/process.js';
import { hasCommitInProgress } from './commit-state.js';
import { GIT_PUBLISH_REASON, GIT_PUSH_TIMEOUT_MS, GIT_TIMEOUT_MS, MAX_PUBLISH_MESSAGE_LENGTH } from './constants.js';
import { createRepository } from './repository.js';
const PREVIEW_TTL_MS = 5 * 60_000;
const MAX_PREVIEWS = 256;
const HEADS = 'refs/heads/';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ORIGIN = 'origin';
function fail(reason, detail) {
    return { ok: false, reason, code: GIT_PUBLISH_REASON[reason], detail };
}
const missing = () => fail('git-missing', '找不到 Git 可执行文件。');
const stale = () => fail('stale-preview', '预览已失效，或 Git 状态已变化；请重新预览。');
function git(cwd, args, timeoutMs = GIT_TIMEOUT_MS) {
    return runProcess('git', args, { cwd, timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}
/** Only display standard destinations: custom remote helpers do not have a reliably safe URL display. */
function displayDestination(rawUrl) {
    if (/[\x00-\x1f\x7f\uFFFD]/.test(rawUrl) || rawUrl.startsWith('-'))
        return undefined;
    if (rawUrl.includes('://')) {
        try {
            const url = new URL(rawUrl);
            if (!['http:', 'https:', 'ssh:', 'git:', 'file:'].includes(url.protocol))
                return undefined;
            url.username = '';
            url.password = '';
            url.search = '';
            url.hash = '';
            return url.href;
        }
        catch {
            return undefined;
        }
    }
    // scp-like Git URLs may carry a username. Local paths need no URL interpretation.
    if (/^[\w+.-]+::/.test(rawUrl))
        return undefined;
    return rawUrl.replace(/^[^/@:]+@(?=[^/]+:)/, '');
}
function lines(output) {
    // Preserve leading/trailing spaces in local paths and URLs; drop only the final record separator.
    return output.replace(/\r?\n$/, '').split(/\r?\n/);
}
export function createPublishService(run = git, pushRun = (cwd, args) => git(cwd, args, GIT_PUSH_TIMEOUT_MS)) {
    const repository = createRepository(run);
    const pending = new Map();
    async function inspect({ cwd, action }) {
        if (!isAbsolute(cwd) || cwd.includes('\0'))
            return fail('invalid-cwd', '工作目录必须是绝对路径。');
        const directory = await stat(cwd).catch(() => null);
        if (!directory?.isDirectory())
            return fail('invalid-cwd', '工作目录不存在或无法访问。');
        const worktree = await run(cwd, ['rev-parse', '--is-inside-work-tree', '--absolute-git-dir']);
        if (worktree.spawnError !== undefined)
            return missing();
        const [inside, gitDir, extra] = lines(worktree.stdout);
        if (worktree.code !== 0 || inside !== 'true' || !gitDir || extra !== undefined || !isAbsolute(gitDir)) {
            return fail('not-a-repository', '这里不是 Git 工作区。');
        }
        const symbolic = await run(cwd, ['symbolic-ref', '--quiet', 'HEAD']);
        const [branchRef] = lines(symbolic.stdout);
        if (symbolic.code !== 0 || !branchRef.startsWith(HEADS) || branchRef.length === HEADS.length) {
            return fail('detached-head', '当前处于游离 HEAD；请先切换到本地分支。');
        }
        const resolved = await run(cwd, ['rev-parse', '--verify', '--quiet', `${branchRef}^{commit}`]);
        const value = resolved.stdout.trim();
        if (resolved.code === 0 ? !OID.test(value) : resolved.code !== 1) {
            return fail(action === 'commit' ? 'commit-failed' : 'push-failed', '无法读取 Git 分支的提交。');
        }
        const head = resolved.code === 0 ? value : null;
        const branch = branchRef.slice(HEADS.length);
        const preview = { action, branch, head, stagedPaths: [], destination: null, ahead: null, behind: null };
        if (await hasCommitInProgress(gitDir)) {
            return fail('commit-in-progress', '请先完成或取消正在进行的 Git 操作。');
        }
        if (action === 'commit') {
            const written = await run(cwd, ['write-tree']);
            const tree = written.stdout.trim();
            if (written.code !== 0 || !OID.test(tree)) {
                return fail('commit-failed', '无法读取暂存区；请检查是否有未解决的冲突。');
            }
            const paths = await run(cwd, head === null
                ? ['ls-tree', '--full-tree', '-r', '--name-only', '-z', tree]
                : ['diff-tree', '--no-commit-id', '--no-relative', '--no-renames', '--ignore-submodules=none', '-r', '--name-only', '-z', head, tree]);
            if (paths.code !== 0 || paths.stdout.includes('\uFFFD')) {
                return fail('commit-failed', '无法完整读取暂存路径。');
            }
            // Disable rename detection so both the staged deletion and addition are shown.
            const stagedPaths = paths.stdout.split('\0').filter(Boolean);
            return { preview: { ...preview, stagedPaths }, gitDir, branchRef, tree };
        }
        if (head === null)
            return fail('nothing-to-push', '当前分支还没有可推送的提交。');
        const configured = await run(cwd, ['remote', 'get-url', '--push', '--all', '--', ORIGIN]);
        const urls = lines(configured.stdout);
        const rawUrl = urls[0];
        const url = rawUrl && displayDestination(rawUrl);
        if (configured.code !== 0 || urls.length !== 1 || !url) {
            return fail('no-push-destination', '推送需要 origin 配置唯一且可安全显示的推送地址。');
        }
        const destination = { remote: ORIGIN, ref: branchRef, url };
        // Only compare with a local tracking ref for the exact destination. A distinct push URL
        // or custom fetch refspec is not safely represented by a conventional origin/<branch> ref.
        const [fetch, fetchSpec] = await Promise.all([
            run(cwd, ['remote', 'get-url', '--', ORIGIN]),
            run(cwd, ['config', '--get-all', `remote.${ORIGIN}.fetch`]),
        ]);
        if (fetch.code === 0 && lines(fetch.stdout)[0] === rawUrl && fetchSpec.code === 0
            && /^\+?refs\/heads\/\*:refs\/remotes\/origin\/\*$/.test(lines(fetchSpec.stdout).join('\n'))) {
            const tracking = await run(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${ORIGIN}/${branch}^{commit}`]);
            const trackingHead = tracking.stdout.trim();
            if (tracking.code === 0 && OID.test(trackingHead)) {
                const counts = await run(cwd, ['rev-list', '--left-right', '--count', `${trackingHead}...${head}`]);
                if (counts.code === 0 && /^\d+\s+\d+$/.test(counts.stdout.trim())) {
                    const [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
                    return { preview: { ...preview, destination, ahead, behind }, gitDir, branchRef, rawUrl, trackingHead };
                }
            }
        }
        return { preview: { ...preview, destination }, gitDir, branchRef, rawUrl };
    }
    return {
        async preview(request) {
            const review = await inspect(request);
            if ('ok' in review)
                return review;
            const token = randomBytes(24).toString('base64url');
            const now = Date.now();
            for (const [key, entry] of pending)
                if (entry.expires <= now)
                    pending.delete(key);
            if (pending.size >= MAX_PREVIEWS)
                pending.delete(pending.keys().next().value);
            pending.set(token, { request, review, expires: now + PREVIEW_TTL_MS });
            return { ok: true, ...review.preview, token };
        },
        async confirm(request) {
            const { cwd, action, token, message } = request;
            if (action === 'commit' && (typeof message !== 'string' || message.trim() === ''
                || message.length > MAX_PUBLISH_MESSAGE_LENGTH || message.includes('\0'))) {
                return fail('invalid-message', '提交说明不能为空，且不能包含空字符或超过长度限制。');
            }
            const original = pending.get(token);
            if (original === undefined || original.request.cwd !== cwd || original.request.action !== action)
                return stale();
            // Consume before any await; concurrent/replayed confirmations cannot reuse this review.
            pending.delete(token);
            if (original.expires <= Date.now())
                return stale();
            const current = await inspect(request);
            if ('ok' in current)
                return current.reason === 'git-missing' ? current : stale();
            if (JSON.stringify(original.review) !== JSON.stringify(current))
                return stale();
            const { preview, branchRef, tree, rawUrl } = current;
            if (action === 'commit') {
                if (preview.stagedPaths.length === 0)
                    return fail('nothing-staged', '没有可提交的暂存改动。');
                const result = await repository.commit(cwd, message, { expected: { branchRef, head: preview.head, tree: tree } });
                if (result.ok !== true) {
                    if (result.reason === 'stale-preview')
                        return stale();
                    if (result.reason === 'git-missing')
                        return missing();
                    return fail('commit-failed', result.detail);
                }
            }
            else {
                if ((preview.behind ?? 0) > 0)
                    return fail('push-behind', '本地分支落后于远端跟踪分支；请先同步。');
                if (preview.ahead === 0)
                    return fail('nothing-to-push', '没有领先于远端跟踪分支的提交。');
                // A temporary, command-local remote pins the reviewed push URL instead of letting Git
                // re-read origin's list of push URLs during the mutation. Its explicit pushurl also
                // disables pushInsteadOf; reject if an insteadOf rule resolves it differently.
                const remote = `dsh-reviewed-${token}`;
                const config = ['-c', `remote.${remote}.url=${rawUrl}`, '-c', `remote.${remote}.pushurl=${rawUrl}`];
                // ls-remote --get-url resolves command-local remotes without any network I/O;
                // remote get-url refuses a remote defined only for this command.
                const target = await run(cwd, [...config, 'ls-remote', '--get-url', '--', remote]);
                if (target.code !== 0 || lines(target.stdout).length !== 1 || lines(target.stdout)[0] !== rawUrl)
                    return stale();
                const result = await pushRun(cwd, [...config, 'push', '--no-mirror', '--no-follow-tags',
                    '--recurse-submodules=no', '--', remote, `${preview.head}:${branchRef}`]);
                if (result.spawnError !== undefined)
                    return missing();
                // Git may include authenticated URLs in stderr; don't send them to the browser.
                if (result.code !== 0)
                    return fail('push-failed', '推送失败；请检查远端权限、连接及分支状态。');
            }
            return { ok: true, action };
        },
    };
}
//# sourceMappingURL=publish.js.map