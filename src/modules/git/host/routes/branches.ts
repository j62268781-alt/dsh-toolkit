/**
 * 分支按钮与工作区统计的四条路由：读快照、读改动统计、切分支、建分支。
 *
 * 状态码只在这一层决定：领域层给 `{ok:false, reason}`，这里按「改输入能解决」和
 * 「当前状态不允许」分成 400 / 409。client 只认 `reason` 字符串，不解析文案。
 */
import type { JsonRouteSpec } from '../../../../host/routes.js'
import { GIT_BRANCHES_PATH, GIT_CHANGES_PATH, GIT_CHECKOUT_PATH, GIT_CREATE_BRANCH_PATH } from '../constants.js'
import type { BranchResult, ChangesResult } from '../repository.js'

/** 一次请求的 body 只有 `{cwd, name?}`，1 KiB 足够；`name` 的上限另有域层校验。 */
const LIMIT = 1024

/** 领域结果 → HTTP。`5xxx` 是环境坏了（重试无用），其余 4xxx 都还能靠改输入/换状态解决。 */
function reply(result: BranchResult | ChangesResult): [number, unknown] {
  if (result.ok === true) return [200, result]
  switch (result.reason) {
    case 'invalid-cwd':
    case 'invalid-branch':
      return [400, result]
    case 'not-a-repository':
    case 'checkout-failed':
    case 'create-failed':
      return [409, result]
    case 'git-missing':
      return [503, result]
    default:
      return [500, result]
  }
}

interface Repository {
  snapshot(cwd: unknown): Promise<BranchResult>
  changes(cwd: unknown): Promise<ChangesResult>
  checkout(cwd: unknown, name: unknown): Promise<BranchResult>
  createBranch(cwd: unknown, name: unknown): Promise<BranchResult>
}

const cwdOf = (body: any) => (body !== null && typeof body === 'object' ? body.cwd : undefined)
const pairOf = (body: any) =>
  body !== null && typeof body === 'object' ? [body.cwd, body.name] : undefined
const isString = (value: any) => typeof value === 'string'
const isPair = (value: any) => Array.isArray(value) && isString(value[0]) && isString(value[1])

export function createGitRoutes({ repository }: { repository: Repository }): JsonRouteSpec[] {
  return [
    {
      path: GIT_BRANCHES_PATH,
      limit: LIMIT,
      pick: cwdOf,
      check: isString,
      reason: 'cwd 必须是字符串',
      run: async (_ctx: any, cwd: string) => reply(await repository.snapshot(cwd)),
    },
    {
      path: GIT_CHANGES_PATH,
      limit: LIMIT,
      pick: cwdOf,
      check: isString,
      reason: 'cwd 必须是字符串',
      run: async (_ctx: any, cwd: string) => reply(await repository.changes(cwd)),
    },
    {
      path: GIT_CHECKOUT_PATH,
      limit: LIMIT,
      pick: pairOf,
      check: isPair,
      reason: 'cwd 与 name 必须是字符串',
      run: async (_ctx: any, value: [string, string]) => reply(await repository.checkout(value[0], value[1])),
    },
    {
      path: GIT_CREATE_BRANCH_PATH,
      limit: LIMIT,
      pick: pairOf,
      check: isPair,
      reason: 'cwd 与 name 必须是字符串',
      run: async (_ctx: any, value: [string, string]) => reply(await repository.createBranch(value[0], value[1])),
    },
  ]
}
