/**
 * 把一次工具调用归类成监控条目种子。
 *
 * 名字口径来自宿主内置工具目录（read/write/edit/web_fetch/web_search/skill/present…，
 * 见 dsh-experimental-liveshare 的 SHARED_TOOL_PROFILES）与 MCP 的 `mcp__server__tool`
 * 命名。纯函数：不碰 I/O，测试用手写载荷覆盖每一条分支。
 */
import type { TaskMonitorKind } from '../constants.js';
export interface ClassifiedSeed {
    readonly kind: TaskMonitorKind;
    readonly id: string;
    readonly label: string;
    readonly detail: string;
    readonly target?: string;
}
export declare function baseName(path: string): string;
export declare function dirName(path: string): string;
export declare function hostOf(url: string): string;
/**
 * 同一文件会被工具写成 `src/a.ts`、`./src/a.ts`、`src\\a.ts` 三种拼法，
 * 按原文当 id 会变成三条。归一（去 `./`、反斜杠转正斜杠）后合并成一条。
 */
export declare function normalizePath(path: string): string;
export declare function artifactSeed(path: string): ClassifiedSeed;
/** 一次调用可能产出多条种子（present 的 files 数组）；归不了类的调用返回空数组。 */
export declare function classifyCall(name: unknown, args: unknown): ClassifiedSeed[];
