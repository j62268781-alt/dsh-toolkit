/**
 * 把一份 patch 文档里所有 mcp-client 行找出来。
 *
 * @param text - patch 文件全文。
 * @returns 合成后的 entry 数组（形状与 `loader.entries()` 足够像，`serverFromRow` 能直接吃）。
 *   解析失败返回 null，由调用方决定怎么处理。
 */
export declare function mcpEntriesFromPatchText(text: any): any;
/**
 * 读 patch 文件并给出其中的 mcp-client 行。
 *
 * @param path - `cordis.patch.yml` 的绝对路径。
 * @returns `{ ok: true, entries, mtimeMs }` 或 `{ ok: false, reason }`。永不抛错。
 */
export declare function readMcpRowsFromPatch(path: any): Promise<{
    ok: boolean;
    reason: string;
    entries?: undefined;
    mtimeMs?: undefined;
} | {
    ok: boolean;
    entries: any;
    mtimeMs: number;
    reason?: undefined;
}>;
//# sourceMappingURL=readRows.d.ts.map