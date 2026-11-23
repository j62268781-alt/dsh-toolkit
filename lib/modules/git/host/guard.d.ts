/**
 * shell 里的兜底：设置要求 `--force-with-lease`，但模型完全可能自己敲一条裸 `--force`。
 *
 * 工具（`tools.ts`）解决的是「正常路径」，这个钩子解决的是「漏网」：DSH 的
 * `tools/pre-execute` 能拿到 `tool_input.command` 并且只能 **deny**，改不了命令，
 * 所以被拦下时把正确写法写进 reason，模型通常会立刻重试一次正确的命令。
 *
 * 只拦「开了 alwaysForcePush」的情况：关闭时用户要的就是不额外加参数，此时连提示都不该有。
 */
import type { GitSettings } from './config.js';
/** 工具参数里取命令文本：`command` / `cmd` / `argv` 都见过。 */
export declare function commandText(args: any): string;
/**
 * 找出一条「`git push` 带 `--force` / `-f` / `+refspec`，但没有 `--force-with-lease`」的片段。
 * 找不到返回空串。按 shell 的分隔符切段，`cd repo && git push -f` 也能看出来。
 */
export declare function bareForcePush(command: string): string;
/** 装上 `tools/pre-execute` 监听；`settings` 每次询问，改配置后不需要重装。 */
export declare function installGitGuard(ctx: any, settings: () => GitSettings): void;
