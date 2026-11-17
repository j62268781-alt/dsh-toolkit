/**
 * 内置 git 工具：推送、建分支、提交、同步、删分支、改分支名。
 *
 * 为什么做成工具而不是继续只写提示词：Qoder 的三项 Git 设置由它自己的服务执行——push 时
 * 加 `--force-with-lease`、建分支时拼前缀。DSH 没有那层服务，设置只能变成提示词里的**约定**，
 * 模型漏看一次就退化成一个裸 `git push`。工具把参数拼装搬回宿主：模型只负责「调用」，
 * `--force-with-lease` 与前缀由这里决定，用户改了设置下一次调用就生效。
 *
 * 后四个（提交/同步/删/改名）包的是另一类东西：**下一步取决于本地状态**。空暂存区、
 * 脏工作区、没有上游、未合并的分支——交给裸 git 只得到一句 `failed`，检查搬到这里
 * 才能把「接下来做什么」写进输出。
 *
 * 仍然拒绝 `git_status`/`git_log` 这类纯查询：它们没有隐含参数，模型在 shell 里敲更灵活。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { runProcess } from '../../../host/process.js'
import type { GitSettings } from './config.js'
import { createRepository, upstreamOf, type GitCommandResult, type GitRunner } from './repository.js'
import {
  BRANCH_TOOL_NAME,
  COMMIT_TOOL_NAME,
  DELETE_TOOL_NAME,
  GIT_PUSH_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  MAX_BRANCH_NAME_LENGTH,
  PUSH_TOOL_NAME,
  RENAME_TOOL_NAME,
  SYNC_TOOL_NAME,
  isBranchName,
  normalizeBranchPrefix,
  type GitReasonKey,
} from './constants.js'

export interface GitToolsOptions {
  /** 每次调用都重读：改配置后插件会重启，但测试里要能中途换值。 */
  readonly settings: () => GitSettings
  /** 测试注入的 git 执行器；缺省走 `runProcess`。 */
  readonly run?: GitRunner
  /** 自动分支名的时钟，测试里固定成某个时刻。 */
  readonly now?: () => Date
}

/**
 * cwd 只能从 agent 上推：`ToolRunContext` 自己没有目录字段（skills-mcp 的 mount 也这么取）。
 * 取不到就报错而不是退回 `process.cwd()`——那是 DSH 自己的安装目录，在那里跑 git 几乎必然出错。
 */
export function directoryOf(exec: any): string {
  const agent = exec?.agent
  const candidates = [agent?.session?.header?.cwd, agent?.session?.cwd, agent?.cwd, agent?.options?.cwd]
  for (const value of candidates) {
    if (typeof value === 'string' && value !== '') return value
  }
  throw new Error('无法确定工作目录：当前会话没有 cwd，请在对话里说明要操作的仓库路径。')
}

/** 推一条命令跑一次 git，失败时把 stderr 的首行变成可读的异常。 */
function runnerWith(timeoutMs: number): GitRunner {
  return async (cwd, args) => {
    const result = await runProcess('git', [...args], { cwd, timeoutMs })
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, spawnError: result.spawnError }
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim() !== '') ?? ''
  return line.trim().slice(0, 400)
}

const REASON_TEXT: Record<GitReasonKey, string> = {
  'invalid-cwd': '工作目录必须是绝对路径。',
  'invalid-branch': '新分支名称不符合 Git 规则。',
  'not-a-repository': '这里不是 Git 仓库。',
  'checkout-failed': '切换分支失败。',
  'create-failed': '创建分支失败。',
  'commit-failed': '提交失败。',
  'sync-failed': '与远端同步失败。',
  'delete-failed': '删除分支失败。',
  'rename-failed': '重命名分支失败。',
  'git-missing': '找不到 git 可执行文件。',
}

function reasonText(reason: GitReasonKey, detail: string): string {
  const text = REASON_TEXT[reason]
  return detail === '' ? text : `${text}${detail}`
}

