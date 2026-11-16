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
        return { ok: true, root, branch: detached ? '' : name, detached, dirty, branches: ordered };
    }
    return {
        /** 一次拿全：仓库根、当前分支、是否有未提交改动、本地分支列表。 */
        async snapshot(cwd) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            return branchOf(resolved);
        },
        async checkout(cwd, name) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof name !== 'string' || !isBranchName(name)) {
                return failure('invalid-branch', '分支名不合法。');
            }
            const failed = await switchTo(run, resolved, name, false);
            if (failed !== undefined)
                return failed;
            return branchOf(resolved);
        },
        async createBranch(cwd, name) {
            const resolved = assertDirectory(cwd);
            if (typeof resolved !== 'string')
                return resolved;
            if (typeof name !== 'string' || !isBranchName(name)) {
                return failure('invalid-branch', '分支名不合法。');
            }
            const current = await branchOf(resolved);
            if (current.ok !== true)
                return current;
            if (current.branches.includes(name))
                return failure('create-failed', '同名分支已存在。');
            // 最终裁决交给 git：`check-ref-format` 覆盖的规则比本地正则更全（例如已存在的 ref 形态）。
            const checked = await run(resolved, ['check-ref-format', '--branch', name]);
            if (checked.code !== 0)
                return failure('invalid-branch', firstLine(checked.stderr) || '分支名不合法。');
            const failed = await switchTo(run, resolved, name, true);
            if (failed !== undefined)
                return failed;
            return branchOf(resolved);
        },
    };
}
//# sourceMappingURL=repository.js.map