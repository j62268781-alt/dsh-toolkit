/**
 * 入口：把 `agent-browser` CLI 接成一组**窄工具** + 一个**设置页**，并暴露自检 Remote。
 *
 * 形态是 cordis 的 **Service 类**（照 dsh-judgment）：默认导出类，`static Config` / `static inject`，
 * 并挂 `@Remote` 方法——设置页要能问宿主"本机有没有 CLI、有没有 Chrome"，而浏览器侧
 * 自己 spawn 不了进程、也读不了文件系统，所以这条通路必须有。
 *
 * 注册范式照 `@deepseek-ai/dsh-tool-web`：按解析后的配置决定注册哪些工具——「浏览器功能」关掉时
 * **一个工具都不注册**（模型面前零成本），「决策」开启时多一个 `browser_run`。配置一改，loader
 * 重新应用 entry，工具随之增减。
 *
 * CLI 不可用（没装 / 版本低于下限）**不影响注册**：工具照常可见，调用时以结构化错误说明原因；
 * 设置页的自检也会把这件事说清楚（`probe()`）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { Config, type AgentBrowserConfig, type ResolvedConfig } from './config.js';
import { type TaskSubgoal } from './task.js';
/** loader 诊断用的插件名。 */
export declare const name = "agent-browser";
export { Config };
export type { AgentBrowserConfig };
/**
 * 自检就**两项**（用户口径）：本机有没有 agent-browser CLI、有没有 Chrome。
 * 别的都不进面板——路径、包装层、doctor 的 ffmpeg/密钥/provider 那些噪音留在宿主日志里。
 */
