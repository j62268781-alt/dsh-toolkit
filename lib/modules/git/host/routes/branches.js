import { GIT_BRANCHES_PATH, GIT_CHECKOUT_PATH, GIT_CREATE_BRANCH_PATH } from '../constants.js';
/** 一次请求的 body 只有 `{cwd, name?}`，1 KiB 足够；`name` 的上限另有域层校验。 */
const LIMIT = 1024;
/** 领域结果 → HTTP。`5xxx` 是环境坏了（重试无用），其余 4xxx 都还能靠改输入/换状态解决。 */
function reply(result) {
    if (result.ok === true)
        return [200, result];
    switch (result.reason) {
        case 'invalid-cwd':
        case 'invalid-branch':
            return [400, result];
        case 'not-a-repository':
        case 'checkout-failed':
        case 'create-failed':
            return [409, result];
        case 'git-missing':
            return [503, result];
        default:
            return [500, result];
    }
}
const cwdOf = (body) => (body !== null && typeof body === 'object' ? body.cwd : undefined);
const pairOf = (body) => body !== null && typeof body === 'object' ? [body.cwd, body.name] : undefined;
const isString = (value) => typeof value === 'string';
const isPair = (value) => Array.isArray(value) && isString(value[0]) && isString(value[1]);
export function createGitRoutes({ repository }) {
    return [
        {
            path: GIT_BRANCHES_PATH,
            limit: LIMIT,
            pick: cwdOf,
            check: isString,
            reason: 'cwd 必须是字符串',
            run: async (_ctx, cwd) => reply(await repository.snapshot(cwd)),
        },
        {
            path: GIT_CHECKOUT_PATH,
            limit: LIMIT,
            pick: pairOf,
            check: isPair,
            reason: 'cwd 与 name 必须是字符串',
            run: async (_ctx, value) => reply(await repository.checkout(value[0], value[1])),
        },
        {
            path: GIT_CREATE_BRANCH_PATH,
            limit: LIMIT,
            pick: pairOf,
            check: isPair,
            reason: 'cwd 与 name 必须是字符串',
            run: async (_ctx, value) => reply(await repository.createBranch(value[0], value[1])),
        },
    ];
}
