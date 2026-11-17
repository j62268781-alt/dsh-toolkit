/**
 * **页面内抽取**（P8）：用一次 `eval` 在页面里把"能操作的候选"抽成紧凑结构，
 * 而不是把整棵无障碍树（+ 几百个 refs）发给判断层。
 *
 * 实测（hao123，354 个 refs 的门户页）：
 *   - CLI `snapshot -i --json`：13,985 字符文本 + 354 refs（状态约 4.3k tokens）
 *   - 本抽取：80 个可见元素 → 1,021 字符 ≈ **1.1–1.9k tokens**，耗时 7.8ms
 *
 * 为什么不能用 `@eN`：refs 只存在 Rust daemon 里，页面里没有任何映射
 * （实测 `window` 无句柄、DOM 无 `data-*ref` 属性）。所以脚本给元素打**自己的**属性
 * `data-dsh-idx="i"`，动作时用 `[data-dsh-idx="7"]`——已实测可点击并跳转。
 *
 * 抽取时就把"不可信"的候选过滤掉（判断层看到的东西才可信）：
 *   不可见（display/visibility/opacity）、离屏、被遮挡（`elementFromPoint`）、无名（输入框除外）。
 */
/** 候选属性名（命名空间化，避免与站点冲突；每次抽取前清理）。 */
export declare const HANDLE_ATTRIBUTE = "data-dsh-idx";
export declare const EXTRACT_SCRIPT: string;
/** `parseExtracted` 的返回（与 `cli.ts` 的 `ExtractedPage` 同形）。 */
export interface ExtractedPage {
    readonly items: readonly ExtractedItem[];
    readonly text: string;
    readonly title: string;
    readonly url: string;
    /** 元素数达到抽取上限（300）：页面比这更大，目标可能没被抽到。 */
    readonly truncated?: boolean;
}
/** 抽取到的单个候选。 */
export interface ExtractedItem {
    readonly index: number;
    readonly role: string;
    readonly name: string;
    /** 被其它元素挡住（点击会落到遮挡物上）；默认不进候选池。 */
    readonly covered: boolean;
    /** 当前状态摘要：已勾选/未勾选、当前值、已有内容、链接目标（给判断层的"现状"）。 */
    readonly state?: string;
    /** 原生 select 的选项（label, value），最多 30 个。 */
    readonly options?: readonly (readonly [string, string])[];
    /** 元素所在行/容器的文本（区分"导航条同名链接"和"当前条目里的链接"）。 */
    readonly near?: string;
    /** 原始标签名（小写）：`a`/`button` 可以直接调用 `el.click()`，其余走真实鼠标事件。 */
    readonly tag?: string;
    /** 语义区域：`true` = 主内容区（main/form/table/article/dialog），`false` = 页头/导航/页脚（nav/header/footer）。 */
    readonly inMain?: boolean;
    /** 物理输入类型（如 `password` / `search` / `email` / `submit` / `text`），与语言无关。 */
    readonly inputType?: string;
    /** HTML 标准自动填充语义（如 `username` / `current-password` / `one-time-code`）。 */
    readonly autocomplete?: string;
    /** DOM 最小容器分组 ID（如 `g1`），同一局部容器内的控件共享。 */
    readonly groupId?: string;
    /** 容器分组的简短标签（来自 legend / aria-label / 组内标题）。 */
    readonly groupLabel?: string;
    /** 所属表单 ID；没有 DOM id 时为本次抽取内生成的编号。 */
    readonly formId?: string;
    /** 最近小型容器的 aria-label / 标题，用于消歧上下文控件。 */
    readonly contextLabel?: string;
    /** 是否位于同源 iframe 或 open shadowRoot 内部。 */
    readonly deep?: boolean;
}
/**
 * 去掉 `--content-boundaries` 的包裹（`--- AGENT_BROWSER_PAGE_CONTENT nonce=… ---` / `--- END_… ---`）。
 *
 * `eval` 的输出也会被这个全局参数包住——不剥掉就 JSON.parse 失败（真机踩到）。
 */
export declare function stripBoundaries(text: string): string;
/** 解析抽取脚本的返回值（`eval` 返回字符串 → 再解一层；兼容直接返回数组的旧形状）。 */
export declare function parseExtracted(raw: string): ExtractedPage;
/** 动作句柄（CSS 选择器）。 */
export declare function handleOf(index: number): string;
//# sourceMappingURL=extract.d.ts.map