/**
 * `src/task/gates.ts`：确定性门控、字段状态核对、URL/提交完成证据与次优候选选择。
 */
import { FOLLOW_UP_VERBS, type TaskCandidate } from './types.js';
/** 从抽取的 `state` 文本里读出"当前状态"。 */
export declare function stateOf(candidate: TaskCandidate): {
    checked?: boolean;
    value?: string;
    redacted?: boolean;
};
/** 候选当前值是否已等于期望值（含原生 `<select>` 的 label ↔ value 映射，如 `Two` ↔ `2`）。 */
export declare function valueMatchesCandidate(candidate: TaskCandidate, currentValue: string, wanted: string): boolean;
/** 调用方给的字段值 → 候选。模糊匹配只接受完整词组前缀，且必须唯一。 */
export declare function matchInputValue(candidate: TaskCandidate, inputs?: Readonly<Record<string, string>>): string | undefined;
/** 在当前页面候选中建立无歧义的 key→字段映射；任何多对一或一对多都不自动绑定。 */
export declare function inputMatchesOf(candidates: readonly TaskCandidate[], inputs?: Readonly<Record<string, string>>): ReadonlyMap<string, {
    key: string;
    value: string;
}>;
/**
 * 状态守卫：这个候选是不是已经满足目标、不需要再操作。
 *
 * 支持多子句目标（如 "Make checkbox 1 checked and checkbox 2 unchecked"）：
 * 优先取点名了当前候选名字的那个子句来判定开启/关闭。
 */
export declare function isAlreadySatisfied(candidate: TaskCandidate, goal: string, inputs?: Readonly<Record<string, string>>): boolean;
/** 调用方给的 key 是不是就是这个字段的名字（归一后完全相等）。 */
export declare function specificallyNamed(candidate: TaskCandidate, inputs?: Readonly<Record<string, string>>): boolean;
/** 这个候选是不是"文本输入字段"（不是下拉/勾选）。 */
export declare function isTextEntry(candidate: TaskCandidate): boolean;
/** 通用值 key 在空文本字段里挑哪个：只按目标词面相关性确定性排序，不猜。 */
export declare function bestEmptyInputForGoal(candidates: readonly TaskCandidate[], goal: string, filled?: ReadonlyMap<string, string>): TaskCandidate | undefined;
/**
 * 调用方给了值、但页面状态还没生效的字段。
 *
 * `consumedByEnter`：已经通过按 Enter 提交消费掉的输入框（如 TodoMVC 新建条目后输入框变回空串），
 * 变空是正常消费，不再当作"被站点清空需重填"。
 */
export declare function pendingFieldOf(candidates: readonly TaskCandidate[], inputs?: Readonly<Record<string, string>>, goal?: string, filled?: ReadonlyMap<string, string>, exhausted?: ReadonlySet<string>, consumedByEnter?: ReadonlySet<string>, consumedValues?: ReadonlySet<string>): TaskCandidate | undefined;
/**
 * 多跳纯导航目标（如 "Open the cart and go to checkout"）：
 * 每个子句都是导航动作时，返回最后一个子句（即最终目的地 "go to checkout"）。
 */
export declare function finalNavigationClauseOf(goal: string): string | undefined;
/**
 * 导航类目标的确定性证据：目标里的特征词出现在"当前地址相对起始地址新增的那一段"里。
 */
export declare function urlChangeMatchesGoal(goal: string, startUrl: string, currentUrl: string): string | undefined;
/** 控件名里的提交类动词（没有就是 undefined）。 */
export declare function submitControlOf(name: string): string | undefined;
/** 明显的浏览器错误页（导航失败）——正文"变了"但目标没达成。 */
export declare function looksLikeErrorPage(text: string, title?: string): boolean;
/** 这一类目标不允许用"提交类控件已点击 + 页面变了"收尾。 */
export declare function namedSubmitGoal(goal: string): boolean;
/** 调用方给的值是否全部已经在页面上生效（纯确定性，不看判断层）。 */
export declare function inputsApplied(candidates: readonly TaskCandidate[], inputs?: Readonly<Record<string, string>>, filled?: ReadonlyMap<string, string>, goal?: string, verified?: ReadonlySet<string>): boolean;
/** 页面上只有一个输入框、调用方又只给了一个值时的兜底绑定。 */
export declare function soleValueFor(candidates: readonly TaskCandidate[], inputs?: Readonly<Record<string, string>>): string | undefined;
/** "填一下、然后提交"这类两动作单目标（Type into X, then submit）。 */
export declare function fillThenSubmitGoal(goal: string): boolean;
/** 目标是不是一个子目标：多子目标不能在第一步做完就按单步收尾。 */
export declare function singleStepGoal(goal: string): boolean;
/** 下拉选择是否就是目标要的那个选项：选中的 label 出现在目标文字里。 */
export declare function selectionMatchesGoal(goal: string, candidate: TaskCandidate, given: string): string | undefined;
/**
 * 从 choice 的完整概率分布里取次优候选。
 * `minProbability`：循环内调用时传入 `ALTERNATE_MIN_PROBABILITY`（0.25），
 * 防止在首选无效时去点 p=0.06 的无关链接把页面导航走。
 */
export declare function pickAlternate(probabilities: Readonly<Record<string, number>> | undefined, excluded: ReadonlySet<string>, allowed: ReadonlySet<string>, minProbability?: number): string | undefined;
export { FOLLOW_UP_VERBS };
//# sourceMappingURL=gates.d.ts.map