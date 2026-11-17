/**
 * 把设置拼成一段系统提示词。
 *
 * 参数能落到代码里的部分已经搬进 `tools.ts`（`git_push` 拼 `--force-with-lease`、
 * `git_branch_create` 拼前缀），所以这里只剩两类内容：
 * 1. 工具说不清的**习惯**——提交说明怎么写；
 * 2. 工具没被调用时的**兜底**——告诉模型这些偏好存在，手工敲命令时也要照着做。
 *
 * 提示词是约定而不是强制：用户在当次对话里明确要求别的写法时，以用户为准（已写进 INTRO）。
 */
const HEADER = '## Git conventions';
const INTRO = 'The user configured these Git preferences in the DSH Toolkit settings panel. '
    + 'The `git_push` and `git_branch_create` tools apply them automatically — prefer those tools over running '
    + '`git push` / `git switch -c` by hand. If you do run git yourself, follow the same preferences. '
    + 'They apply to every Git operation in their repositories, unless the current request says otherwise.';
function branchRule(prefix) {
    return `- New branches start with \`${prefix}\` (for example \`${prefix}fix-login-retry\`); `
        + '`git_branch_create` adds the prefix for you, so pass only the name body.';
}
const FORCE_RULE = '- `git_push` adds `--force-with-lease` when needed. Never push with a bare `--force` / `-f`; '
    + 'if you must run git yourself, write `--force-with-lease` explicitly.';
function instructionsRule(instructions) {
    // 用户文本按原样放进列表项下面缩进两格：Markdown 里这是同一段落的续行，
    // 既不会变成代码块，也不会把用户的换行压成一行。
    return [
        '- When you write a commit message, follow the user\'s instructions below.',
        '',
        ...instructions.split('\n').map((line) => (line === '' ? '  ' : `  ${line}`)),
    ];
}
/** 生成提示词段文本；返回空串表示「一句话都不用说」，调用方据此不注册该段。 */
export function gitPromptText(settings) {
    const rules = [];
    if (settings.branchPrefix !== '')
        rules.push(branchRule(settings.branchPrefix));
    if (settings.alwaysForcePush)
        rules.push(FORCE_RULE);
    if (settings.commitInstructions !== '')
        rules.push(...instructionsRule(settings.commitInstructions));
    if (rules.length === 0)
        return '';
    return [HEADER, '', INTRO, '', ...rules].join('\n');
}
//# sourceMappingURL=prompt.js.map