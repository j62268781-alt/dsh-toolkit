/**
 * 把一次工具调用归类成监控条目种子。
 *
 * 名字口径来自宿主内置工具目录（read/write/edit/web_fetch/web_search/skill/present…，
 * 见 dsh-experimental-liveshare 的 SHARED_TOOL_PROFILES）与 MCP 的 `mcp__server__tool`
 * 命名。纯函数：不碰 I/O，测试用手写载荷覆盖每一条分支。
 */
import type { MonitorKind } from '../constants.js';
export interface ClassifiedSeed {
    readonly kind: MonitorKind;
    readonly id: string;
    readonly label: string;
    readonly detail: string;
    readonly target?: string;
}
export declare function baseName(path: string): string;
export declare function dirName(path: string): string;
export declare function hostOf(url: string): string;
/** 一次调用可能产出多条种子（present 的 files 数组）；归不了类的调用返回空数组。 */
export declare function classifyCall(name: unknown, args: unknown): ClassifiedSeed[];
//# sourceMappingURL=classify.d.ts.map