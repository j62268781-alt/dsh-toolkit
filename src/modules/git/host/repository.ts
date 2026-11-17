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
import { isAbsolute } from 'node:path'
import { runProcess } from '../../../host/process.js'
import { GIT_TIMEOUT_MS, MAX_BRANCH_LIST, isBranchName, type GitReasonKey } from './constants.js'

export interface GitCommandResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly spawnError?: Error
}

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>

export interface BranchSnapshot {
  readonly ok: true
  readonly root: string
  readonly branch: string
  readonly detached: boolean
  readonly dirty: boolean
  readonly branches: readonly string[]
  /** 远端跟踪引用（`origin/main` 这种短名）；`origin/HEAD` 是符号引用，不算分支。 */
  readonly remotes: readonly string[]
}

export interface BranchFailure {
  readonly ok: false
  readonly reason: GitReasonKey
  /** 给面板看的一行原因（git 的 stderr 首行），不参与判断。 */
  readonly detail: string
}

export type BranchResult = BranchSnapshot | BranchFailure

/** stderr 只留一行、截断，避免把整段 git 输出塞进 HTTP 响应与界面。 */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? ''
  return line.trim().slice(0, 400)
}

const defaultRunner: GitRunner = async (cwd, args) => {
  const result = await runProcess('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS })
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    spawnError: result.spawnError,
  }
}

function failure(reason: GitReasonKey, detail: string): BranchFailure {
  return { ok: false, reason, detail }
}

/**
 * 本地正则先挡下来的那类名字（空、含空格、以 `-` 开头、以 `.` 或 `/` 结尾……）。
 *
 * 与 git 的裁决分开一句话：git 拒绝的名字模型改个拼写就能过，形状不对的名字得先知道
 * 「哪里不对」，所以 detail 直接写规则，而不是只丢一句「不合法」。
 */
const SHAPE_DETAIL = '名称无效：只能包含字母、数字与 . _ - /，且不能以 - 开头或以 . 结尾。'

/** `cwd` 必须是绝对路径：相对路径会相对宿主进程自己的工作目录解析，那是 DSH 的安装目录。 */
function assertDirectory(cwd: unknown): BranchFailure | string {
  if (typeof cwd !== 'string' || cwd === '') return failure('invalid-cwd', '缺少工作目录。')
  if (!isAbsolute(cwd)) return failure('invalid-cwd', '工作目录必须是绝对路径。')
  return cwd
}

/**
 * 切到一个已存在的分支。
 *
 * 先试 `git switch`（2.23 起才有），老版本 git 会回 `unknown subcommand`，这时退回
 * `checkout`。不用 `checkout <name>` 打头是因为它对「分支名与路径同名」的仓库会歧义报错，
 * `switch` 只认分支，语义更准。
 */
async function switchTo(run: GitRunner, cwd: string, name: string, create: boolean): Promise<BranchFailure | undefined> {
  const primary = create ? ['switch', '--create', name] : ['switch', '--quiet', name]
  const first = await run(cwd, primary)
  if (first.code === 0) return undefined
  if (first.spawnError !== undefined) return failure('git-missing', '找不到 git 可执行文件。')
  // 老 git / 别名缺失：`switch` 不存在时才退回 checkout，别的失败原样上报。
  if (!/not a git command|unknown subcommand|is not a git command/i.test(first.stderr)) {
    return failure(create ? 'create-failed' : 'checkout-failed', firstLine(first.stderr))
  }
  const fallback = create ? ['checkout', '-b', name] : ['checkout', '--quiet', name]
  const second = await run(cwd, fallback)
  if (second.code === 0) return undefined
  return failure(create ? 'create-failed' : 'checkout-failed', firstLine(second.stderr))
}

/**
 * 检出一条远端分支并建立跟踪关系（`--track`）。
 *
 * 与 Qoder 的远端分支行为一致：点 `origin/feat/x` 得到的本地分支叫 `feat/x`，而不是叫
 * `origin/feat/x`。`--create --track` 是 `switch` 的写法，老 git 退回 `checkout -b --track`。
 */
async function switchTracking(
  run: GitRunner,
  cwd: string,
  remoteRef: string,
  short: string,
): Promise<BranchFailure | undefined> {
  const first = await run(cwd, ['switch', '--track', '--create', short, remoteRef])
  if (first.code === 0) return undefined
  if (first.spawnError !== undefined) return failure('git-missing', '找不到 git 可执行文件。')
  if (!/not a git command|unknown subcommand|is not a git command/i.test(first.stderr)) {
    return failure('checkout-failed', firstLine(first.stderr))
  }
  const second = await run(cwd, ['checkout', '--track', '-b', short, remoteRef])
  if (second.code === 0) return undefined
  return failure('checkout-failed', firstLine(second.stderr))
}

