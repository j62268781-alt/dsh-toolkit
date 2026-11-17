import type { GitSettings } from './config.js';
import { type GitRunner } from './repository.js';
export interface GitToolsOptions {
    /** 每次调用都重读：改配置后插件会重启，但测试里要能中途换值。 */
    readonly settings: () => GitSettings;
    /** 测试注入的 git 执行器；缺省走 `runProcess`。 */
    readonly run?: GitRunner;
    /** 自动分支名的时钟，测试里固定成某个时刻。 */
    readonly now?: () => Date;
}
/**
 * cwd 只能从 agent 上推：`ToolRunContext` 自己没有目录字段（skills-mcp 的 mount 也这么取）。
 * 取不到就报错而不是退回 `process.cwd()`——那是 DSH 自己的安装目录，在那里跑 git 几乎必然出错。
 */
export declare function directoryOf(exec: any): string;
/** 前缀只加一次：用户自己写全了 `dsh/xxx` 时不重复拼成 `dsh/dsh/xxx`。 */
export declare function prefixedName(prefix: string, seed: string): string;
/** 重名时退到 `-2`、`-3`……：自动命名连着建两次不该报错。 */
export declare function uniqueName(base: string, taken: readonly string[]): string;
/**
 * 生成两个工具定义。`alwaysForcePush` 与 `branchPrefix` 在 execute 里读，
 * 所以同一个定义在设置变化后（插件重启）不需要重新编译 schema。
 */
export declare function createGitTools(options: GitToolsOptions): import("@deepseek-ai/dsh-tools").ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map