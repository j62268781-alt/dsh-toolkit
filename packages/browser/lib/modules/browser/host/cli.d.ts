/**
 * `agent-browser` CLI 的薄封装：spawn + JSON 信封解析 + 版本下限校验。
 *
 * 纪律（DESIGN v2 §3）：
 * - **不碰 CDP、不引 Playwright**：引擎永远是 CLI，这里只负责拼参数、收输出、判错误。
 * - **只用有结构输出的命令**：`--json` 是全局开关，但不是每个子命令都真有结构化结果；
 *   解析失败**明确报错**，绝不猜（`parsed.data` 缺失 = `CliError('bad-output')`）。
 * - **版本闸门**：只要求不低于 0.38.2（陈旧 ref 行为在 0.38.2 实测，DESIGN §1.1）；
 *   更新版本放行，不写上限——上限只会把可用的新版本误判成故障。
 */
import { type ExtractedItem } from './extract.js';
/** CLI 发回来的统一信封：`{ success, data, error }`（0.38.2 实测）。 */
export interface CliEnvelope<T> {
    readonly success: boolean;
    readonly data: T | null;
    readonly error: string | null;
}
/** `snapshot --json` 的 `data.refs` 条目。 */
export interface RefInfo {
    readonly name: string;
    readonly role: string;
    /**
     * 快照文本里被标了 `clickable` 的**非语义元素**（真机：hao123 顶部的城市切换是 `generic`）。
     * JSON 的 `refs` 不区分这个，只有文本树有——不读它，这类可点的容器就永远进不了候选。
     */
    readonly clickable?: boolean;
}
/** 归一化后的快照（只保留我们真正用到的字段）。 */
/** `extract()` 的返回：脚本预抽的紧凑候选 + 正文 + 标题 + URL（一次进程拿齐）。 */
export interface ExtractedPage {
    readonly items: readonly ExtractedItem[];
    readonly text: string;
    readonly title: string;
    readonly url: string;
    /** 元素数达到抽取上限（300）：页面比这更大，目标可能没被抽到。 */
    readonly truncated?: boolean;
}
/** `observe()` 的返回：树 + 可见正文 + 标题（一次进程拿齐）。 */
export interface ObservedPage extends Snapshot {
    readonly text: string;
    readonly title: string;
}
export interface Snapshot {
    /** CLI 的 `data.origin`（0.38.2 上 `data.url` 不存在）。 */
    readonly origin: string;
    /** 无障碍树文本（带 `[ref=eN]`）。 */
    readonly snapshot: string;
    readonly refs: Readonly<Record<string, RefInfo>>;
    /** 本次快照相对上次消失的 ref（CLI 直接给，用于新鲜度判断的辅助信号）。 */
    readonly removedRefs: readonly string[];
    /** `origin + snapshot` 的指纹：执行前比对"页面是否变了"。 */
    readonly digest: string;
    /**
     * 可见正文的指纹。抽取路径的 `snapshot` 只有"控件名+状态"，短正文（如 "Loading..."）
     * 根本进不去，于是"点了开始加载"被判成"页面没变"（bench fixture-lazy 暴露）。
     */
    readonly textDigest?: string;
}
/**
 * 支持的最低 CLI 版本。
 *
 * **只锁下限，不锁上限**：DESIGN §1.1 的实测（陈旧 ref 的两种措辞、同名顺位回退）是在 0.38.2 上做的，
 * 因此 0.38.2 以下不承诺；而向上没有证据表明会破坏——0.39.1 上已复验本插件实际用到的
 * 全部命令（`--version` / `snapshot -i --json` / `batch --json` / `get title` / `eval -b` /
 * `click @ref`，以及陈旧 ref 仍返回 `Unknown ref`），输出结构与 0.38.2 一致。
 *
 * 早先的 `[0.38.0, 0.39.0)` 会在用户升到 0.39.x 后把**可用的环境**判成失败，
 * 这是纯粹的误报：拒绝一个能用的 CLI，比"少验证一个次版本"代价大得多。
 */
