/**
 * Git 偏好的共享定义：常量 + 纯规则。
 *
 * 规则函数放在 constants.ts 而不是 `config.ts`：面板必须在**写之前**就告诉用户
 * 「这个前缀不合法」，而 client 只能 import host 下的 `constants.ts`。两边各写一份
 * 正则必然漂移（历史教训：browser 与 judgment 的两份 primitives），所以规则只此一份。
 * 这里不许出现任何 Node 依赖——client 也会求值它。
 */
import { pluginApiPath } from '../../../host/paths.js';
export const NAME = 'dsh-toolkit-git';
/** 分支面板的三条路由：与设置面板无关，它们服务 composer 里的分支按钮。 */
const API_PREFIX = pluginApiPath('git');
export const GIT_BRANCHES_PATH = `${API_PREFIX}/branches`;
export const GIT_CHECKOUT_PATH = `${API_PREFIX}/checkout`;
export const GIT_CREATE_BRANCH_PATH = `${API_PREFIX}/create-branch`;
/**
 * 工作区改动的行数统计（`+新增 / -删除`）。
 *
 * 单独一条路由而不是塞进 `branches`：分支快照是切分支/开弹层要的，
 * 而统计每次面板轮询都会来问，两类读取的代价与频率差了一个量级。
 */
export const GIT_CHANGES_PATH = `${API_PREFIX}/changes`;
/** 一次最多列多少条本地分支：再多也不适合一个弹层，且 `for-each-ref` 的输出要兜住。 */
export const MAX_BRANCH_LIST = 200;
/** 分支名上限。Git 自己按引用名长度兜底，这里先挡住明显异常的输入。 */
export const MAX_BRANCH_NAME_LENGTH = 200;
/** 单条 git 命令的超时：切分支/列分支都在本地，15s 足够；超时当失败处理，不无限挂住 UI。 */
export const GIT_TIMEOUT_MS = 15_000;
/**
 * 推送的超时：要传对象、可能走慢网，15s 常常不够。超时仍然会终止进程（不是挂住），
 * 只是给得比本地操作宽一些。
 */
export const GIT_PUSH_TIMEOUT_MS = 120_000;
/** 内置工具的名字：宿主把它们和别的工具一起放进模型上下文，前缀保持模块化。 */
export const PUSH_TOOL_NAME = 'git_push';
export const BRANCH_TOOL_NAME = 'git_branch_create';
export const COMMIT_TOOL_NAME = 'git_commit';
export const SYNC_TOOL_NAME = 'git_sync';
export const DELETE_TOOL_NAME = 'git_branch_delete';
export const RENAME_TOOL_NAME = 'git_branch_rename';
/** 系统提示词段的注册名；同一段重复注册会被宿主换掉，因此带上模块前缀。 */
export const PROMPT_SECTION = 'dsh-toolkit:git';
/**
 * 段顺序：8000 —— 排在各工具的用法说明（TOOL_*，1000 起）之后、交付物与结构化输出
 * （9000 起）之前。它约束的是「怎么写 commit、怎么推」，属于工作习惯而不是身份设定。
 */
export const PROMPT_ORDER = 8000;
/** 不预填任何前缀：DSH 不是 Qoder，默认不该把别人的分支风格强加给用户的仓库。 */
export const DEFAULT_BRANCH_PREFIX = '';
export const DEFAULT_ALWAYS_FORCE_PUSH = false;
export const DEFAULT_COMMIT_INSTRUCTIONS = '';
/** 一个分支前缀再长也没有意义；Git 自己会在 255 左右报错，这里先兜住。 */
export const MAX_BRANCH_PREFIX_LENGTH = 100;
/** 提交说明指令是「一句话风格要求」，4000 字足够把 Conventional Commits 写清楚。 */
export const MAX_COMMIT_INSTRUCTIONS_LENGTH = 4000;
/**
 * 归一化用户输入：去掉首尾空白、把 `a//b` 收成 `a/b`、去掉开头的 `/`。
 * 这些是纯粹的「手滑」形态，静默修正比弹错更有用。
 */