export function createRepository(run: GitRunner = defaultRunner) {
  /** 当前分支：detached HEAD 时 git 回的是字面量 `HEAD`，那是「没有分支」而不是分支名。 */
  async function branchOf(cwd: string): Promise<{ ok: true, root: string, branch: string, detached: boolean, dirty: boolean, branches: string[], remotes: string[] } | BranchFailure> {
    const top = await run(cwd, ['rev-parse', '--show-toplevel'])
    if (top.spawnError !== undefined) return failure('git-missing', '找不到 git 可执行文件。')
    if (top.code !== 0) {
      return failure('not-a-repository', firstLine(top.stderr) || '这里不是 Git 仓库。')
    }
    const root = top.stdout.trim()
    const head = await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const name = head.code === 0 ? head.stdout.trim() : ''
    const detached = name === '' || name === 'HEAD'
    // `--untracked-files=no`：未跟踪文件不影响切分支（除非冲突，那时 git 自己会拒绝），
    // 把它们算进「有改动」会让每次新建文件后的切换都弹一次无意义的确认。
    const status = await run(cwd, ['status', '--porcelain', '--untracked-files=no'])
    const dirty = status.code === 0 && status.stdout.trim() !== ''
    const list = await run(cwd, [
      'for-each-ref', `--count=${MAX_BRANCH_LIST}`, '--sort=-committerdate',
      '--format=%(refname:short)', 'refs/heads',
    ])
    const branches = (list.code === 0 ? list.stdout : '')
      .split('\n').map((line) => line.trim()).filter((line) => line !== '')
    // 当前分支永远排第一：弹层里它是勾选项，被 committerdate 排到几十行之后就没用了。
    const ordered = detached ? branches : [name, ...branches.filter((item) => item !== name)]
    const remoteList = await run(cwd, [
      'for-each-ref', `--count=${MAX_BRANCH_LIST}`, '--sort=-committerdate',
      '--format=%(refname:short)', 'refs/remotes',
    ])
    const remotes = (remoteList.code === 0 ? remoteList.stdout : '')
      .split('\n').map((line) => line.trim())
      // `origin/HEAD` 指向默认分支的符号引用，点它没有意义，混进列表只会让人误以为能检出。
      .filter((line) => line !== '' && !line.endsWith('/HEAD'))
    return { ok: true, root, branch: detached ? '' : name, detached, dirty, branches: ordered, remotes }
  }

  return {
    /** 一次拿全：仓库根、当前分支、是否有未提交改动、本地分支列表。 */
    async snapshot(cwd: unknown): Promise<BranchResult> {
      const resolved = assertDirectory(cwd)
      if (typeof resolved !== 'string') return resolved
      return branchOf(resolved)
    },

    async checkout(cwd: unknown, name: unknown): Promise<BranchResult> {
      const resolved = assertDirectory(cwd)
      if (typeof resolved !== 'string') return resolved
      if (typeof name !== 'string' || !isBranchName(name)) {
        return failure('invalid-branch', SHAPE_DETAIL)
      }
      const current = await branchOf(resolved)
      if (current.ok !== true) return current
      // 传进来的是 `origin/feat/x` 这种远端引用：本地没有同名分支时检出并跟踪。
      if (!current.branches.includes(name) && current.remotes.includes(name)) {
        const short = name.slice(name.indexOf('/') + 1)
        // 本地已经有过 `feat/x`（可能是别人的旧检出）：直接切过去，别再建一次跟踪。
        const failed = current.branches.includes(short)
          ? await switchTo(run, resolved, short, false)
          : await switchTracking(run, resolved, name, short)
        if (failed !== undefined) return failed
        return branchOf(resolved)
      }
      const failed = await switchTo(run, resolved, name, false)
      if (failed !== undefined) return failed
      return branchOf(resolved)
    },

    async createBranch(cwd: unknown, name: unknown): Promise<BranchResult> {
      const resolved = assertDirectory(cwd)
      if (typeof resolved !== 'string') return resolved
      if (typeof name !== 'string' || !isBranchName(name)) {
        return failure('invalid-branch', SHAPE_DETAIL)
      }
      const current = await branchOf(resolved)
      if (current.ok !== true) return current
      if (current.branches.includes(name)) return failure('create-failed', '同名分支已存在。')
      // 最终裁决交给 git：`check-ref-format` 覆盖的规则比本地正则更全（`@{`、已有 ref 形态、
      // 全大写保留名等），本地正则只用来省掉一次进程调用。被 git 拒绝时把它的原话带回去，
      // 模型据此知道是「名字本身不行」而不是「仓库状态不允许」。
      const checked = await run(resolved, ['check-ref-format', '--branch', name])
      if (checked.code !== 0) return failure('invalid-branch', firstLine(checked.stderr) || 'git 不接受这个分支名。')
      const failed = await switchTo(run, resolved, name, true)
      if (failed !== undefined) return failed
      return branchOf(resolved)
    },
  }
}