export declare const SUPPORTED_MIN = "0.38.2";
export declare class CliError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface CliRunOptions {
    readonly stdin?: string;
    readonly signal?: AbortSignal;
    /** 覆盖默认超时（少数命令需要更长，例如 `install`）。 */
    readonly timeoutMs?: number;
}
export interface AgentBrowserOptions {
    /** `agent-browser` 可执行文件；空 = 走 PATH，并自动跳过 JS 包装层（见 `resolveCommand`）。 */
    readonly command: string;
    /** 每次调用都会带的全局参数（`--session` 等）。 */
    readonly globalArgs: readonly string[];
    readonly timeoutMs: number;
}
/** 命令是怎么定下来的——诊断要能说清"到底跑了哪个二进制"。 */
export interface ResolvedCommand {
    readonly command: string;
    readonly kind: 'configured' | 'native' | 'wrapper' | 'name';
    readonly detail: string;
}
/**
 * 原生二进制的**文件名规则**——逐条移植 CLI 自带包装层 `bin/agent-browser.js` 的
 * `getBinaryName()`，不靠我们自己发明：
 *
 *   os:   darwin → darwin · linux → linux（musl → linux-musl）· win32 → win32
 *   arch: x64/x86_64 → x64 · arm64/aarch64 → arm64
 *   win32 + arm64：先看有没有 `agent-browser-win32-arm64.exe`，没有就退 x64（走系统模拟）
 *   后缀：win32 加 `.exe`
 *
 * **与版本无关**：这里没有任何版本号，规则跟着**已安装的那份 CLI** 走。
 */
export declare function nativeBinaryName(dir: string, platform: string, arch: string): string | undefined;
/** 同目录的原生二进制路径：`…/agent-browser/bin/agent-browser.js` → `…/bin/agent-browser-<os>-<arch>`。 */
export declare function nativeSiblingPath(scriptPath: string, platform: string, arch: string): string | undefined;
export declare function nativeSiblingOf(scriptPath: string, platform: string, arch: string): string | undefined;
/**
 * 解析真正要 spawn 的二进制。
 *
 * 实测（本机 0.38.2，见 DESIGN §3.1）：PATH 上的 `agent-browser` 是一个 **Node 包装脚本**
 * （Homebrew 与 npx 都如此），它再 spawn 一份原生二进制——每次调用白付一份 Node 启动：
 *
 *   走包装层（`agent-browser`）      --version 57.3ms · get title 57.1ms · snapshot -i 57.9ms
 *   直接原生二进制                   --version  3.1ms · get title  3.7ms · snapshot -i  5.1ms · click @e2 16.8ms
 *
 * 所以默认就走到原生二进制。这是**纯收益**：同一个二进制、同一个版本，少一层进程。
 * 找不到就诚实退回包装层（宁可慢，不可猜）。
 */
export declare function resolveCommand(configured: string, platform?: NodeJS.Platform, arch?: NodeJS.Architecture): ResolvedCommand;
/**
 * 版本是否可用：**只要求不低于下限**，向上不设上限。
 *
 * 为什么不设上限：上限一旦写死，用户 `brew upgrade` 之后插件会把一个能正常工作的 CLI
 * 判成"环境失败"——这正是 `>=0.38 <0.39` 在 0.39.1 上造成的误报。CLI 的 JSON 信封与
 * ref 语义是它的公开契约，升级不该被当成故障；真出现不兼容，`bad-output` / `cli-error`
 * 会在第一次调用时如实报出来，而不是提前猜。
 */