export function normalizeBranchPrefix(value) {
    return value.trim().replace(/\/{2,}/g, '/').replace(/^\/+/, '');
}
/**
 * 合法分支前缀的判定（空串也算合法：表示不加前缀）。
 *
 * 只放行 ASCII 字母数字与 `. _ - /`；`..` 与开头的 `-` 会让 `git checkout` 把它当成
 * 版本范围或选项，`/` 开头的引用名 Git 也不接受。结尾的 `/` 是允许的（`dsh/`）。
 */
export function isBranchPrefix(value) {
    if (value === '')
        return true;
    if (value.length > MAX_BRANCH_PREFIX_LENGTH)
        return false;
    if (!/^[A-Za-z0-9._/-]+$/.test(value))
        return false;
    if (value.startsWith('-') || value.startsWith('/'))
        return false;
    if (value.includes('..'))
        return false;
    if (value === '.' || value.endsWith('/.'))
        return false;
    return true;
}
/**
 * 合法分支名（完整名字，不是前缀）。
 *
 * 它是 `git check-ref-format --branch` 的**离线近似**：面板要在点「创建」之前就把
 * 明显非法的名字挡下来，不能等一次往返。真正的裁决仍然是 git 自己——路由里会再跑
 * 一次 `check-ref-format`，这里只过滤掉「一定是错的」输入。
 *
 * 逐条对应 Git 的引用名规则：
 * - 只放行 ASCII 字母数字与 `. _ - /`（空格、`~^:?*[`、反斜杠、控制字符都不行）；
 * - 不以 `-` 开头（`git switch` 会当成选项）、不以 `/` 开头或结尾、没有 `//`；
 * - 不含 `..`（`rev..other` 是范围语法）与 `@{`（reflog 语法）；整名不能是 `@`；
 * - 每一段不能以 `.` 开头、不能以 `.lock` 结尾。
 */
export function isBranchName(value) {
    if (value === '' || value.length > MAX_BRANCH_NAME_LENGTH)
        return false;
    if (!/^[A-Za-z0-9._/-]+$/.test(value))
        return false;
    if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/'))
        return false;
    if (value.includes('..') || value.includes('//') || value.includes('@{'))
        return false;
    if (value === '@' || value.endsWith('.'))
        return false;
    for (const part of value.split('/')) {
        if (part === '' || part.startsWith('.') || part.endsWith('.lock'))
            return false;
    }
    return true;
}
/**
 * 路由层把领域结果折算成 HTTP 状态码用的原因表。
 *
 * `4xxx` 是「这次请求/当前状态不允许」（改输入或等会话闲下来可能变），`5xxx` 是环境坏了。
 * 数值本身只在 routes 里换状态码用；client 读的是 `reason` 字符串，写在这里是为了让
 * 「有哪些失败」集中可见，而不是散落在 `if (x.code === 4102)` 里。
 */
export const GIT_REASON = {
    invalidCwd: 4101,
    invalidBranch: 4102,
    notRepository: 4103,
    checkoutFailed: 4104,
    createFailed: 4105,
    commitFailed: 4106,
    syncFailed: 4107,
    deleteFailed: 4108,
    renameFailed: 4109,
    gitMissing: 5201,
};
/**
 * 归一化提交说明：统一换行符、去掉控制字符（保留 `\n` 与 `\t`）、裁掉首尾空白、截断超长部分。
 * 它最终会进系统提示词，控制字符（尤其是 `\u001b`）只会让提示词变成噪声。
 */
export function normalizeCommitInstructions(value) {
    return value
        .replace(/\r\n?/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, MAX_COMMIT_INSTRUCTIONS_LENGTH);
}
//# sourceMappingURL=constants.js.map