/**
 * 面向模型的工具集。
 *
 * ── 设计原则：先给便宜的观察者，再给贵的 ────────────────────────────────
 * mobilecli 提供了从廉价到昂贵的多种"看屏幕"方式，价格差很大：
 *
 *   dump ui（UI 树）    ~100–300ms   结构化：resource-id / text / bounds
 *   screenshot          ~200–400ms   一张图，给人看或给多模态模型看
 *   find_text（OCR）    ~1s          只在树里没有文字时才值得用
 *
 * 所以工具描述里明确写出"先用哪个、什么时候才升级到下一个"，而不是把
 * 五个观察工具并列丢给模型让它自己猜。这是 dsh-android 的 skill 里最
 * 有价值的部分，这里直接沿用它的取舍。
 *
 * ── 为什么失败要 throw 而不是返回空 ────────────────────────────────────
 * "没有设备"和"设备列表拿不到"必须可区分。前者是事实，后者是故障。
 * 把故障伪装成空列表会让模型得出"这台机器没有设备"的错误结论，
 * 然后在错误的路上继续走。凡是枚举失败一律抛，让模型看到真实原因。
 *
 * @module dsh-sidebar-mobile/lib/tools
 */
export { resolveDevice } from "./device-resolution.js";
/**
 * 统一的 JSON 呈现。
 *
 * 不用宿主内部的 renderJson：那是个未导出的实现细节，跟着 DSH 版本漂移。
 * 这里给一个最小实现——把结果序列化进一个 text 块，模型读到的就是结构化 JSON。
 *
 * ⚠️ **签名必须是 `(args, value)` 两个参数，第一个要忽略。**
 *
 * 这不是风格问题，是本插件一个长期 bug 的根因。DSH 的 `ToolOutputDefinition`
 * 在类型和调用点两处都写死了两个参数：
 *
 *     render(args: unknown, value: JsonValue): ContentBlock[]
 *     rawRender(args, value)     // harness 里的实际调用
 *
 * 而这里原先写的是 `renderJson(value)` —— 于是 harness 传进来的 **`args`
 * 被当成了结果**。后果按工具有没有参数分成两种：
 *
 *   · 无参数的（mobile_devices / mobile_open_panel）：args 是 `{}`，
 *     所有调用一律显示 `{}`。
 *   · 有参数的：显示的是**你刚刚传进去的入参**，看起来像个正常结果，
 *     其实完全不是 —— 比显示空更糟，因为它不可疑。
 *
 * 这也正是"所有 mobile_* 工具返回空结果"那个长期未解之谜的答案。
 * 测试「render 必须按 (args, value) 两参签名」钉住它。
 *
 * @param {unknown} _args 工具入参，**必须忽略**
 * @param {any} value 工具的返回值，这才是要呈现的东西
 * @returns {Array<{type: "text", text: string}>}
 */
export declare function renderJson(_args: unknown, value: any): {
    type: "text";
    text: string;
}[];
/** 点击注入点：`performTap` 缺省时退回 CLI。 */
type TapAt = (options: {
    deviceId: string;
    x: number;
    y: number;
    signal?: AbortSignal;
}) => Promise<any>;
/** 工具名常量，供插件入口与文档引用，避免拼错。 */
/**
 * 注册的工具名。键名 → 模型看到的工具名。
 *
 * ⚠️ 这份表是**公开 API**（index.js 会 re-export，外部脚本可能按名引用），
 * 所以删工具时不要静默移走键 —— 见下面 REMOVED_TOOL_NAMES 的说明。
 */
export declare const TOOL_NAMES: {
    devices: string;
    boot: string;
    screenshot: string;
    uiTree: string;
    tapElement: string;
    listApps: string;
    findText: string;
    tapText: string;
    waitFor: string;
    logs: string;
    openPanel: string;
};
/**
 * 已移除的工具名。
 *
 * 保留这张表的原因：调用方拿到 `mobile_tap is not a tool` 时，能立刻分辨
 * "这个插件删了它" 和 "名字打错了"。两种移除原因不同，分别记在下面。
 */
export declare const REMOVED_TOOL_NAMES: {
    /**
     * 薄包装（5 个）：实现只是 `runJson(...)` 加一句 `return`，没有任何加工，
     * 而 agent 本来就有 shell —— 直接跑等价的 `mobilecli` 命令即可。
     * 留着要付 **349 tokens/轮** 的 schema 成本。命令与注意事项见
     * `skills/mobilecli/SKILL.md` 的「Driving the device from the shell」。
     */
    tap: string;
    swipe: string;
    text: string;
    button: string;
    launchApp: string;
    /**
     * `mobile_flutter_tree`：**与 `mobile_ui_tree` 完全重复**，且描述不实。
     *
     * 两者的 execute 调的是同一个函数（`dumpUiElements` → `mobilecli dump ui`），
     * 唯一差别是它多一层"结果为空时给友好报错"。而描述却写着"绕过无障碍投影，
     * **直连 Dart VM Service**" —— 它从未连过任何 VM Service。
     *
     * 实测对一台真实的 debug Flutter 应用（`com.dycjr.jg.inner`）：
     * `dump ui` 得到 69 个节点、**全部是 `android.*`**（其中 32 个还是 systemui
     * 状态栏）；应用窗口下全是匿名 `View`/`ImageView`，只有 rect，没有 text、
     * 没有 identifier。也就是说它给不出描述承诺的任何东西。
     *
     * 一个**描述骗人的工具比没有这个工具更糟**：agent 会以为读到了 Flutter 树
     * 并据此下结论。所以删掉。
     *
     * 真要读 Flutter widget 树，正确路径是 Dart VM Service（协议细节见
     * `docs/FLUTTER-TREE-RESEARCH.md`），或在 tcl_jiguang 工作区直接用
     * `dart-mcp-server` 的 `get_widget_tree`（URI 由 `launch_app` 自己持有）。
     * 不该由本插件再实现一份。
     */
    flutterTree: string;
};
/**
 * 构造全部工具。
 *
 * @param {object} options
 * @param {import("./mobilecli.js").Mobilecli} options.client
 * @param {(deviceId: string) => object} options.acquireSession 取设备的流会话（用于报告 streaming 状态）
 * @returns {Record<string, any>} 工具名 → 定义
 */
export declare function createTools({ client, acquireSession, openPanel, performTap }: {
    client: any;
    acquireSession: (deviceId: string) => any;
    openPanel?: (() => Promise<any>) | null;
    performTap?: TapAt | null;
}): Record<string, any>;
export declare function createMobileLoopTool({ client, getJudge, purpose, performTap, }: {
    client: any;
    getJudge: () => any;
    purpose?: string;
    performTap?: TapAt | null;
}): Record<string, any>;
//# sourceMappingURL=tools.d.ts.map