export declare function isSupportedVersion(version: string): boolean;
export declare class AgentBrowser {
    private readonly options;
    private readonly locator;
    /** 命令是自动解析来的，还是配置里显式写死的。 */
    private readonly autoResolved;
    constructor(options: AgentBrowserOptions);
    private get resolved();
    /** 实际 spawn 的二进制。 */
    get command(): string;
    /** 命令是怎么定下来的，给日志与探针看。 */
    get commandDetail(): string;
    /** `native` = 直接跑原生二进制；`wrapper` = 还在付 Node 包装层的启动开销。 */
    get commandKind(): ResolvedCommand['kind'];
    /** 会话参数（`--session` 等）——诊断信息里要能看出"这个 agent 用哪个会话"。 */
    get globalArgs(): readonly string[];
    /** 重新解析一次；命令真的变了才返回 true。 */
    refresh(): boolean;
    /**
     * 跑一条命令。**非零退出码一律抛错**：CLI 的失败是类型化事件，不能吞成空输出。
     * stderr 只作为诊断附注——0.38.2 上错误信息主要走 JSON 信封的 `error`。
     *
     * `brew upgrade` 会让上一次解析出的 Cellar 绝对路径消失（`spawn` 报 ENOENT）：
     * 自动重解析一次再试，而不是让用户看到一条"找不到文件"然后自己去重启 DSH。
     */
    run(args: readonly string[], options?: CliRunOptions): Promise<string>;
    private spawnOnce;
    /**
     * 跑一条命令并解 JSON 信封。`success: false` → `CliError('cli-error')`，
     * 正文带上 CLI 自己的 `error` 文案（"Unknown ref: e2" 这类要原样保留给模型）。
     */
    json<T>(args: readonly string[], options?: CliRunOptions): Promise<T>;
    /** CLI 版本（`agent-browser 0.38.2` → `0.38.2`）。 */
    version(options?: CliRunOptions): Promise<string>;
    /**
     * 版本闸门：**只拦低于下限的**，比下限新的版本一律放行。
     *
     * 设计意图（DESIGN §1.1）：陈旧 ref 的行为是在 0.38.2 上实测的，所以不低于它才承诺行为；
     * 但"更新 = 更危险"没有依据，反过来把可用环境判失败才是真故障（0.39.1 误报即此类）。
     * 真遇到不兼容，第一次调用的 JSON 信封解析会给出 `bad-output` / `cli-error`，比版本号猜更准。
     */
    assertSupported(options?: CliRunOptions): Promise<string>;
    /** 取一次无障碍树快照。 */
    snapshot(options?: {
        interactiveOnly?: boolean;
        depth?: number;
        selector?: string;
        urls?: boolean;
    }, run?: CliRunOptions): Promise<Snapshot>;
    /**
     * **一次进程**拿齐"决策需要的一切"：无障碍树 + 可见正文 + 标题。
     *
     * 为什么要合并：这个 CLI **每次调用都要新起一个进程**（实测 `--version` 就要 64ms，
     * 而真正的浏览器操作只占几毫秒）。分三次调用 = 3×63ms；用 `batch` 合并后 =
     * 1×63ms（实测 176ms → 62ms）。jev-ultrafast 用 CDP 长连接拿到的是同一个效果，
     * 我们在 CLI 这一层用 `batch` 等价实现。
     */
    observe(options?: {
        interactiveOnly?: boolean;
        depth?: number;
        selector?: string;
    }, run?: CliRunOptions): Promise<ObservedPage>;
    /**
     * **一次进程**拿齐：页面内抽取的候选（含动作句柄）+ 可见正文 + 标题 + URL。
     *
     * 与 `observe()` 的区别：那份是整棵无障碍树（大），这份是脚本预抽的紧凑候选（小）。
     * 给判断层用后者：实测 1,021 字符 ≈ 256 tokens（整树约 4.3k tokens）。
     */
    extract(run?: CliRunOptions & {
        includeMedia?: boolean;
    }): Promise<ExtractedPage>;
    /** `batch [--bail] <cmd...>`：一次进程执行多条命令，返回逐条结果（失败即抛）。 */
    batch(commands: readonly string[][], run?: CliRunOptions): Promise<unknown[]>;
    /** 一个变更类动作 → CLI 子命令。**一次一个**，永远不串。 */
    act(action: string, target: string, payload?: {
        value?: string;
        values?: readonly string[];
        direction?: string;
        amount?: number;
    }, run?: CliRunOptions): Promise<void>;
    /** `read [url]`：URL 协商 markdown / llms.txt；不给 URL 读当前页。 */
    read(url: string | undefined, run?: CliRunOptions): Promise<string>;
    /** `get <what> [selector]`。CLI 的 `--json` 在 data 里附了 `lifecycle`，这里只取有用的那部分。 */
    get(what: string, selector: string | undefined, attrName: string | undefined, run?: CliRunOptions): Promise<string>;
    /**
     * **等文档就绪**（`document.readyState === 'complete'`），有界。
     *
     * 网络不可控时，"open 成功"不等于"页面可用"：慢站点在 readyState=loading 时
     * 抽取只能拿到半张页面 —— 基于半张页面判断会同时造成误判和假完成。
     * 这里在页面内轮询就绪状态，就绪即返回，超时也返回（**不阻塞**后续流程）。
     */
    waitForReady(run?: CliRunOptions & {
        timeoutMs?: number;
    }): Promise<boolean>;
    /**
     * **事件驱动地等待"点击后页面真的动了"**（不猜固定时长）。
     *
     * 实测（真机）：gitHub 标签页 1027ms、herokuapp 导航 858ms、Wikipedia 链接 1153ms
     * 才发生跳转 —— 之前固定等 40ms/250ms 会把"正在跳转"误判成"点击没效果"，
     * 于是换候选/判 no_progress（github-pulls 就是这么挂的）。
     *
     * 这里用**一次** CLI `wait --fn`（页面内部轮询），由浏览器自己告诉你"变了"，
     * 三种信号任一满足即返回：URL 变化 / 正文变化 / 指定选择器出现。
     */
    waitForPageShift(previous: {
        url: string;
        textSample: string;
        selector?: string;
    }, run?: CliRunOptions & {
        timeoutMs?: number;
    }): Promise<boolean>;
    /**
     * **HTML5 拖拽**（dragstart/dragover/drop 合成事件 + DataTransfer）。
     *
     * 为什么不用 `act('drag')`：CLI 的 drag 走鼠标事件，HTML5 DnD 页面（真机 the-internet/
     * drag_and_drop）只监听 dragstart/drop，鼠标拖拽不会触发 → 页面纹丝不动。
     */
    jsDrag(sourceRef: string, targetRef: string, run?: CliRunOptions): Promise<void>;
    /**
     * 直接调用元素的 `el.click()`（合成事件）。
     *
     * 只对 `<a>` / `<button>` 用：它们不依赖坐标，折叠线下的元素也能生效
     * （CDP 鼠标点击要求元素在视口内，否则事件落在页面外、静默无效）。
     * 依赖 pointerdown/hover 的自定义组件仍要走 `act('click')`。
     */
    jsClick(ref: string, run?: CliRunOptions): Promise<void>;
    open(url: string, run?: CliRunOptions): Promise<void>;
    /** 轮询 `get url` 直到页面不再是 about:blank（导航提交 / 重定向都算落地）。 */
    private waitUntilNavigated;
    close(run?: CliRunOptions): Promise<void>;
    screenshot(path: string | undefined, fullPage: boolean, run?: CliRunOptions): Promise<string>;
    tabs(run?: CliRunOptions): Promise<string>;
}
/** 动作 → CLI 参数。未知动作在这里就被拒（不是等到 CLI 报错）。 */
export declare function actionArgs(action: string, target: string, payload?: {
    value?: string;
    values?: readonly string[];
    direction?: string;
    amount?: number;
}): string[];
//# sourceMappingURL=cli.d.ts.map