/**
 * 两个内置工具：`git_push` 与 `git_branch_create`。
 *
 * 为什么做成工具而不是继续只写提示词：Qoder 的三项 Git 设置由它自己的服务执行——push 时
 * 加 `--force-with-lease`、建分支时拼前缀。DSH 没有那层服务，设置只能变成提示词里的**约定**，
 * 模型漏看一次就退化成一个裸 `git push`。工具把参数拼装搬回宿主：模型只负责「调用」，
 * `--force-with-lease` 与前缀由这里决定，用户改了设置下一次调用就生效。
 *
 * 拒绝 `git` 名字前缀式命名（`git_status` 之类）：工具只包那两件**有隐含参数**的事，
 * 其余 git 命令留给 agent 在 shell 里敲——多包一层只会让工具表变长而不增加正确性。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { runProcess } from '../../../host/process.js';
import { createRepository } from './repository.js';
import { BRANCH_TOOL_NAME, GIT_PUSH_TIMEOUT_MS, GIT_TIMEOUT_MS, MAX_BRANCH_NAME_LENGTH, PUSH_TOOL_NAME, isBranchName, normalizeBranchPrefix, } from './constants.js';
/**
 * cwd 只能从 agent 上推：`ToolRunContext` 自己没有目录字段（skills-mcp 的 mount 也这么取）。
 * 取不到就报错而不是退回 `process.cwd()`——那是 DSH 自己的安装目录，在那里跑 git 几乎必然出错。
 */
