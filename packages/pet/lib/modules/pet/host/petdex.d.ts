export declare const PETDEX_BASE = "https://petdex.dev";
/** pet.json 里渲染需要、且能被安全落盘的字段。 */
export interface PetManifest {
    id: string;
    displayName: string;
    description?: string | undefined;
    spritesheetPath: string;
    spriteVersionNumber: number;
}
export type ValidateResult = {
    ok: true;
    manifest: PetManifest;
} | {
    ok: false;
    reason: string;
};
/** 目录里的一只宠物（还没安装）。 */
export interface CatalogPet {
    slug: string;
    displayName: string;
    spritesheet: string;
    petJson: string;
    spriteVersionNumber: number;
}
export interface Catalog {
    assetBase: string;
    total: number;
    pets: CatalogPet[];
}
export interface InstalledPet {
    slug: string;
    dir: string;
    manifest: PetManifest;
    sheetFile: string;
}
export interface SkippedPet {
    slug: string;
    reason: string;
}
export interface InstallProgress {
    slug?: string | undefined;
    phase: string;
    percent: number;
}
export interface InstallOptions {
    slug?: string;
    petUrl?: string;
    sheetUrl?: string;
    root?: string;
    fetchImpl?: typeof globalThis.fetch;
    timeoutMs?: number;
    maxSheetBytes?: number;
    onProgress?: (progress: InstallProgress) => void;
}
export type InstallResult = {
    ok: true;
    slug: string;
    dir: string;
    manifest: PetManifest;
    sheetFile: string;
} | {
    ok: false;
    reason: string;
};
export declare function isSlug(value: any): boolean;
/** 只读头部就能拿到尺寸：PNG 的 IHDR、WebP 的 VP8/VP8L/VP8X，不需要图像库。 */
export declare function parseImageSize(bytes: any): {
    format: string;
    width: number;
    height: number;
} | null;
/** 校验非 https、越界这些「下载器不该被喂进来的东西」。 */
export declare function resolveAssetUrl(base: any, relative: any): string | null;
/** pet.json 只保留渲染需要、且能被安全落盘的字段。 */
export declare function validatePetJson(value: any, slug: any): ValidateResult;
/** 同时接受 v2（fields + 数组行）与旧版 /api/manifest（对象行）；坏数据只丢那一条。 */
export declare function parseManifest(value: any): Catalog;
export interface CatalogOptions {
    fetchImpl?: typeof globalThis.fetch;
    baseUrl?: string;
    timeoutMs?: number;
    cacheMs?: number;
    now?: () => number;
}
export interface CatalogListOptions {
    force?: boolean;
}
/**
 * 目录缓存：设置页搜索/滚动时不该每次都打网络。`list({ force: true })` 给「刷新」按钮用。
 */
export declare function createCatalog({ fetchImpl, baseUrl, timeoutMs, cacheMs, now }?: CatalogOptions): {
    list(options?: CatalogListOptions): Promise<Catalog>;
};
/** 宠物库的「全部 / 已安装 / 未安装」筛选：纯函数，服务端按它切 matched 与分页。 */
export declare function filterCatalog(pets: CatalogPet[], installed: any, filter?: any): CatalogPet[];
/** 安装一只宠物：先下到临时目录、校验通过后再原子替换目标目录。 */
export declare function installPet({ slug, petUrl, sheetUrl, root, fetchImpl, timeoutMs, maxSheetBytes, onProgress }?: InstallOptions): Promise<InstallResult>;
/** 列出已安装的宠物；读不动的目录进 skipped，交给设置页提示。 */
export declare function listInstalled(root: string): Promise<{
    pets: InstalledPet[];
    skipped: SkippedPet[];
}>;
export declare function removePet(root: string, slug: any): Promise<boolean>;
//# sourceMappingURL=petdex.d.ts.map