/** 推送失败时补一句「接下来该怎么办」，模型据此决定是合并还是追问用户。 */
function pushHint(result: GitCommandResult): string {
  const text = `${result.stderr}\n${result.stdout}`
  if (/non-fast-forward|fetch first|\[rejected\]|stale info/i.test(text)) {
    return '\n远端有不包含在你本地的提交：先 `git fetch`，合并或变基后再推送；'
      + '确实要用本地历史覆盖时，才用 `git push --force-with-lease`（本工具已按设置自动加）。'
  }
  if (/no upstream|has no upstream branch/i.test(text)) {
    return '\n这个分支还没有上游：重试时传 `setUpstream: true`，或先 `git push -u origin <分支>`。'
  }
  return ''
}

/** `dsh-20260117-0930`：没有给名字时的默认主体（不含前缀）。 */
function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `dsh-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}`
}

/** 前缀只加一次：用户自己写全了 `dsh/xxx` 时不重复拼成 `dsh/dsh/xxx`。 */
export function prefixedName(prefix: string, seed: string): string {
  if (prefix === '') return seed
  return seed.startsWith(prefix) ? seed : `${prefix}${seed}`
}

/**
 * 推送前的上游体检：远端在不在、分支有没有上游、本地是不是已经落后。
 *
 * 为什么要在推之前查：`git push` 被远端拒绝时，报错只告诉你「non-fast-forward」，
 * 模型得再跑两三条命令才知道该 fetch 还是该强推。这三项在本地一次查完，
 * 就能直接把「接下来做什么」写进错误里（Qoder 的推送同样先查 detached / 上游）。
 */
interface PushScope {
  readonly target: string
  readonly upstream: boolean
  readonly behind: number
  readonly ahead: number
}

