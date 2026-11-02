/**
 * `src/task/types.ts`：决策循环的公共类型、阈值常量与状态契约。
 */
import type { Judge } from 'dsh-judgment/contract';
import type { AgentBrowser, Snapshot } from '../cli.js';
/** 本插件编译时对齐的契约版本。不匹配就降级（dsh-judgment 契约 §13.3）。 */
export declare const EXPECTED_API_VERSION = 1;
/** 点击候选上限（实测可答上限）。 */
export declare const MAX_CLICK_CANDIDATES = 40;
/** 一次判断最多送多少个候选。 */
export declare const JUDGE_OPTION_CAP: number;
/** 状态里快照文本的上限（字符）。 */
export declare const SNAPSHOT_STATE_CAP = 6000;
/** `goal_done` 之后的独立确认阈值。 */
export declare const GOAL_CONFIRM_THRESHOLD = 0.8;
/** 登录墙判定阈值（ykl 用 0.7）。 */
export declare const LOGIN_THRESHOLD = 0.75;
/** 「点的控件是不是目标对象」的阈值：低于它就否决确认（同名导航链接）。 */
export declare const TARGET_MATCH_THRESHOLD = 0.6;
/** 确认问题里正文的截断长度。 */
export declare const CONFIRM_TEXT_CAP = 2000;
/** 同一个字段"填了又被站点清空"时最多重填几次（有界，避免与站点脚本拉锯）。 */
export declare const MAX_REFILLS = 2;
/** 一次二阶段 select 最多送多少个选项。 */
export declare const SELECT_OPTION_CAP = 20;
/** diff 列表每类最多保留几条。 */
export declare const DIFF_ITEM_CAP = 4;
/** 页面可见正文的最短有效长度。 */
export declare const MIN_PAGE_TEXT = 40;
/** 页面报错的判定阈值。 */
export declare const PAGE_ERROR_THRESHOLD = 0.8;
/** goal_done 的"中间带"下界。 */
export declare const LIKELY_DONE_FLOOR = 0.6;
/** 中间带里独立确认到这个概率才算 likely_done。 */
export declare const LIKELY_CONFIRM_FLOOR = 0.6;
/** 一次 task 里最多等几轮（每轮最多 6s）。 */
export declare const WAIT_BUDGET = 3;
export declare const AMBIGUOUS_CONFIDENCE = 0.45;
export declare const AMBIGUOUS_GAP = 0.15;
/** 不可逆动作的判定阈值。 */
export declare const IRREVERSIBLE_THRESHOLD = 0.7;
/**
 * 次优候选换路的**最低概率底线**：
 * 首选动作无效时，如果分布里的次优候选连 0.25 都不到（例如 todomvc-fine 里 p=0.06 的外链），
 * 说明 Jev 已经不知道该点谁——此时绝不乱点破坏现场，直接停下交回上游 LLM 决策。
 */
