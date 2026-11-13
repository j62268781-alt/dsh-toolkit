export declare const PETDEX_ASSETS = "https://assets.petdex.dev";
export declare function previewPath(root: string, slug: string): string;
export interface PreviewOptions {
    root: string;
    fetchImpl?: typeof globalThis.fetch;
    baseUrl?: string;
    timeoutMs?: number;
    maxBytes?: number;
}
/** 一个 slug 一张图：内存命中 → 磁盘命中 → 下载。失败一律返回 null，不抛。
 *
 *  `root` 是唯一必填项，但保留 `= {}` 默认值：历史上允许无参调用，
 *  那种情况下每次 `get()` 都会在 `previewPath()` 里抛错并被就地吞成 null。
 */
export declare function createPreviewStore({ root, fetchImpl, baseUrl, timeoutMs, maxBytes }?: PreviewOptions): {
    get(slug: string): Promise<Buffer | null>;
};
//# sourceMappingURL=preview.d.ts.map