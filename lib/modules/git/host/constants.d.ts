export declare const NAME = "dsh-toolkit-git";
export declare const GIT_BRANCHES_PATH: string;
export declare const GIT_CHECKOUT_PATH: string;
export declare const GIT_CREATE_BRANCH_PATH: string;
export declare const GIT_PUBLISH_PREVIEW_PATH: string;
export declare const GIT_PUBLISH_ACTION_PATH: string;
export declare const MAX_PUBLISH_MESSAGE_LENGTH = 4000;
/** 一次最多列多少条本地分支：再多也不适合一个弹层，且 `for-each-ref` 的输出要兜住。 */
export declare const MAX_BRANCH_LIST = 200;
/** 分支名上限。Git 自己按引用名长度兜底，这里先挡住明显异常的输入。 */
export declare const MAX_BRANCH_NAME_LENGTH = 200;
/** 单条 git 命令的超时：切分支/列分支都在本地，15s 足够；超时当失败处理，不无限挂住 UI。 */
export declare const GIT_TIMEOUT_MS = 15000;
/**
 * 推送的超时：要传对象、可能走慢网，15s 常常不够。超时仍然会终止进程（不是挂住），
 * 只是给得比本地操作宽一些。
 */
export declare const GIT_PUSH_TIMEOUT_MS = 120000;
/** 内置工具的名字：宿主把它们和别的工具一起放进模型上下文，前缀保持模块化。 */
export declare const PUSH_TOOL_NAME = "git_push";
export declare const BRANCH_TOOL_NAME = "git_branch_create";
export declare const COMMIT_TOOL_NAME = "git_commit";
export declare const SYNC_TOOL_NAME = "git_sync";
export declare const DELETE_TOOL_NAME = "git_branch_delete";
export declare const RENAME_TOOL_NAME = "git_branch_rename";
/** 系统提示词段的注册名；同一段重复注册会被宿主换掉，因此带上模块前缀。 */
export declare const PROMPT_SECTION = "dsh-toolkit:git";
/**
 * 段顺序：8000 —— 排在各工具的用法说明（TOOL_*，1000 起）之后、交付物与结构化输出
 * （9000 起）之前。它约束的是「怎么写 commit、怎么推」，属于工作习惯而不是身份设定。
 */
export declare const PROMPT_ORDER = 8000;
/** 不预填任何前缀：DSH 不是 Qoder，默认不该把别人的分支风格强加给用户的仓库。 */
export declare const DEFAULT_BRANCH_PREFIX = "";
export declare const DEFAULT_ALWAYS_FORCE_PUSH = false;
export declare const DEFAULT_COMMIT_INSTRUCTIONS = "";
/** 一个分支前缀再长也没有意义；Git 自己会在 255 左右报错，这里先兜住。 */
export declare const MAX_BRANCH_PREFIX_LENGTH = 100;
/** 提交说明指令是「一句话风格要求」，4000 字足够把 Conventional Commits 写清楚。 */
export declare const MAX_COMMIT_INSTRUCTIONS_LENGTH = 4000;
/**
 * 归一化用户输入：去掉首尾空白、把 `a//b` 收成 `a/b`、去掉开头的 `/`。
 * 这些是纯粹的「手滑」形态，静默修正比弹错更有用。
 */
export declare function normalizeBranchPrefix(value: string): string;
/**
 * 合法分支前缀的判定（空串也算合法：表示不加前缀）。
 *
 * 只放行 ASCII 字母数字与 `. _ - /`；`..` 与开头的 `-` 会让 `git checkout` 把它当成
 * 版本范围或选项，`/` 开头的引用名 Git 也不接受。结尾的 `/` 是允许的（`dsh/`）。
 */
export declare function isBranchPrefix(value: string): boolean;
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
export declare function isBranchName(value: string): boolean;
/**
 * 路由层把领域结果折算成 HTTP 状态码用的原因表。
 *
 * `4xxx` 是「这次请求/当前状态不允许」（改输入或等会话闲下来可能变），`5xxx` 是环境坏了。
 * 数值本身只在 routes 里换状态码用；client 读的是 `reason` 字符串，写在这里是为了让
 * 「有哪些失败」集中可见，而不是散落在 `if (x.code === 4102)` 里。
 */
export declare const GIT_REASON: {
    readonly invalidCwd: 4101;
    readonly invalidBranch: 4102;
    readonly notRepository: 4103;
    readonly checkoutFailed: 4104;
    readonly createFailed: 4105;
    readonly commitFailed: 4106;
    readonly syncFailed: 4107;
    readonly deleteFailed: 4108;
    readonly renameFailed: 4109;
    readonly gitMissing: 5201;
};
export declare const GIT_PUBLISH_REASON: {
    readonly 'invalid-cwd': 4101;
    readonly 'not-a-repository': 4103;
    readonly 'commit-failed': 4106;
    readonly 'detached-head': 4110;
    readonly 'nothing-staged': 4111;
    readonly 'stale-preview': 4112;
    readonly 'no-push-destination': 4113;
    readonly 'push-behind': 4114;
    readonly 'push-failed': 4115;
    readonly 'nothing-to-push': 4116;
    readonly 'invalid-message': 4117;
    readonly 'commit-in-progress': 4118;
    readonly 'git-missing': 5201;
};
/** `GIT_REASON` 反向查：`snapshot` 里给 client 的是稳定的字符串 key。 */
export type GitReasonKey = 'invalid-cwd' | 'invalid-branch' | 'not-a-repository' | 'checkout-failed' | 'create-failed' | 'commit-failed' | 'sync-failed' | 'delete-failed' | 'rename-failed' | 'stale-preview' | 'git-missing';
/**
 * 归一化提交说明：统一换行符、去掉控制字符（保留 `\n` 与 `\t`）、裁掉首尾空白、截断超长部分。
 * 它最终会进系统提示词，控制字符（尤其是 `\u001b`）只会让提示词变成噪声。
 */
export declare function normalizeCommitInstructions(value: string): string;