export function directoryOf(exec) {
    const agent = exec?.agent;
    const candidates = [agent?.session?.header?.cwd, agent?.session?.cwd, agent?.cwd, agent?.options?.cwd];
    for (const value of candidates) {
        if (typeof value === 'string' && value !== '')
            return value;
    }
    throw new Error('无法确定工作目录：当前会话没有 cwd，请在对话里说明要操作的仓库路径。');
}
/** 推一条命令跑一次 git，失败时把 stderr 的首行变成可读的异常。 */
function runnerWith(timeoutMs) {
    return async (cwd, args) => {
        const result = await runProcess('git', [...args], { cwd, timeoutMs });
        return { code: result.code, stdout: result.stdout, stderr: result.stderr, spawnError: result.spawnError };
    };
}
function firstLine(text) {
    const line = text.split('\n').find((item) => item.trim() !== '') ?? '';
    return line.trim().slice(0, 400);
}
const REASON_TEXT = {
    'invalid-cwd': '工作目录必须是绝对路径。',
    'invalid-branch': '新分支名称不符合 Git 规则。',
    'not-a-repository': '这里不是 Git 仓库。',
    'checkout-failed': '切换分支失败。',
    'create-failed': '创建分支失败。',
    'git-missing': '找不到 git 可执行文件。',
};
function reasonText(reason, detail) {
    const text = REASON_TEXT[reason];
    return detail === '' ? text : `${text}${detail}`;
}
/** 推送失败时补一句「接下来该怎么办」，模型据此决定是合并还是追问用户。 */
function pushHint(result) {
    const text = `${result.stderr}\n${result.stdout}`;
    if (/non-fast-forward|fetch first|\[rejected\]|stale info/i.test(text)) {
        return '\n远端有不包含在你本地的提交：先 `git fetch`，合并或变基后再推送；'
            + '确实要用本地历史覆盖时，才用 `git push --force-with-lease`（本工具已按设置自动加）。';
    }
    if (/no upstream|has no upstream branch/i.test(text)) {
        return '\n这个分支还没有上游：重试时传 `setUpstream: true`，或先 `git push -u origin <分支>`。';
    }
    return '';
}
/** `dsh-20260117-0930`：没有给名字时的默认主体（不含前缀）。 */
function stamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `dsh-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
/** 前缀只加一次：用户自己写全了 `dsh/xxx` 时不重复拼成 `dsh/dsh/xxx`。 */
export function prefixedName(prefix, seed) {
    if (prefix === '')
        return seed;
    return seed.startsWith(prefix) ? seed : `${prefix}${seed}`;
}
/** 重名时退到 `-2`、`-3`……：自动命名连着建两次不该报错。 */
export function uniqueName(base, taken) {
    if (!taken.includes(base))
        return base;
    for (let index = 2; index <= 99; index += 1) {
        const candidate = `${base}-${index}`;
        if (!taken.includes(candidate))
            return candidate;
    }
    throw new Error(`分支名冲突太多：${base}-2 到 ${base}-99 都已被占用。`);
}
/**
 * 生成两个工具定义。`alwaysForcePush` 与 `branchPrefix` 在 execute 里读，
 * 所以同一个定义在设置变化后（插件重启）不需要重新编译 schema。
 */
export function createGitTools(options) {
    const settings = options.settings;
    const now = options.now ?? (() => new Date());
    // 推送可能要传几十 MB，超时比本地分支操作宽松；列分支/建分支仍用 15s 那条。
    const pushRun = options.run ?? runnerWith(GIT_PUSH_TIMEOUT_MS);
    const repository = createRepository(options.run ?? runnerWith(GIT_TIMEOUT_MS));
    const push = defineTool({
        name: PUSH_TOOL_NAME,
        description: '把分支推送到 origin。省略 branch 时推当前分支；本分支还没有上游时自动补 -u。'
            + '设置里开着「始终强制推送」时，本工具会自动带上 --force-with-lease（新建远端分支、'
            + '快进推送都安全，只在需要覆盖被改写的历史时才真正起作用）。'
            + '**不要**自己敲 `git push --force` / `-f`：要覆盖就调用本工具。'
            + '只有要推特殊 refspec、或用户明确要求看原始 git 命令输出时，才退回 shell 手工执行。',
        parameters: {
            branch: { type: 'string', description: '要推送的本地分支名；省略时推送当前分支' },
            setUpstream: {
                type: 'boolean',
                description: '是否强制加 -u（把 origin/<分支> 设为上游）；省略时只在还没有上游时才加',
            },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(args, exec) {
            const cwd = directoryOf(exec);
            const branch = args.branch === undefined || args.branch === '' ? undefined : args.branch;
            if (branch !== undefined && !isBranchName(branch))
                throw new Error(`分支名无效：${branch}`);
            if (branch === undefined) {
                const head = await repository.snapshot(cwd);
                if (head.ok && head.detached) {
                    throw new Error('当前处于游离 HEAD，请显式给出 branch（要推送的本地分支名）。');
                }
            }
            // 显式给了 setUpstream 就听它的；否则只在「还没有上游」时补 -u（首次推送直接可用）。
            const known = await pushRun(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
            const upstream = args.setUpstream ?? known.code !== 0;
            const argv = [
                'push',
                ...(settings().alwaysForcePush ? ['--force-with-lease'] : []),
                ...(upstream ? ['-u'] : []),
                'origin',
                branch ?? 'HEAD',
            ];
            const result = await pushRun(cwd, argv);
            if (result.spawnError !== undefined)
                throw new Error(REASON_TEXT['git-missing']);
            const output = `${result.stdout}\n${result.stderr}`.trim();
            if (result.code !== 0) {
                throw new Error(`推送失败（\`git ${argv.join(' ')}\`）：${firstLine(result.stderr || result.stdout)}`
                    + pushHint(result));
            }
            return [`$ git ${argv.join(' ')}`, output === '' ? '（git 没有输出）' : output].join('\n');
        },
    });
    const createBranch = defineTool({
        name: BRANCH_TOOL_NAME,
        description: '新建分支并切换过去。省略 name 时自动生成 `dsh-<日期>-<时分>`。'
            + '设置里配了分支前缀时，前缀由本工具自动拼上——**不要**自己再写一遍前缀，也不要自己敲 '
            + '`git switch -c`：那样会漏掉前缀。重名时自动加 -2、-3。',
        parameters: {
            name: { type: 'string', description: '分支名主体（不含配置的前缀）；省略时自动生成' },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute(args, exec) {
            const cwd = directoryOf(exec);
            const seed = (args.name ?? '').trim() === '' ? stamp(now()) : (args.name ?? '').trim();
            const name = prefixedName(normalizeBranchPrefix(settings().branchPrefix), seed);
            if (!isBranchName(name))
                throw new Error(`新分支名称无效：${name}`);
            const snapshot = await repository.snapshot(cwd);
            // `ok` 是布尔字面量判别式；emit 档关掉了 strictNullChecks，这里的窄化必须写成 `!== true`。
            if (snapshot.ok !== true)
                throw new Error(reasonText(snapshot.reason, snapshot.detail));
            const final = uniqueName(name, snapshot.branches);
            if (final.length > MAX_BRANCH_NAME_LENGTH)
                throw new Error(`分支名太长：${final}`);
            const created = await repository.createBranch(cwd, final);
            if (created.ok !== true)
                throw new Error(reasonText(created.reason, created.detail));
            const from = snapshot.branch === '' ? '游离 HEAD' : snapshot.branch;
            return `已创建并切换到 ${final}（基于 ${from}）。`;
        },
    });
    return [push, createBranch];
}
//# sourceMappingURL=tools.js.map