export declare const ALTERNATE_MIN_PROBABILITY = 0.25;
export declare const MIN_JUDGE_OPTIONS = 4;
/** 一次决策最多重采几次。 */
export declare const MAX_RESAMPLES = 3;
/** 永远存在的控制项（保证 choice 选项数 ≥ 2）。 */
export declare const CONTROL_CANDIDATES: readonly TaskCandidate[];
export declare const CLICKABLE_ROLES: Set<string>;
export declare const TEXT_ENTRY_ROLES: Set<string>;
/** goal 里的"开启/关闭"动词：状态守卫用（已处于目标状态就不必再点）。注意用整词边界避免 `checkbox`/`unchecked` 误命中 `check`，`complete` 需带 `mark` 避免误命中 "Show only the completed todos"。 */
export declare const ENABLE_VERBS: RegExp;
export declare const DISABLE_VERBS: RegExp;
/** 目标是"搜索/查找"：这类目标填完搜索框之后，Enter 就是提交搜索的确定性语义。 */
export declare const SEARCH_GOALS: RegExp;
/** 目标是不是明确的导航目标（"打开/进入/跳到某页面"）。 */
export declare const NAVIGATION_GOALS: RegExp;
/** 目标里出现这些词 = 填完值之后还要再做一步（提交/搜索/登录/添加…），不能按"值已生效"收尾。 */
export declare const FOLLOW_UP_VERBS: RegExp;
/** 「点一下就等于提交/搜索/继续/完成/清空」的控件动词。 */
export declare const SUBMIT_CONTROL_VERBS: RegExp;
/** 看起来是密钥/凭据的字段名：只把 key 交给判断层，值绝不出门。 */
export declare const SECRET_KEY: RegExp;
/** 页面处于异步加载中的文本标记（含 ti-dynamic-controls 的 "Wait for it..."）。 */
export declare const LOADING_TEXT_MARK: RegExp;
export type TaskStatus = 'needs_verification' | 'blocked' | 'no_progress' | 'budget' | 'input_required' | 'judge_error' | 'action_error' | 'needs_confirmation' | 'page_error' | 'likely_done' | 'ambiguous' | 'needs_login';
export interface TaskCandidate {
    readonly id: string;
    readonly description: string;
    readonly kind: 'click' | 'control' | 'input';
    readonly ref?: string;
    readonly role?: string;
    readonly name?: string;
    readonly state?: string;
    readonly options?: readonly {
        readonly label: string;
        readonly value: string;
    }[];
    readonly near?: string;
    readonly tag?: string;
    readonly targetRef?: string;
    /** 语义区域：`true` = 主内容区，`false` = 全局导航/页头/页脚。 */
    readonly inMain?: boolean;
    /** 物理输入类型（如 `password` / `search` / `email` / `submit` / `text`），与语言无关。 */
    readonly inputType?: string;
    /** HTML 标准自动填充语义（如 `username` / `current-password` / `one-time-code`）。 */
    readonly autocomplete?: string;
    /** DOM 最小容器分组 ID（如 `g1`），同一局部容器内的控件共享。 */
    readonly groupId?: string;
    /** 容器分组的简短标签（来自 legend / aria-label / 组内标题）。 */
    readonly groupLabel?: string;
    /** 所属表单 ID。 */
    readonly formId?: string;
    /** 由 DOM 顺序、role 与标准 input 属性生成，不含页面文案。 */
    readonly groupSignature?: string;
    /** 由物理属性与组内拓扑自动推导的语义槽位（零文字依赖）。 */
    readonly groupRole?: 'username' | 'password' | 'submit' | 'search' | 'otp';
}
export interface TaskStep {
    readonly step: number;
    readonly phase?: number;
    readonly origin: string;
    readonly digest: string;
    readonly action: string;
    readonly executed: boolean;
    readonly reason: string;
    readonly goalDone?: number;
    readonly stuck?: number;
    readonly confidence?: number;
    readonly stateChanged?: boolean;
    readonly alternateOf?: string;
    readonly confirm?: number;
}
export interface TaskTimings {
    readonly snapshotMs: number;
    readonly readMs: number;
    readonly titleMs: number;
    readonly askMs: number;
    readonly actMs: number;
    readonly totalMs: number;
}
export interface TaskResult {
    readonly status: TaskStatus;
    readonly reason: string;
    readonly steps: readonly TaskStep[];
    readonly trace: readonly string[];
    readonly url: string;
    readonly usage: {
        readonly calls: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly estCostUsd: number;
    };
    readonly timings: TaskTimings;
    /**
     * 交回上游 LLM 时的现场候选（带 `ref` 句柄，主模型可直接用 `browser_act` 执行，无需再取一次 snapshot）。
     */
    readonly candidates?: readonly {
        readonly id: string;
        readonly description: string;
        readonly ref?: string;
    }[];
    /** 交回上游 LLM 时的页面可见正文摘要。 */
    readonly pageText?: string;
    readonly next?: string;
}
export declare class JudgeUnavailableError extends Error {
    readonly code = "judge-unavailable";
    constructor(message: string);
}
export interface TaskDeps {
    readonly browser: AgentBrowser;
    readonly judge: Judge | undefined;
    readonly purpose: string;
    readonly maxSteps: number;
    readonly goalThreshold: number;
    readonly stuckThreshold: number;
    readonly signal: AbortSignal;
    readonly inputs?: Readonly<Record<string, string>>;
    readonly allowIrreversible?: boolean;
}
export interface TaskSubgoal {
    readonly goal: string;
    readonly inputs?: Readonly<Record<string, string>>;
}
export type LastChange = Record<string, boolean | string[]>;
export interface ValidationNumbers {
    readonly optionCount?: number;
    readonly sum?: number;
    readonly tolerance?: number;
}
export type { Snapshot };
/** 结束状态 → 交回宿主的下一步提示。 */
export declare const NEXT_HINTS: Readonly<Record<TaskStatus, string>>;
//# sourceMappingURL=types.d.ts.map