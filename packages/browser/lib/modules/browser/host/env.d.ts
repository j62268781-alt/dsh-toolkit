/**
 * 环境探测与"帮忙装"：本机有没有 Chrome、agent-browser 该用什么命令装。
 *
 * 为什么单独一个文件：设置页的自检只报**两项**（CLI / Chrome），这两项都得在
 * 宿主侧问本机——浏览器侧既 spawn 不了进程也读不了文件系统。这里全是可单测的纯逻辑，
 * 只有 `runCommand` 真的起进程。
 */
export interface CommandResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
}
/** 跑一条外部命令（安装器用）。**超时即杀**，不留下一个挂着等密码的 brew。 */
export declare function runCommand(command: string, args: readonly string[], timeoutMs: number, options?: {
    signal?: AbortSignal;
}): Promise<CommandResult>;
/**
 * PATH 上按名字找可执行文件（与 cli.ts 的同名逻辑一致）。
 * 用 `findCommandOnPath` 而不是 `findExecutableOnPath`：Windows 上 npm 只发 `.cmd` shim，
 * 只认 `.exe` 会把装好的 agent-browser 报成「本机没安装」。
 */
export declare function whichOnPath(name: string): string | undefined;
/**
 * 安装 agent-browser 的计划：Homebrew 优先（macOS 上最不容易踩权限坑），
 * 否则 npm 全局装。两者都不在 → undefined，"帮忙装"这个按钮就不出现。
 */
export declare function installPlan(brewPath: string | undefined, npmPath: string | undefined): {
    command: string;
    args: string[];
    label: string;
} | undefined;
/**
 * Chrome 的可执行文件候选。只在**问不了 CLI**（没装 CLI、或 doctor 跑不起来）时用，
 * 属于尽力而为：Chrome 装在非标准位置时会漏报，所以消息里要写"没找到"而不是"没有"。
 */
export declare function chromeCandidates(platform: string, home: string): string[];
/** Chrome 的 PATH 名（Linux 常见是 google-chrome / chromium）。 */
export declare function chromePathNames(platform: string): string[];
/**
 * CLI 的 doctor 里那条 `chrome.installed` 的 message 长这样：
 * `Google Chrome 155.0.8059.84 at /Applications/…/Google Chrome`。
 * 面板不显示路径（用户要求），所以这里把 ` at …` 砍掉，只留名字 + 版本。
 */
export declare function shortChromeLabel(message: string): string;
/** 汇总 doctor 的结果：有没有 Chrome、以及一条能给人看的标签。 */
export declare function chromeFromDoctor(payload: unknown): {
    installed: boolean;
    label: string;
} | undefined;
//# sourceMappingURL=env.d.ts.map