/**
 * 配置（schemastery）。**六个顶层字段全部 `.volatile()`**——这不是风格选择，是**硬约束**：
 *
 * DSH 的设置服务（`dsh-settings`）只允许写 volatile 字段：
 *   `if (!isVolatilePath(schema, path)) throw new Error('Config field "…" is not volatile')`
 * 而且 `describe()` 用 `volatileForm(schema)` 过滤；一个 volatile 字段都没有的 entry
 * **根本不会出现在设置命名空间里**。于是设置页会拿到一份不可写/不存在的表单，
 * 界面上显示的只是插件自己的默认值，任何写入都被拒绝——真机上表现为"页面能打开，
 * 点什么都没反应"（这版之前就踩了这个坑）。
 *
 * 代价：volatile 改动**不会重建 entry**，所以工具注册必须自己重做——
 * 宿主在 volatile 值变化后会发 `loader/volatile-update`，服务里监听它重新
 * 解析配置 → 重建 CLI 客户端 → 重注册工具（见 `src/index.ts` 的 `apply()`）。
 */
import s from '@deepseek-ai/schemastery';
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    /**
     * 浏览器功能总开关。关闭时**不注册任何工具**——模型面前零成本，也不启动任何会话。
     */
    enabled: s<boolean, boolean, "volatile-defined">;
    browser: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /** `--headed`：给人看 / 手工登录时打开。 */
        headed: s<boolean, boolean, "defined">;
        /**
         * `--allowed-domains`：网络域名白名单。它同时会关掉 CDP / auto-connect / profile /
         * 状态回放等旁路（CLI 自己的 fail-closed 行为），所以这是我们最看重的确定性门控。
         * 空数组 = 不限制。
         */
        allowedDomains: s<string[], string[], "defined">;
        /** `--max-output`：页面输出截断（0 = 用 CLI 默认）。 */
        maxOutput: s<number, number, "defined">;
        /** `--idle-timeout`：守护进程空闲多久退出（空 = CLI 默认 1h）。 */
        idleTimeout: s<string, string, "defined">;
        /** `--profile`：复用登录态的 Chrome profile 名或目录；空 = 一次性 profile。 */
        profile: s<string, string, "defined">;
        /** `--executable-path`：自定义浏览器可执行文件；空 = CLI 默认。 */
        executablePath: s<string, string, "defined">;
        /**
         * `--content-boundaries`：把页面输出包在边界标记里。
         * 默认开：网页内容是不可信数据，边界是给模型的"这不是指令"的物理提示。
         */
        contentBoundaries: s<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /** `--headed`：给人看 / 手工登录时打开。 */
        headed: s<boolean, boolean, "defined">;
        /**
         * `--allowed-domains`：网络域名白名单。它同时会关掉 CDP / auto-connect / profile /
         * 状态回放等旁路（CLI 自己的 fail-closed 行为），所以这是我们最看重的确定性门控。
         * 空数组 = 不限制。
         */
        allowedDomains: s<string[], string[], "defined">;
        /** `--max-output`：页面输出截断（0 = 用 CLI 默认）。 */
        maxOutput: s<number, number, "defined">;
        /** `--idle-timeout`：守护进程空闲多久退出（空 = CLI 默认 1h）。 */
        idleTimeout: s<string, string, "defined">;
        /** `--profile`：复用登录态的 Chrome profile 名或目录；空 = 一次性 profile。 */
        profile: s<string, string, "defined">;
        /** `--executable-path`：自定义浏览器可执行文件；空 = CLI 默认。 */
        executablePath: s<string, string, "defined">;
        /**
         * `--content-boundaries`：把页面输出包在边界标记里。
         * 默认开：网页内容是不可信数据，边界是给模型的"这不是指令"的物理提示。
         */
        contentBoundaries: s<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    session: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /**
         * `--session` 名。留空 = 插件按 profile 派生一个固定名（`dsh-agent-browser`）。
         * 为什么不留空给 CLI 默认：CLI 的默认会话**全机共享、跨对话持久**，
         * 会劫持别的 agent 的页面，或把人类开着的标签导航走。
         */
        name: s<string, string, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /**
         * `--session` 名。留空 = 插件按 profile 派生一个固定名（`dsh-agent-browser`）。
         * 为什么不留空给 CLI 默认：CLI 的默认会话**全机共享、跨对话持久**，
         * 会劫持别的 agent 的页面，或把人类开着的标签导航走。
         */
        name: s<string, string, "defined">;
    }>>>, "volatile-defined">;
    tools: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /** 「决策」：开启后额外注册 `browser_run`——插件内部的有界循环。 */
        decision: s<boolean, boolean, "defined">;
        /** `browser_raw` 逃生舱：白名单内的其它 CLI 子命令。默认关。 */
        raw: s<boolean, boolean, "defined">;
        /** `browser_screenshot`。 */
        screenshot: s<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /** 「决策」：开启后额外注册 `browser_run`——插件内部的有界循环。 */
        decision: s<boolean, boolean, "defined">;
        /** `browser_raw` 逃生舱：白名单内的其它 CLI 子命令。默认关。 */
        raw: s<boolean, boolean, "defined">;
        /** `browser_screenshot`。 */
        screenshot: s<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    limits: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /** 单条 CLI 命令的超时（`spawn` 层）。 */
        commandTimeoutMs: s<number, number, "defined">;
        /** `browser_run` 的最大步数（每次动作算一步）。 */
        maxSteps: s<number, number, "defined">;
        /** `goal_done` 概率达到它就停（判定在**动作之前**）。 */
        goalThreshold: s<number, number, "defined">;
        /** `stuck` 概率达到它就停（同上，先于动作）。 */
        stuckThreshold: s<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /** 单条 CLI 命令的超时（`spawn` 层）。 */
        commandTimeoutMs: s<number, number, "defined">;
        /** `browser_run` 的最大步数（每次动作算一步）。 */
        maxSteps: s<number, number, "defined">;
        /** `goal_done` 概率达到它就停（判定在**动作之前**）。 */
        goalThreshold: s<number, number, "defined">;
        /** `stuck` 概率达到它就停（同上，先于动作）。 */
        stuckThreshold: s<number, number, "defined">;
    }>>>, "volatile-defined">;
    judgment: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /**
         * 交给 `ctx.judgment` 的**用途名**。用途是给消费者的稳定名字：换连接/模型/密钥
         * 只改「设置 → 决策」，不动这里。默认 `browser.action`——dsh-judgment 的配置示例里
         * 已经预留了这个名字。
         */
        purpose: s<string, string, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /**
         * 交给 `ctx.judgment` 的**用途名**。用途是给消费者的稳定名字：换连接/模型/密钥
         * 只改「设置 → 决策」，不动这里。默认 `browser.action`——dsh-judgment 的配置示例里
         * 已经预留了这个名字。
         */
        purpose: s<string, string, "defined">;
    }>>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /**
     * 浏览器功能总开关。关闭时**不注册任何工具**——模型面前零成本，也不启动任何会话。
     */
    enabled: s<boolean, boolean, "volatile-defined">;
    browser: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /** `--headed`：给人看 / 手工登录时打开。 */
        headed: s<boolean, boolean, "defined">;
        /**
         * `--allowed-domains`：网络域名白名单。它同时会关掉 CDP / auto-connect / profile /
         * 状态回放等旁路（CLI 自己的 fail-closed 行为），所以这是我们最看重的确定性门控。
         * 空数组 = 不限制。
         */
        allowedDomains: s<string[], string[], "defined">;
        /** `--max-output`：页面输出截断（0 = 用 CLI 默认）。 */
        maxOutput: s<number, number, "defined">;
        /** `--idle-timeout`：守护进程空闲多久退出（空 = CLI 默认 1h）。 */
        idleTimeout: s<string, string, "defined">;
        /** `--profile`：复用登录态的 Chrome profile 名或目录；空 = 一次性 profile。 */
        profile: s<string, string, "defined">;
        /** `--executable-path`：自定义浏览器可执行文件；空 = CLI 默认。 */
        executablePath: s<string, string, "defined">;
        /**
         * `--content-boundaries`：把页面输出包在边界标记里。
         * 默认开：网页内容是不可信数据，边界是给模型的"这不是指令"的物理提示。
         */
        contentBoundaries: s<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /** `--headed`：给人看 / 手工登录时打开。 */
        headed: s<boolean, boolean, "defined">;
        /**
         * `--allowed-domains`：网络域名白名单。它同时会关掉 CDP / auto-connect / profile /
         * 状态回放等旁路（CLI 自己的 fail-closed 行为），所以这是我们最看重的确定性门控。
         * 空数组 = 不限制。
         */
        allowedDomains: s<string[], string[], "defined">;
        /** `--max-output`：页面输出截断（0 = 用 CLI 默认）。 */
        maxOutput: s<number, number, "defined">;
        /** `--idle-timeout`：守护进程空闲多久退出（空 = CLI 默认 1h）。 */
        idleTimeout: s<string, string, "defined">;
        /** `--profile`：复用登录态的 Chrome profile 名或目录；空 = 一次性 profile。 */
        profile: s<string, string, "defined">;
        /** `--executable-path`：自定义浏览器可执行文件；空 = CLI 默认。 */
        executablePath: s<string, string, "defined">;
        /**
         * `--content-boundaries`：把页面输出包在边界标记里。
         * 默认开：网页内容是不可信数据，边界是给模型的"这不是指令"的物理提示。
         */
        contentBoundaries: s<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    session: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /**
         * `--session` 名。留空 = 插件按 profile 派生一个固定名（`dsh-agent-browser`）。
         * 为什么不留空给 CLI 默认：CLI 的默认会话**全机共享、跨对话持久**，
         * 会劫持别的 agent 的页面，或把人类开着的标签导航走。
         */
        name: s<string, string, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /**
         * `--session` 名。留空 = 插件按 profile 派生一个固定名（`dsh-agent-browser`）。
         * 为什么不留空给 CLI 默认：CLI 的默认会话**全机共享、跨对话持久**，
         * 会劫持别的 agent 的页面，或把人类开着的标签导航走。
         */
        name: s<string, string, "defined">;
    }>>>, "volatile-defined">;
    tools: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /** 「决策」：开启后额外注册 `browser_run`——插件内部的有界循环。 */
        decision: s<boolean, boolean, "defined">;
        /** `browser_raw` 逃生舱：白名单内的其它 CLI 子命令。默认关。 */
        raw: s<boolean, boolean, "defined">;
        /** `browser_screenshot`。 */
        screenshot: s<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /** 「决策」：开启后额外注册 `browser_run`——插件内部的有界循环。 */
        decision: s<boolean, boolean, "defined">;
        /** `browser_raw` 逃生舱：白名单内的其它 CLI 子命令。默认关。 */
        raw: s<boolean, boolean, "defined">;
        /** `browser_screenshot`。 */
        screenshot: s<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    limits: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /** 单条 CLI 命令的超时（`spawn` 层）。 */
        commandTimeoutMs: s<number, number, "defined">;
        /** `browser_run` 的最大步数（每次动作算一步）。 */
        maxSteps: s<number, number, "defined">;
        /** `goal_done` 概率达到它就停（判定在**动作之前**）。 */
        goalThreshold: s<number, number, "defined">;
        /** `stuck` 概率达到它就停（同上，先于动作）。 */
        stuckThreshold: s<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /** 单条 CLI 命令的超时（`spawn` 层）。 */
        commandTimeoutMs: s<number, number, "defined">;
        /** `browser_run` 的最大步数（每次动作算一步）。 */
        maxSteps: s<number, number, "defined">;
        /** `goal_done` 概率达到它就停（判定在**动作之前**）。 */
        goalThreshold: s<number, number, "defined">;
        /** `stuck` 概率达到它就停（同上，先于动作）。 */
        stuckThreshold: s<number, number, "defined">;
    }>>>, "volatile-defined">;
    judgment: s<NoInfer<Schemastery.ObjectS<NoInfer<{
        /**
         * 交给 `ctx.judgment` 的**用途名**。用途是给消费者的稳定名字：换连接/模型/密钥
         * 只改「设置 → 决策」，不动这里。默认 `browser.action`——dsh-judgment 的配置示例里
         * 已经预留了这个名字。
         */
        purpose: s<string, string, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        /**
         * 交给 `ctx.judgment` 的**用途名**。用途是给消费者的稳定名字：换连接/模型/密钥
         * 只改「设置 → 决策」，不动这里。默认 `browser.action`——dsh-judgment 的配置示例里
         * 已经预留了这个名字。
         */
        purpose: s<string, string, "defined">;
    }>>>, "volatile-defined">;
}>>, "plain">;
/** 校验后的配置值类型（schemastery 的输出类型）：volatile 字段是 `Volatile<T>` 包装。 */
export type AgentBrowserConfig = typeof Config extends s<any, infer T> ? T : never;
/**
 * 拆掉 `Volatile` 包装后的普通值——服务里每次现取，拿到的就是最新配置。
 *
 * 为什么手写而不用 `Unwrap<Volatile<T>>` 映射类型：schemastery 推断出的
 * `ObjectT<…>` 里数组是只读的、还带索引签名，映射出来和 `Volatile.get()` 的返回型
 * 对不齐（tsc 会报 readonly 不兼容）。手写一份等价的普通结构更好读、也更稳。
 */
export interface ResolvedConfig {
    enabled: boolean;
    browser: {
        headed: boolean;
        allowedDomains: readonly string[];
        maxOutput: number;
        idleTimeout: string;
        profile: string;
        executablePath: string;
        contentBoundaries: boolean;
    };
    session: {
        name: string;
    };
    tools: {
        decision: boolean;
        raw: boolean;
        screenshot: boolean;
    };
    limits: {
        commandTimeoutMs: number;
        maxSteps: number;
        goalThreshold: number;
        stuckThreshold: number;
    };
    judgment: {
        purpose: string;
    };
}
//# sourceMappingURL=config.d.ts.map