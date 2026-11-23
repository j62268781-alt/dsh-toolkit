/**
 * Git 仓库的领域层：列分支、读当前分支、切分支、建分支。
 *
 * 为什么自己跑 git 而不是复用宿主：DSH 的 `worktrees` 服务只有 create/restore/cleanup，
 * forge 面板也只列「能作为 worktree 起点的分支」，**整个宿主没有任何「切换分支」的实现**
 * （`git switch` 在 app.asar 里零命中）。所以这个能力只能落在这里。
 *
 * 依赖用一个可替换的 `GitRunner` 注入：`snapshot/checkout/createBranch` 之外的判断
 * （解析、状态码折射、名字校验的前后顺序）都能在测试里用手写结果覆盖，不需要真的建仓库。
 */
import { isAbsolute } from 'node:path';
import { hasCommitInProgress } from './commit-state.js';
import { runProcess } from '../../../host/process.js';
import { GIT_TIMEOUT_MS, MAX_BRANCH_LIST, isBranchName } from './constants.js';
/** stderr 只留一行、截断，避免把整段 git 输出塞进 HTTP 响应与界面。 */
function firstLine(text) {
    const line = text.split('\n', 1)[0] ?? '';
    return line.trim().slice(0, 400);
}
const defaultRunner = async (cwd, args) => {
    const result = await runProcess('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
    return {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        spawnError: result.spawnError,
    };
};
function failure(reason, detail) {
    return { ok: false, reason, detail };
}
/**
 * 本地正则先挡下来的那类名字（空、含空格、以 `-` 开头、以 `.` 或 `/` 结尾……）。
 *
 * 与 git 的裁决分开一句话：git 拒绝的名字模型改个拼写就能过，形状不对的名字得先知道
 * 「哪里不对」，所以 detail 直接写规则，而不是只丢一句「不合法」。
 */
const SHAPE_DETAIL = '名称无效：只能包含字母、数字与 . _ - /，且不能以 - 开头或以 . 结尾。';
/** `cwd` 必须是绝对路径：相对路径会相对宿主进程自己的工作目录解析，那是 DSH 的安装目录。 */
function assertDirectory(cwd) {
    if (typeof cwd !== 'string' || cwd === '')
        return failure('invalid-cwd', '缺少工作目录。');
    if (!isAbsolute(cwd))
        return failure('invalid-cwd', '工作目录必须是绝对路径。');
    return cwd;
}
/**
 * 切到一个已存在的分支。
 *
 * 先试 `git switch`（2.23 起才有），老版本 git 会回 `unknown subcommand`，这时退回
 * `checkout`。不用 `checkout <name>` 打头是因为它对「分支名与路径同名」的仓库会歧义报错，
 * `switch` 只认分支，语义更准。
 */
async function switchTo(run, cwd, name, create) {
    const primary = create ? ['switch', '--create', name] : ['switch', '--quiet', name];
    const first = await run(cwd, primary);
    if (first.code === 0)
        return undefined;
    if (first.spawnError !== undefined)
        return failure('git-missing', '找不到 git 可执行文件。');
    // 老 git / 别名缺失：`switch` 不存在时才退回 checkout，别的失败原样上报。
    if (!/not a git command|unknown subcommand|is not a git command/i.test(first.stderr)) {
        return failure(create ? 'create-failed' : 'checkout-failed', firstLine(first.stderr));
    }
    const fallback = create ? ['checkout', '-b', name] : ['checkout', '--quiet', name];
    const second = await run(cwd, fallback);
    if (second.code === 0)
        return undefined;
    return failure(create ? 'create-failed' : 'checkout-failed', firstLine(second.stderr));
}
/**
 * 检出一条远端分支并建立跟踪关系（`--track`）。
 *
 * 与 Qoder 的远端分支行为一致：点 `origin/feat/x` 得到的本地分支叫 `feat/x`，而不是叫
 * `origin/feat/x`。`--create --track` 是 `switch` 的写法，老 git 退回 `checkout -b --track`。
 */
async function switchTracking(run, cwd, remoteRef, short) {
    const first = await run(cwd, ['switch', '--track', '--create', short, remoteRef]);
    if (first.code === 0)
        return undefined;
    if (first.spawnError !== undefined)
        return failure('git-missing', '找不到 git 可执行文件。');
    if (!/not a git command|unknown subcommand|is not a git command/i.test(first.stderr)) {
        return failure('checkout-failed', firstLine(first.stderr));
    }
    const second = await run(cwd, ['checkout', '--track', '-b', short, remoteRef]);
    if (second.code === 0)
        return undefined;
    return failure('checkout-failed', firstLine(second.stderr));
}
function succeeded(command, result) {
    return { ok: true, command, stdout: result.stdout, stderr: result.stderr };
}
/**
 * 本工具的远端一律是 `origin`：没有就当场说清楚。
 *
 * 让 git 自己报 `'origin' does not appear to be a git repository` 的话，模型分不清是
 * 远端没配、网络不通还是权限不够，而这三种的下一步完全不同。
 */
async function requireOrigin(run, cwd) {
    const remotes = await run(cwd, ['remote']);
    if (remotes.spawnError !== undefined)
        return failure('git-missing', '找不到 git 可执行文件。');
    if (remotes.code !== 0)
        return failure('sync-failed', firstLine(remotes.stderr) || '读取远端列表失败。');
    const names = remotes.stdout.split(/\r?\n/).map((name) => name.trim()).filter((name) => name !== '');
    if (names.includes('origin'))
        return undefined;
    return failure('sync-failed', names.length === 0
        ? '这个仓库还没有配置任何远端：先 `git remote add origin <url>`。'
        : `这个仓库没有名为 origin 的远端（现有：${names.join('、')}）：先 \`git remote rename\` 或补一个 origin。`);
}
/** 这个本地分支跟踪谁（`origin/main` 这种）；空串表示还没有上游。工具层也要用它写提示。 */
export async function upstreamOf(run, cwd, branch) {
    const result = await run(cwd, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`]);
    return result.code === 0 ? result.stdout.trim() : '';
}
export function createRepository(run = defaultRunner) {
    /** 当前分支：detached HEAD 时 git 回的是字面量 `HEAD`，那是「没有分支」而不是分支名。 */
    async function branchOf(cwd) {
        const top = await run(cwd, ['rev-parse', '--show-toplevel']);
        if (top.spawnError !== undefined)
            return failure('git-missing', '找不到 git 可执行文件。');
        if (top.code !== 0) {
            return failure('not-a-repository', firstLine(top.stderr) || '这里不是 Git 仓库。');
        }
        const root = top.stdout.trim();
        const head = await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const name = head.code === 0 ? head.stdout.trim() : '';
        const detached = name === '' || name === 'HEAD';
        // `--untracked-files=no`：未跟踪文件不影响切分支（除非冲突，那时 git 自己会拒绝），
        // 把它们算进「有改动」会让每次新建文件后的切换都弹一次无意义的确认。
        const status = await run(cwd, ['status', '--porcelain', '--untracked-files=no']);
        const dirty = status.code === 0 && status.stdout.trim() !== '';
        const list = await run(cwd, [
            'for-each-ref', `--count=${MAX_BRANCH_LIST}`, '--sort=-committerdate',
            '--format=%(refname:short)', 'refs/heads',
        ]);
        const branches = (list.code === 0 ? list.stdout : '')
            .split('\n').map((line) => line.trim()).filter((line) => line !== '');
        // 当前分支永远排第一：弹层里它是勾选项，被 committerdate 排到几十行之后就没用了。
        const ordered = detached ? branches : [name, ...branches.filter((item) => item !== name)];
        const remoteList = await run(cwd, [
            'for-each-ref', `--count=${MAX_BRANCH_LIST}`, '--sort=-committerdate',
            '--format=%(refname:short)', 'refs/remotes',
        ]);
        const remotes = (remoteList.code === 0 ? remoteList.stdout : '')
            .split('\n').map((line) => line.trim())
            // `origin/HEAD` 指向默认分支的符号引用，点它没有意义，混进列表只会让人误以为能检出。
            .filter((line) => line !== '' && !line.endsWith('/HEAD'));
        return { ok: true, root, branch: detached ? '' : name, detached, dirty, branches: ordered, remotes };
    }
    async function snapshotOf(cwd) {
        const current = await branchOf(cwd);
        if (current.ok !== true)
            return current;
        // 比较 Git 自己解析出的两个目录，不靠路径名判断；子模块和 separate-git-dir 也可以有 .git 文件。
        const dirs = await run(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
        const [gitDir, commonDir] = dirs.stdout.trimEnd().split(/\r?\n/);
        return { ...current, linkedWorktree: dirs.code === 0 && !!gitDir && !!commonDir && gitDir !== commonDir };
    }
    return {
        /** 一次拿全：仓库根、当前分支、是否有未提交改动、本地分支列表。 */
        async snapshot(cwd) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            return snapshotOf(resolved);
        },
        async checkout(cwd, name) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof name !== 'string' || !isBranchName(name)) {
                return failure('invalid-branch', SHAPE_DETAIL);
            }
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            // 传进来的是 `origin/feat/x` 这种远端引用：本地没有同名分支时检出并跟踪。
            if (!current.branches.includes(name) && current.remotes.includes(name)) {
                const short = name.slice(name.indexOf('/') + 1);
                // 本地已经有过 `feat/x`（可能是别人的旧检出）：直接切过去，别再建一次跟踪。
                const failed = current.branches.includes(short)
                    ? await switchTo(run, resolved, short, false)
                    : await switchTracking(run, resolved, name, short);
                if (failed !== undefined)
                    return failed;
                return snapshotOf(resolved);
            }
            const failed = await switchTo(run, resolved, name, false);
            if (failed !== undefined)
                return failed;
            return snapshotOf(resolved);
        },
        async createBranch(cwd, name) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof name !== 'string' || !isBranchName(name)) {
                return failure('invalid-branch', SHAPE_DETAIL);
            }
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            if (current.branches.includes(name))
                return failure('create-failed', '同名分支已存在。');
            // 最终裁决交给 git：`check-ref-format` 覆盖的规则比本地正则更全（`@{`、已有 ref 形态、
            // 全大写保留名等），本地正则只用来省掉一次进程调用。被 git 拒绝时把它的原话带回去，
            // 模型据此知道是「名字本身不行」而不是「仓库状态不允许」。
            const checked = await run(resolved, ['check-ref-format', '--branch', name]);
            if (checked.code !== 0)
                return failure('invalid-branch', firstLine(checked.stderr) || 'git 不接受这个分支名。');
            const failed = await switchTo(run, resolved, name, true);
            if (failed !== undefined)
                return failed;
            return snapshotOf(resolved);
        },
        /**
         * 提交改动。
         *
         * 三种入口按「谁来挑改动」分：`paths` 只提交指定路径、`all` 先 `add -A`、都不给则只提交
         * 已经暂存的内容。`diff --cached --quiet` 的退出码是这里的判别式（0=没有暂存内容，
         * 1=有），先探一次是因为空提交在任何入口下都是错的——尤其是模型「以为改过」的时候。
         */
        async commit(cwd, message, options = {}) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof message !== 'string' || message.trim() === '') {
                return failure('commit-failed', '提交说明不能为空。');
            }
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            const paths = Array.isArray(options.paths)
                ? options.paths.filter((item) => typeof item === 'string' && item !== '')
                : [];
            if (options.expected !== undefined && (paths.length > 0 || options.all === true)) {
                return failure('commit-failed', '确认后的提交只能使用已暂存的内容。');
            }
            // 初值用「上一次 add 成功」的退出码：没传 paths/all 时也要走下面那次暂存区检查。
            let staged = { code: 0, stdout: '', stderr: '' };
            if (paths.length > 0) {
                const add = ['add', '--', ...paths];
                staged = await run(resolved, add);
                if (staged.spawnError !== undefined)
                    return failure('git-missing', '找不到 git 可执行文件。');
                if (staged.code !== 0) {
                    return failure('commit-failed', `暂存 ${paths.join('、')} 失败：${firstLine(staged.stderr)}`);
                }
            }
            else if (options.all === true) {
                staged = await run(resolved, ['add', '-A']);
                if (staged.spawnError !== undefined)
                    return failure('git-missing', '找不到 git 可执行文件。');
                if (staged.code !== 0)
                    return failure('commit-failed', `暂存改动失败：${firstLine(staged.stderr)}`);
            }
            if (staged.code === 0) {
                const check = await run(resolved, ['diff', '--cached', '--quiet']);
                if (check.spawnError !== undefined)
                    return failure('git-missing', '找不到 git 可执行文件。');
                if ((check.code ?? 1) === 0) {
                    const how = paths.length > 0 || options.all === true
                        ? '暂存之后没有可提交的改动。'
                        : '还没有暂存任何改动：先 `git add <路径>`，或调用本工具时传 paths / all: true。';
                    return failure('commit-failed', how);
                }
                if ((check.code ?? 0) > 1)
                    return failure('commit-failed', firstLine(check.stderr) || '读取暂存区失败。');
            }
            if (options.expected !== undefined) {
                const expected = options.expected;
                const gitDir = await run(resolved, ['rev-parse', '--absolute-git-dir']);
                if (gitDir.code !== 0 || !isAbsolute(gitDir.stdout.trim()) || await hasCommitInProgress(gitDir.stdout.trim())) {
                    return failure('stale-preview', 'Git 操作状态已变更，请重新预览。');
                }
                const ref = await run(resolved, ['symbolic-ref', '-q', 'HEAD']);
                const head = await run(resolved, ['rev-parse', '--verify', 'HEAD']);
                const tree = await run(resolved, ['write-tree']);
                if (ref.code !== 0 || ref.stdout.trim() !== expected.branchRef
                    || (head.code === 0 ? head.stdout.trim() : null) !== expected.head
                    || tree.code !== 0 || tree.stdout.trim() !== expected.tree) {
                    return failure('stale-preview', '分支、HEAD 或暂存区已变更，请重新预览。');
                }
            }
            const argv = ['commit', '-m', message];
            const result = await run(resolved, argv);
            if (result.spawnError !== undefined)
                return failure('git-missing', '找不到 git 可执行文件。');
            if (result.code !== 0)
                return failure('commit-failed', firstLine(result.stderr) || '提交失败。');
            return succeeded(argv, result);
        },
        /**
         * 同步远端：`fetch` 只更新跟踪引用，`pull` 把上游合进来（默认 rebase）。
         *
         * 三条前置检查都在本地做，因为它们各自的下一步完全不同：游离 HEAD（先切分支）、
         * 工作区脏（先提交或 stash）、没有上游（先推一次 -u）。交给 git 只能得到
         * 「failed to pull」一句话。
         */
        async sync(cwd, action, rebase) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (action !== 'fetch' && action !== 'pull') {
                return failure('sync-failed', 'action 只能是 `fetch` 或 `pull`。');
            }
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            const missing = await requireOrigin(run, resolved);
            if (missing !== undefined)
                return missing;
            if (action === 'fetch') {
                const argv = ['fetch', '--prune', 'origin'];
                const result = await run(resolved, argv);
                if (result.spawnError !== undefined)
                    return failure('git-missing', '找不到 git 可执行文件。');
                if (result.code !== 0)
                    return failure('sync-failed', firstLine(result.stderr) || '拉取远端引用失败。');
                return succeeded(argv, result);
            }
            if (current.detached || current.branch === '') {
                return failure('sync-failed', '当前处于游离 HEAD：拉取前先切到一个本地分支。');
            }
            if (current.dirty) {
                return failure('sync-failed', '工作区有未提交的改动：先提交（git_commit）或 `git stash`，再拉取。');
            }
            const upstream = await upstreamOf(run, resolved, current.branch);
            if (upstream === '') {
                return failure('sync-failed', `${current.branch} 还没有上游：先用 git_push 推一次（会自动加 -u），`
                    + `或 \`git branch --set-upstream-to=origin/${current.branch}\`。`);
            }
            // rebase 默认开：本地提交重放到上游之上，历史比 merge commit 干净；要保留合并节点才显式关掉。
            const argv = rebase === false ? ['pull', '--no-rebase'] : ['pull', '--rebase'];
            const result = await run(resolved, argv);
            if (result.spawnError !== undefined)
                return failure('git-missing', '找不到 git 可执行文件。');
            if (result.code !== 0)
                return failure('sync-failed', firstLine(result.stderr) || '拉取失败。');
            return succeeded(argv, result);
        },
        /** 删除本地分支：默认 `-d`（只删已合并的），要删未合并的必须显式 force。 */
        async deleteBranch(cwd, name, force) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof name !== 'string' || !isBranchName(name)) {
                return failure('invalid-branch', SHAPE_DETAIL);
            }
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            if (current.branch === name) {
                return failure('delete-failed', `不能删除当前分支 ${name}：先切到别的分支再删。`);
            }
            if (!current.branches.includes(name)) {
                // `remotes` 里存的是 `origin/feat/x` 这种带远端名的引用，所以比后缀而不是全等。
                const tracked = current.remotes.some((ref) => ref === name || ref.endsWith(`/${name}`));
                return failure('delete-failed', `没有名为 ${name} 的本地分支`
                    + (tracked ? '（它是远端引用：删远端要 `git push origin --delete <分支>`）。' : '。'));
            }
            const argv = ['branch', force === true ? '-D' : '-d', name];
            const result = await run(resolved, argv);
            if (result.spawnError !== undefined)
                return failure('git-missing', '找不到 git 可执行文件。');
            if (result.code !== 0)
                return failure('delete-failed', firstLine(result.stderr) || '删除分支失败。');
            return succeeded(argv, result);
        },
        /** 重命名本地分支：`from` 省略时改当前分支。改名不会动远端，也不自动改上游名。 */
        async renameBranch(cwd, from, to) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof to !== 'string' || !isBranchName(to))
                return failure('invalid-branch', SHAPE_DETAIL);
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            const source = typeof from === 'string' && from !== '' ? from : current.branch;
            if (source === '')
                return failure('rename-failed', '当前处于游离 HEAD：请显式给出 from。');
            if (!isBranchName(source))
                return failure('invalid-branch', SHAPE_DETAIL);
            if (!current.branches.includes(source))
                return failure('rename-failed', `没有名为 ${source} 的本地分支。`);
            if (current.branches.includes(to))
                return failure('rename-failed', `已经有名为 ${to} 的分支。`);
            const argv = ['branch', '-m', source, to];
            const result = await run(resolved, argv);
            if (result.spawnError !== undefined)
                return failure('git-missing', '找不到 git 可执行文件。');
            if (result.code !== 0)
                return failure('rename-failed', firstLine(result.stderr) || '重命名失败。');
            return succeeded(argv, result);
        },
    };
}
