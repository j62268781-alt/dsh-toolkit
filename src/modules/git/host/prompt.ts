import type { GitSettings } from './config.js'

/**
 * 把设置拼成一段系统提示词。
 *
 * 为什么是提示词而不是拦截器：DSH 没有 Git UI，`git` 命令是 agent 自己在 shell 里敲的。
 * Qoder 能把三项设置写死在它自己的 push/建分支/生成提交说明代码里，DSH 没有那些代码路径，
 * 唯一能表达「以后都这么干」的位置就是系统提示词。这也意味着它是**约定**而不是**强制**：
 * 用户在当次对话里明确要求别的写法时，以用户为准（提示词里已经写了这句）。
 */

const HEADER = '## Git conventions'

const INTRO =
  'The user configured these Git preferences in the DSH Toolkit settings panel. '
  + 'They apply to every Git operation in their repositories, unless the current request says otherwise.'

function branchRule(prefix: string): string {
  return `- Create branches whose name starts with \`${prefix}\` (for example \`${prefix}fix-login-retry\`).`
}

const FORCE_RULE =
  '- When pushing a branch that already exists on the remote, push with `--force-with-lease` '
  + '(never with a bare `--force`, and never `--force` on a branch someone else may have moved).'

function instructionsRule(instructions: string): string[] {
  // 用户文本按原样放进列表项下面缩进两格：Markdown 里这是同一段落的续行，
  // 既不会变成代码块，也不会把用户的换行压成一行。
  return [
    '- When you write a commit message, follow the user\'s instructions below.',
    '',
    ...instructions.split('\n').map((line) => (line === '' ? '  ' : `  ${line}`)),
  ]
}

/** 生成提示词段文本；返回空串表示「一句话都不用说」，调用方据此不注册该段。 */
export function gitPromptText(settings: GitSettings): string {
  const rules: string[] = []
  if (settings.branchPrefix !== '') rules.push(branchRule(settings.branchPrefix))
  if (settings.alwaysForcePush) rules.push(FORCE_RULE)
  if (settings.commitInstructions !== '') rules.push(...instructionsRule(settings.commitInstructions))
  if (rules.length === 0) return ''
  return [HEADER, '', INTRO, '', ...rules].join('\n')
}
