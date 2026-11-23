/**
 * 循环引擎的接缝。
 *
 * 这套「观察 → 生成候选 → 判定 → 执行 → 复核」的循环原先生长在 browser 模块里
 * （`src/modules/browser/host/task/`），驱动的是 `agent-browser` CLI。browser 模块整体删除后，
 * 循环本身与具体浏览器无关 —— 值得留下，于是连同候选/门控/判定/动作一起搬到 mobile 下。
 *
 * 这里刻意**只声明循环真正用到的能力**，任何能满足这些能力的引擎都能驱动它：
 * - 宿主 ego lite（`ego-browser nodejs` 脚本）
 * - DSH 内置浏览器（Electron `webContents.debugger`）
 * - mobilecli（UI 树 + 坐标点击）
 *
 * 与原实现的两处差别，都是为了让「接缝」不绑死 agent-browser 的命令行：
 * 1. 原来直接拼 CLI 子命令的地方（`eval <script>`、`wait <ms>`、`dialog status|accept|dismiss`、
 *    `back`）提升成具名方法（`evalScript` / `wait` / `dialogStatus` / `dialogResolve` / `back`），
 *    引擎自己决定怎么实现；
 * 2. 原实现用 `typeof browser.json === 'function'` 做能力嗅探（`observe` / `extract` 同理），
 *    这里保留同一手法：**可选方法缺席 = 该引擎不支持这条捷径**，循环退回到通用路径。
 *
 * 错误语义沿用原来的 `CliError`（名字是历史包袱）：`code` 是稳定短标识
 * （`bad-output` / `timeout` / `aborted` / `cli-failed` / `bad-request` / `spawn-failed` / …），
 * 文案放 `message`。循环里靠 `code` 分类、靠 `message` 上报。
 */
import type { ExtractedItem, ExtractedPage } from './extract.js';
export type { ExtractedItem, ExtractedPage };
/** 引擎每类调用的公共选项。 */
export interface EngineRunOptions {
    readonly stdin?: string;
    readonly signal?: AbortSignal;
    /** 覆盖该次调用默认超时。 */
    readonly timeoutMs?: number;
}
/** 快照里一个可交互节点的元数据。 */
export interface RefInfo {
    readonly name: string;
    readonly role: string;
    /**
     * 快照文本里被标了 `clickable` 的**非语义元素**（真机：hao123 顶部的城市切换是 `generic`）。
     * JSON 的 refs 不区分这个，只有文本树有 —— 不读它，这类可点的容器就永远进不了候选。
     */
    readonly clickable?: boolean;
}
/** 归一化后的快照（只保留循环真正用到的字段）。 */
export interface Snapshot {
    /** 页面 origin / URL。 */
    readonly origin: string;
    /** 无障碍树文本（带 `[ref=eN]`）。 */
    readonly snapshot: string;
    readonly refs: Readonly<Record<string, RefInfo>>;
    /** 本次快照相对上次消失的 ref（引擎直接给，用于新鲜度判断的辅助信号）。 */
    readonly removedRefs: readonly string[];
    /** `origin + snapshot` 的指纹：执行前比对"页面是否变了"。 */
    readonly digest: string;
    /**
     * 可见正文的指纹。抽取路径的 `snapshot` 只有"控件名+状态"，短正文（如 "Loading..."）
     * 根本进不去，于是"点了开始加载"被判成"页面没变"（bench fixture-lazy 暴露）。
     */
    readonly textDigest?: string;
}
/** `observe()` 的返回：树 + 可见正文 + 标题。 */
export interface ObservedPage extends Snapshot {
    readonly text: string;
    readonly title: string;
}
/** 循环要的引擎能力。 */
export interface LoopEngine {
    /** 取一次无障碍树快照。 */
    snapshot(options?: SnapshotOptions, run?: EngineRunOptions): Promise<Snapshot>;
    /** 一次调用拿齐"决策需要的一切"：树 + 可见正文 + 标题。缺席时循环退回 `snapshot + read`。 */
    observe?(options?: SnapshotOptions, run?: EngineRunOptions): Promise<ObservedPage>;
    /** 页面内预抽的紧凑候选 + 正文 + 标题（一次拿齐）。缺席时循环退回整棵树。 */
    extract?(run?: ExtractedRunOptions): Promise<ExtractedPage>;
    /** 读正文：可协商 markdown / llms.txt；`undefined` = 当前页。 */
    read(url: string | undefined, run?: EngineRunOptions): Promise<string>;
    /** `get <what> [selector] [attr]`：text / value / title / url / html / count / box … */
    get(what: string, selector: string | undefined, attrName: string | undefined, run?: EngineRunOptions): Promise<string>;
    /** 一个变更类动作。**一次一个，永远不串。** */
    act(action: string, target: string, payload?: ActionPayload, run?: EngineRunOptions): Promise<void>;
    /** 在页面内执行一段脚本并返回结果。缺席时"深度设值/合成点击"这类捷径不可用。 */
    evalScript?(script: string, run?: EngineRunOptions): Promise<unknown>;
    /** 合成 click（能进 shadow root / iframe）。缺席时退回 `act('click')`。 */
    jsClick?(ref: string, run?: EngineRunOptions): Promise<void>;
    /** 合成拖拽（HTML5 拖拽只有合成事件才生效）。缺席时退回 `act('drag')`。 */
    jsDrag?(sourceRef: string, targetRef: string, run?: EngineRunOptions): Promise<void>;
    /** 原地等待（毫秒）。缺席时用本地定时器。 */
    wait?(ms: number, run?: EngineRunOptions): Promise<void>;
    /** 页面是否有阻塞的 JS 对话框；返回引擎原样的状态文本，由调用方解析。 */
    dialogStatus?(run?: EngineRunOptions): Promise<string>;
    /** 接受 / 关闭卡住的 JS 对话框。 */
    dialogResolve?(accept: boolean, run?: EngineRunOptions): Promise<void>;
    /** 后退。 */
    back?(run?: EngineRunOptions): Promise<void>;
    /** 等文档就绪（有界，超时返回 false，不阻塞）。 */
    waitForReady?(run?: EngineRunOptions & {
        timeoutMs?: number;
    }): Promise<boolean>;
    /** 等"点击后页面真的动了"（URL / 正文 / 指定选择器，任一满足即返回）。 */
    waitForPageShift?(previous: PageShiftBaseline, run?: EngineRunOptions & {
        timeoutMs?: number;
    }): Promise<boolean>;
}
export interface SnapshotOptions {
    readonly interactiveOnly?: boolean;
    readonly depth?: number;
    readonly selector?: string;
    readonly urls?: boolean;
}
export interface ExtractedRunOptions extends EngineRunOptions {
    readonly includeMedia?: boolean;
}
export interface ActionPayload {
    readonly value?: string;
    readonly values?: readonly string[];
    readonly direction?: string;
    readonly amount?: number;
}
/** `waitForPageShift` 的基线：上一个页面长什么样。 */
export interface PageShiftBaseline {
    readonly url: string;
    readonly textSample: string;
    readonly selector?: string;
}
/**
 * 引擎失败。（名字沿用旧模块的 `CliError`：循环里的 `error.code` 分类逻辑照搬，不值得为此改名。）
 *
 * `code` 只写稳定短标识，人看的文案放 `message` —— 不要为了本地化去改 code。
 */
export declare class CliError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