async function inspectPush(
  run: GitRunner,
  cwd: string,
  snapshotBranch: string,
  target: string,
  wantsUpstream: boolean | undefined,
): Promise<PushScope> {
  const remotes = await run(cwd, ['remote'])
  if (remotes.spawnError !== undefined) throw new Error(REASON_TEXT['git-missing'])
  if (remotes.code !== 0) throw new Error(`读取远端列表失败：${firstLine(remotes.stderr || remotes.stdout)}`)
  const names = remotes.stdout.split(/\r?\n/).map((name) => name.trim()).filter((name) => name !== '')
  // 本工具的 argv 固定推 origin；没有 origin 时说清楚，而不是让 git 抛 'origin does not appear to be a git repository'。
  if (!names.includes('origin')) {
    throw new Error(names.length === 0
      ? '这个仓库还没有配置任何远端：先 `git remote add origin <url>`，再用本工具推送。'
      : `这个仓库没有名为 origin 的远端（现有：${names.join('、')}）：先 \`git remote rename\` 或补一个 origin。`)
  }

  const known = await run(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  const trackedName = known.code === 0 ? known.stdout.trim() : ''
  const tracked = trackedName !== ''
  const upstream = wantsUpstream ?? !tracked

  // `@{upstream}` 说的是**当前分支**的上游，所以只有推当前分支时这组数字才有意义。
  let behind = 0
  let ahead = 0
  if (tracked && (target === snapshotBranch || target === 'HEAD')) {
    const counts = await run(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    if (counts.code === 0) {
      const [left, right] = counts.stdout.trim().split(/\s+/)
      behind = Number(left) || 0
      ahead = Number(right) || 0
    }
  }
  return { target, upstream, behind, ahead }
}

/** 当前分支比上游落后几个提交；没有上游或读不出来时按 0 算（不拿它做拦截依据）。 */
async function behindCount(run: GitRunner, cwd: string): Promise<number> {
  const counts = await run(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
  if (counts.code !== 0) return 0
  const [left] = counts.stdout.trim().split(/\s+/)
  return Number(left) || 0
}

/** 重名时退到 `-2`、`-3`……：自动命名连着建两次不该报错。 */
export function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${base}-${index}`
    if (!taken.includes(candidate)) return candidate
  }
  throw new Error(`分支名冲突太多：${base}-2 到 ${base}-99 都已被占用。`)
}

/**
 * 生成工具定义。`alwaysForcePush` 与 `branchPrefix` 在 execute 里读，
 * 所以同一个定义在设置变化后（插件重启）不需要重新编译 schema。
 */
export function createGitTools(options: GitToolsOptions) {
  const settings = options.settings
  const now = options.now ?? (() => new Date())
  // 推送可能要传几十 MB，超时比本地分支操作宽松；列分支/建分支仍用 15s 那条。
  const pushRun = options.run ?? runnerWith(GIT_PUSH_TIMEOUT_MS)
  const repository = createRepository(options.run ?? runnerWith(GIT_TIMEOUT_MS))

  const push = defineTool({
    name: PUSH_TOOL_NAME,
    description:
      '把分支推送到 origin。省略 branch 时推当前分支；本分支还没有上游时自动补 -u。'
      + '推送前会先体检：没有 origin、游离 HEAD、上游比你多几个提交都会直接说明原因，'
      + '而不是等远端拒绝——落后时先 `git pull --rebase` 或 `git fetch` 合并再调用。'
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
      const cwd = directoryOf(exec)
      const branch = args.branch === undefined || args.branch === '' ? undefined : args.branch
      if (branch !== undefined && !isBranchName(branch)) throw new Error(`分支名无效：${branch}`)
      const snapshot = await repository.snapshot(cwd)
      if (snapshot.ok !== true) throw new Error(reasonText(snapshot.reason, snapshot.detail))
      if (branch === undefined && (snapshot.detached || snapshot.branch === '')) {
        throw new Error('当前处于游离 HEAD：推送前要先选一个本地分支。'
          + '用 `git switch -c <分支>` 或调用 git_branch_create 建一个，再明确传 branch。')
      }
      const target = branch ?? 'HEAD'
      const scope = await inspectPush(pushRun, cwd, snapshot.branch, target, args.setUpstream)
      // 落后时直接推一定被拒（除非强推）。在本地就算出来，把「先合并还是先强推」讲清楚。
      if (scope.behind > 0 && !settings().alwaysForcePush) {
        throw new Error(`上游比本地多 ${scope.behind} 个提交，直接推送会被远端拒绝。\n`
          + '· 想保留远端历史：先 `git pull --rebase`（或 `git fetch` 后合并），再调用本工具；\n'
          + '· 想用本地历史覆盖：在 Git 设置里开启「始终强制推送」——本工具会带 `--force-with-lease`，'
          + '远端在你上次 fetch 之后又变过时仍然会拒绝。')
      }
      const argv = [
        'push',
        ...(settings().alwaysForcePush ? ['--force-with-lease'] : []),
        ...(scope.upstream ? ['-u'] : []),
        'origin',
        target,
      ]
      const result = await pushRun(cwd, argv)
      if (result.spawnError !== undefined) throw new Error(REASON_TEXT['git-missing'])
      const output = `${result.stdout}\n${result.stderr}`.trim()
      if (result.code !== 0) {
        throw new Error(`推送失败（\`git ${argv.join(' ')}\`）：${firstLine(result.stderr || result.stdout)}`
          + pushHint(result))
      }
      const notes: string[] = []
      const remoteName = scope.upstream ? `origin/${snapshot.branch}` : ''
      if (remoteName !== '') notes.push(`已用 -u 把 ${remoteName} 设为上游`)
      if (scope.ahead > 0) notes.push(`领先上游 ${scope.ahead} 个提交`)
      if (scope.behind > 0) notes.push('按设置强制推送，覆盖了远端历史')
      return [`$ git ${argv.join(' ')}`, output === '' ? '（git 没有输出）' : output, ...notes].join('\n')
    },
  })

  const createBranch = defineTool({
    name: BRANCH_TOOL_NAME,
    description:
      '新建分支并切换过去。省略 name 时自动生成 `dsh-<日期>-<时分>`。'
      + '设置里配了分支前缀时，前缀由本工具自动拼上——**不要**自己再写一遍前缀，也不要自己敲 '
      + '`git switch -c`：那样会漏掉前缀。重名时自动加 -2、-3。',
    parameters: {
      name: { type: 'string', description: '分支名主体（不含配置的前缀）；省略时自动生成' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = directoryOf(exec)
      const seed = (args.name ?? '').trim() === '' ? stamp(now()) : (args.name ?? '').trim()
      const name = prefixedName(normalizeBranchPrefix(settings().branchPrefix), seed)
      if (!isBranchName(name)) throw new Error(`新分支名称无效：${name}`)
      const snapshot = await repository.snapshot(cwd)
      // `ok` 是布尔字面量判别式；emit 档关掉了 strictNullChecks，这里的窄化必须写成 `!== true`。
      if (snapshot.ok !== true) throw new Error(reasonText(snapshot.reason, snapshot.detail))
      const final = uniqueName(name, snapshot.branches)
      if (final.length > MAX_BRANCH_NAME_LENGTH) throw new Error(`分支名太长：${final}`)
      const created = await repository.createBranch(cwd, final)
      if (created.ok !== true) throw new Error(reasonText(created.reason, created.detail))
      const from = snapshot.branch === '' ? '游离 HEAD' : snapshot.branch
      return `已创建并切换到 ${final}（基于 ${from}）。`
    },
  })

  /**
   * 提交、同步、删分支、改分支名。
   *
   * 与推送/建分支同样的理由：这几件事的**下一步**取决于本地状态（有没有暂存内容、工作区脏不脏、
   * 有没有上游），交给裸 git 只能拿到一句 `failed`。这里把检查搬到调用之前，模型不用自己
   * 敲三条命令去猜。
   */
  const commit = defineTool({
    name: COMMIT_TOOL_NAME,
    description:
      '把改动提交到当前分支。省略 paths 与 all 时只提交已暂存的改动；传 all: true 先 `git add -A`；'
      + '传 paths 只暂存并提交这些路径。提交说明按 Git 设置里的「提交说明指令」写。'
      + '提交前会检查暂存区：没有可提交的改动会直接说明，不会产生空提交。',
    parameters: {
      message: { type: 'string', description: '提交说明（可多行：第一行是标题）' },
      all: { type: 'boolean', description: '先 `git add -A` 再提交（连新文件与删除一起）' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: '只暂存并提交这些路径（相对仓库根）；与 all 二选一',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = directoryOf(exec)
      const message = typeof args.message === 'string' ? args.message : ''
      if (message.trim() === '') throw new Error('提交说明不能为空。')
      const result = await repository.commit(cwd, message, {
        all: args.all === true,
        paths: Array.isArray(args.paths) ? args.paths : [],
      })
      if (result.ok !== true) throw new Error(reasonText(result.reason, result.detail))
      const head = await pushRun(cwd, ['rev-parse', '--short', 'HEAD'])
      const hash = head.code === 0 ? head.stdout.trim() : ''
      const output = `${result.stdout}\n${result.stderr}`.trim()
      const title = message.trim().split('\n')[0].slice(0, 120)
      return [
        `$ git commit -m "${title}"`,
        output === '' ? '（git 没有输出）' : output,
        hash === '' ? '' : `新提交 ${hash}。`,
      ].filter((line) => line !== '').join('\n')
    },
  })

  const sync = defineTool({
    name: SYNC_TOOL_NAME,
    description:
      '与 origin 同步。action: "fetch" 只更新远端跟踪引用（带 --prune，已删的远端分支会一起清掉）；'
      + 'action: "pull" 把上游合进来（默认 --rebase，rebase: false 改用 merge）。'
      + '拉取前会检查游离 HEAD、未提交的改动与上游是否存在——这三件事的下一步各不相同，'
      + '所以不让 git 用一句 `failed to pull` 带过。拉取后冲突要自己解决。',
    parameters: {
      action: { type: 'string', description: 'fetch（只取）或 pull（取并合并）' },
      rebase: { type: 'boolean', description: 'pull 时是否变基（默认 true）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = directoryOf(exec)
      const action = args.action === 'fetch' ? 'fetch' : 'pull'
      if (args.action !== 'fetch' && args.action !== 'pull') throw new Error('action 只能是 `fetch` 或 `pull`。')
      const before = action === 'pull' ? await behindCount(pushRun, cwd) : 0
      const result = await repository.sync(cwd, action, args.rebase)
      if (result.ok !== true) {
        const base = reasonText(result.reason, result.detail)
        throw new Error(/conflict|CONFLICT/.test(result.detail)
          ? `${base}\n有冲突要解决：改完冲突文件后 \`git add <文件>\`，再 \`git rebase --continue\`（merge 用 \`git commit\`）。`
          : base)
      }
      const output = `${result.stdout}\n${result.stderr}`.trim()
      const notes: string[] = []
      if (action === 'pull') notes.push(before > 0 ? `合并了 ${before} 个上游提交。` : '本来就是最新的。')
      const remaining = await behindCount(pushRun, cwd)
      if (remaining > 0) {
        notes.push(action === 'fetch'
          ? `取回后上游比本地多 ${remaining} 个提交：要合并就调用本工具 action: "pull"。`
          : `上游仍比本地多 ${remaining} 个提交。`)
      }
      return [`$ git ${result.command.join(' ')}`, output === '' ? '（git 没有输出）' : output, ...notes].join('\n')
    },
  })

  const removeBranch = defineTool({
    name: DELETE_TOOL_NAME,
    description:
      '删除本地分支。默认只删**已合并**的分支（`git branch -d`）；确有未合并的提交要丢，才传 force: true'
      + '（等价 `-D`）。不能删当前分支。删本地不影响远端——输出会说明远端分支还在。',
    parameters: {
      name: { type: 'string', description: '要删除的本地分支名' },
      force: { type: 'boolean', description: '删未合并的分支时传 true（会丢掉那些提交）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = directoryOf(exec)
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (name === '') throw new Error('要删除的分支名不能为空。')
      // 先记上游：删完之后这个分支就查不到了。
      const tracking = await upstreamOf(pushRun, cwd, name)
      const result = await repository.deleteBranch(cwd, name, args.force === true)
      if (result.ok !== true) {
        const base = reasonText(result.reason, result.detail)
        throw new Error(/not fully merged/i.test(result.detail)
          ? `${base}\n它还有没合并进别处的提交：确认要丢掉就再调用一次，传 force: true。`
          : base)
      }
      return [
        `$ git ${result.command.join(' ')}`,
        tracking === '' ? '' : `远端 ${tracking} 仍然存在：要删远端用 \`git push origin --delete ${name}\`。`,
      ].filter((line) => line !== '').join('\n')
    },
  })

  const renameBranchTool = defineTool({
    name: RENAME_TOOL_NAME,
    description:
      '重命名本地分支（`git branch -m`）。from 省略时改当前分支。新名字按你写的原样使用，'
      + '**不会**自动加「分支前缀」——前缀只用于新建分支。改名不动远端。',
    parameters: {
      from: { type: 'string', description: '要改名的本地分支；省略时改当前分支' },
      to: { type: 'string', description: '新的分支名（完整名字，不加前缀）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = directoryOf(exec)
      const to = typeof args.to === 'string' ? args.to.trim() : ''
      if (to === '') throw new Error('新的分支名不能为空。')
      const from = typeof args.from === 'string' ? args.from.trim() : ''
      const result = await repository.renameBranch(cwd, from, to)
      if (result.ok !== true) throw new Error(reasonText(result.reason, result.detail))
      const tracking = await upstreamOf(pushRun, cwd, to)
      return [
        `$ git ${result.command.join(' ')}`,
        tracking === ''
          ? `新分支 ${to} 还没有上游：推送时调用 git_push（会自动加 -u）。`
          : `新分支 ${to} 跟踪 ${tracking}。`,
      ].join('\n')
    },
  })

  return [push, createBranch, commit, sync, removeBranch, renameBranchTool]
}
