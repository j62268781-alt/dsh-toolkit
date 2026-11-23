/** 宿主里跑 shell 的工具名（不同版本叫法不一，宁可多列几个）。 */
const SHELL_TOOLS = new Set(['bash', 'shell', 'exec', 'exec_command', 'run_command', 'terminal']);
/** `-f`、`-uf`、`--force`、`--force=true`；`--force-with-lease` 刻意不匹配。 */
const FORCE_FLAG = /^(?:-[A-Za-z]*f[A-Za-z]*|--force|--force=true)$/;
/** 工具参数里取命令文本：`command` / `cmd` / `argv` 都见过。 */
export function commandText(args) {
    const raw = args?.command ?? args?.cmd ?? args?.script ?? args?.scriptText ?? args?.argv;
    if (typeof raw === 'string')
        return raw;
    if (Array.isArray(raw))
        return raw.map((part) => String(part)).join(' ');
    return '';
}
/**
 * 找出一条「`git push` 带 `--force` / `-f` / `+refspec`，但没有 `--force-with-lease`」的片段。
 * 找不到返回空串。按 shell 的分隔符切段，`cd repo && git push -f` 也能看出来。
 */
export function bareForcePush(command) {
    // 续行先并成一行，否则 `git push \\\n --force` 会被切到两段里。
    const flattened = command.replace(/\\\r?\n/g, ' ');
    for (const segment of flattened.split(/[\n;]|&&|\|\||\|/)) {
        const tokens = segment.trim().split(/\s+/).filter((token) => token !== '');
        const at = tokens.findIndex((token, index) => /(^|\/)git$/.test(token) && tokens[index + 1] === 'push');
        if (at === -1)
            continue;
        const rest = tokens.slice(at + 2);
        if (rest.length === 0)
            continue;
        const forced = rest.some((token) => FORCE_FLAG.test(token) || token.startsWith('+'));
        const leased = rest.some((token) => token.startsWith('--force-with-lease'));
        if (forced && !leased)
            return segment.trim();
    }
    return '';
}
/** 装上 `tools/pre-execute` 监听；`settings` 每次询问，改配置后不需要重装。 */
export function installGitGuard(ctx, settings) {
    ctx.on('tools/pre-execute', async (exec, next) => {
        if (!SHELL_TOOLS.has(String(exec?.name ?? '')))
            return next();
        if (!settings().alwaysForcePush)
            return next();
        const offender = bareForcePush(commandText(exec?.arguments));
        if (offender === '')
            return next();
        return {
            kind: 'deny',
            reason: '设置里开启了「始终强制推送」：请改用 `git push --force-with-lease`（或直接调用 git_push 工具）。'
                + `被拦下的命令：${offender}`,
        };
    });
}