export interface ProbeCheck {
    readonly id: 'cli' | 'chrome';
    /** 行标题：`agent-browser` / `Chrome`。 */
    readonly label: string;
    readonly status: 'pass' | 'fail';
    /** 一句话结论，**不含路径**。 */
    readonly message: string;
    /** 失败时的修法（可执行命令或说明）。 */
    readonly fix?: string;
    /** 这一项能不能由插件帮忙装（只有 CLI 可以）。 */
    readonly installable?: boolean;
}
/** 自检载荷的版本。客户端半会热更新、host 半要重启，两侧错配时靠它说话。 */
export declare const PROBE_API_VERSION = 2;
export interface ProbeResult {
    readonly apiVersion: number;
    /** 两项都过 = true。 */
    readonly ok: boolean;
    /** summary 一句话：`浏览器环境就绪` / `浏览器环境不完整`。 */
    readonly title: string;
    readonly checks: readonly ProbeCheck[];
    readonly checkedAt: string;
    /**
     * 「决策」这个开关的依赖在不在：`dsh-judgment` 提供的 `ctx.judgment`。
     * 面板据此**先检查再允许开启**——没有它，`browser_run` 注册了也只会以 judge_error 失败。
     */
    readonly judgment: boolean;
}
export interface JudgmentCheck {
    /** `ctx.judgment`（dsh-judgment 提供的可选服务）在不在。 */
    readonly available: boolean;
    /** 面板可以直接显示的一句话：在 = 就绪；不在 = 怎么补上。 */
    readonly reason: string;
}
export interface InstallResult {
    readonly ok: boolean;
    readonly message: string;
    /** 命令输出的尾部（诊断用，最多几行）。 */
    readonly log?: string;
}
export declare class AgentBrowserService extends TypertRemoteService {
    private readonly config;
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        browser: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        session: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, "volatile-defined">;
        tools: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        limits: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, "volatile-defined">;
        judgment: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
        browser: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            headed: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            allowedDomains: import("@deepseek-ai/schemastery").default<string[], string[], "defined">;
            maxOutput: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            idleTimeout: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            profile: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            executablePath: import("@deepseek-ai/schemastery").default<string, string, "defined">;
            contentBoundaries: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        session: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            name: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, "volatile-defined">;
        tools: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            decision: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            raw: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
            screenshot: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
        }>>>, "volatile-defined">;
        limits: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            commandTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            maxSteps: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            goalThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
            stuckThreshold: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        }>>>, "volatile-defined">;
        judgment: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
            purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
            purpose: import("@deepseek-ai/schemastery").default<string, string, "defined">;
        }>>>, "volatile-defined">;
    }>>, "plain">;
    private browser;
    private session;
    private versionChecked;
    /** skill 与工具的注册返回值：每次重新应用配置前先撤掉旧的。 */
    private readonly registrations;
    private readonly log;
    constructor(ctx: Context, config: AgentBrowserConfig);
    /**
     * 「决策」**真的**可用吗：`ctx.judgment` 在 **且** 本插件用的用途可用。
     *
     * 真机踩到的：dsh-judgment 装好了、`ctx.judgment` 也在，但 profile 里
     * `purposes: {}`（没给 `browser.action` 配连接）——面板显示"已就绪"，一开就 judge_error。
     * `status()` 是**零 I/O** 的本地状态（契约 §13.3），正好用来在开启前问清楚。
     */
    private judgmentAvailability;
    /** 「决策」可用的布尔版（probe 载荷用）。 */
    private judgmentAvailable;
    /** 把 volatile 包装拆成普通值：**每次现取**，拿到的一定是最新的一份。 */
    private resolve;
    /**
     * 应用一次配置：撤销旧注册 → 重建 CLI 客户端 → 重新注册 skill / 工具。
     * 构造函数首次调用与 volatile 热更新走同一条路，避免两份逻辑漂移。
     */
    private apply;
    /** 撤掉上一次应用的所有注册（工具 / skill）。 */
    private disposeRegistrations;
    /** 版本闸门：懒执行 + 只跑一次；只拦低于下限的版本。 */
    private ensureVersion;
    /**
     * 诊断用（也是测试的观察口）：这个 entry 实际会用哪个会话、哪个二进制、哪些全局参数。
     * 不进 Remote——它不该从浏览器侧被调用。
     */
    sessionInfo(): {
        session: string;
        command: string;
        commandDetail: string;
        globalArgs: readonly string[];
    };
    /**
     * 设置页问宿主：**两项**——本机有没有 agent-browser CLI、有没有 Chrome。
     * 路径之类的细节一律不返回（面板不显示）；`install()` 能帮忙装 CLI，但装不了 Chrome。
     */
    probe(): Promise<ProbeResult>;
    /**
     * 「决策」开关的依赖检查。面板在**允许开启之前**现问一次（不依赖挂载时那次的缓存），
     * 因为 `ctx.judgment` 是可选服务：依赖不在时开着这个开关没有意义。
     */
    checkJudgment(): Promise<JudgmentCheck>;
    /**
     * 帮忙装 agent-browser（**由用户点击触发**，不自动跑）。
     *
     * 只装 CLI：Chrome 不走这里——`brew install --cask google-chrome` 在 macOS 上要管理员密码，
     * 一个后台进程挂着等密码是最糟的交互；面板对 Chrome 只给命令与下载入口。
     */
    installCli(target: string): Promise<InstallResult>;
    /** CLI：装了没、版本是否不低于最低支持版本。 */
    private checkCli;
    /**
     * Chrome：**必须项**——没有它 agent-browser 驱动不了页面。
     *
     * CLI 可用时以它自己的 `doctor --quick --json` 为准（它认得环境变量、engine 与自定义路径）；
     * 问不了 CLI 就退回文件系统/ PATH 探测，并在消息里说"没找到"而不是"没有"。
     */
    private checkChrome;
    /**
     * 把随包发布的核心 skill 注册成运行时 skill（`dsh-skill` 的 `ctx.skills.register`）。
     * **可选服务**：`ctx.skills` 不在就跳过——插件其余部分照常工作。
     */
    private registerSkill;
    private registerTools;
}
export default AgentBrowserService;
/** 全局参数（`--session` / `--headed` / 白名单…）。**导出供真网脚本复用**，避免两套逻辑漂移。 */
export declare function globalArgsOf(config: ResolvedConfig, session: string): string[];
/** 字段值表：值可以是字符串/数字/布尔（下拉与勾选常写成 `"true"`），统一转成字符串。 */
export declare function parseInputs(raw: string | undefined): Readonly<Record<string, string>> | undefined;
/** 有序子目标：每项 `{ goal, inputs? }`。顺序就是执行顺序，插件不做重排。 */
export declare function parseSubgoals(raw: string | undefined): readonly TaskSubgoal[] | undefined;
//# sourceMappingURL=index.d.ts.map