/**
 * `src/task/actions.ts`：浏览器动作执行（填值/点击/悬停/拖拽/按键）、加载等待与可见文本读取。
 */
import { type AgentBrowser, type Snapshot } from '../cli.js';
import { type TaskCandidate, type TaskDeps } from './types.js';
/**
 * 有值时直接执行（不再交回宿主）：
 * - 原生 select（带 `options`、`tag=select` 或状态为 `当前值:`）→ `select`；
 * - `<input role="combobox">`（如 GitHub 搜索框，状态为 `已有内容:` 或空）→ `fill`；
 * - checkbox/radio/switch → `check`/`uncheck`；
 * - 其它 → `fill`。
 */
export declare function fillFromInputs(browser: AgentBrowser, candidate: TaskCandidate, value: string, signal: AbortSignal): Promise<void>;
/** `control:wait`：等到页面真的变，而不是固定睡 800ms。 */
export declare function waitForPageChange(browser: AgentBrowser, signal: AbortSignal): Promise<void>;
/** 页面是否有阻塞的 JS 对话框：有就返回它的文案。 */
export declare function dialogBlocker(browser: AgentBrowser, signal: AbortSignal): Promise<string | undefined>;
/** 执行单个候选动作。 */
export declare function execute(browser: AgentBrowser, candidate: TaskCandidate, signal: AbortSignal, inputs?: Readonly<Record<string, string>>): Promise<{
    jsClicked?: {
        id: string;
        ref: string;
    };
}>;
/** 页面可见正文：`goal_done` 与独立确认的依据。 */
export declare function visibleText(deps: TaskDeps, snapshot: Snapshot, trace: string[], step: number | undefined): Promise<string>;
//# sourceMappingURL=actions.d.ts.map