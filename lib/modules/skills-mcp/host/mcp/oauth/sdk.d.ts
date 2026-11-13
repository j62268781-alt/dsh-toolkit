/** OAuth 支持可用/不可用的原因取值。面板直接展示 `reason`。 */
export declare const OAUTH_SDK_REASONS: Readonly<{
    /** 宿主包的 URL 没拿到 —— 无法定位运行时根。 */
    noHostUrl: "no-host-package-url";
    /** 宿主包不在 file: URL 下（例如被单文件打包），无法反推目录。 */
    notFileUrl: "host-package-not-a-file-url";
    /** 从运行时根解析不到 SDK。 */
    sdkMissing: "mcp-sdk-not-resolvable";
    /** SDK 的 package.json 读不出来或没有 ESM 入口。 */
    sdkShape: "mcp-sdk-package-shape-unexpected";
    /** SDK 版本低于已知有 `authProvider` 的下限。 */
    sdkTooOld: "mcp-sdk-too-old";
    /** 导入失败（语法/权限/打包异常）。 */
    importFailed: "mcp-sdk-import-failed";
    /** 导入成功但缺少需要的导出。 */
    missingExport: "mcp-sdk-export-missing";
}>;
/**
 * 已知支持 `authProvider` 的最低 SDK 版本。
 *
 * 2.0.0 就已经有 `authProvider`（不是 2.2.0 才加的）；这里只是把「已知能工作」的
 * 下限写死，避免在一个老版本上打补丁然后静默失效。
 */
export declare const MIN_SDK_MAJOR = 2;
/** 从宿主包的 file: URL 反推运行时 `node_modules` 根。 */
export declare function runtimeNodeModulesFrom(hostUrl: any): {
    ok: boolean;
    reason: "no-host-package-url";
    detail: string;
    nodeModules?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "host-package-not-a-file-url";
    detail: string;
    nodeModules?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    nodeModules: string;
    pkgDir: string;
    reason?: undefined;
    detail?: undefined;
};
/**
 * 解析 SDK 的 ESM 入口 URL，不做 import。
 *
 * @param hostUrl - 宿主包（`dsh-mcp-client`）的 `file:` URL。
 * @returns `{ ok: true, url, version }` 或 `{ ok: false, reason, detail }`。
 */
export declare function resolveSdkEsmEntry(hostUrl: any): {
    ok: boolean;
    reason: "no-host-package-url";
    detail: string;
    nodeModules?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "host-package-not-a-file-url";
    detail: string;
    nodeModules?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    nodeModules: string;
    pkgDir: string;
    reason?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-not-resolvable";
    detail: string;
    url?: undefined;
    version?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-package-shape-unexpected";
    detail: string;
    url?: undefined;
    version?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-too-old";
    detail: string;
    url?: undefined;
    version?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    url: string;
    version: string;
    pkgDir: string;
    reason?: undefined;
    detail?: undefined;
};
/**
 * 加载 SDK。
 *
 * @param hostUrl - 宿主包的 `file:` URL。
 * @param options.importModule - 注入的 `import()`，测试用。
 * @returns `{ ok: true, sdk, version }` 或 `{ ok: false, reason, detail }`。
 *   永不抛错：OAuth 是可选能力，装不上时面板要说「没装 + 原因」，而不是让插件加载失败。
 */
export declare function loadSdk(hostUrl: any, options?: any): Promise<{
    ok: boolean;
    reason: "no-host-package-url";
    detail: string;
    nodeModules?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "host-package-not-a-file-url";
    detail: string;
    nodeModules?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    nodeModules: string;
    pkgDir: string;
    reason?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-not-resolvable";
    detail: string;
    url?: undefined;
    version?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-package-shape-unexpected";
    detail: string;
    url?: undefined;
    version?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-too-old";
    detail: string;
    url?: undefined;
    version?: undefined;
    pkgDir?: undefined;
} | {
    ok: boolean;
    url: string;
    version: string;
    pkgDir: string;
    reason?: undefined;
    detail?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-import-failed";
    detail: string;
    sdk?: undefined;
    version?: undefined;
} | {
    ok: boolean;
    reason: "mcp-sdk-export-missing";
    detail: string;
    sdk?: undefined;
    version?: undefined;
} | {
    ok: boolean;
    sdk: any;
    version: any;
    reason?: undefined;
    detail?: undefined;
}>;
/** 面向面板的一句话。缺 SDK 时用户看到的应该是「怎么修」，不是一段堆栈。 */
export declare function oauthSdkReasonText(result: any): string;
//# sourceMappingURL=sdk.d.ts.map