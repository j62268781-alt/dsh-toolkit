export declare const ELECTRON_VERSION = "43.3.0";
/**
 * 准备运行时的进度，百分比是**整条流水线**的进度（下载 → 解压 → 精简）。
 *
 * 客户端把它画成一条进度条：一次 138MB 的下载如果只有状态文字，用户看到的就是
 * 「一直在安装」。
 */
export interface RuntimeProgress {
    phase: 'download' | 'unpack' | 'tidy' | 'done';
    percent: number;
    /** 已下载字节数，只有 `phase === 'download'` 时有意义。 */
    received?: number;
    /** 服务器给出的总字节数；没有 Content-Length 时为 0。 */
    total?: number;
}
export type RuntimeProgressListener = (progress: RuntimeProgress) => void;
export declare function executableIn(directory: string, platform?: NodeJS.Platform): string;
export declare function runtimeDirectory(): string;
export interface ResolveElectronOptions {
    electronPath?: string;
    download?: boolean;
    /** 下载/解压进度；宿主转成 `runtime.progress` 推给设置页。 */
    onProgress?: RuntimeProgressListener;
}
/**
 * 给 `@electron/get` 用的自定义下载器：默认的 got 下载器不暴露字节进度，
 * 换成 fetch 流自己写文件，顺便按 Content-Length 报百分比。
 *
 * 其余职责（mirror、校验和、临时目录）仍然留给 `@electron/get`。
 *
 * @param idleMs 多久没有新字节就判定链路断了。不按总时长掐：实测国内直连 GitHub
 *   只有 ~20KB/s，138MB 要一个小时，按总时长会稳定地把能下载的包判死。
 */
export declare function progressDownloader(report: RuntimeProgressListener, idleMs?: number): {
    download(url: string, targetFilePath: string, _options?: any): Promise<void>;
};
/**
 * 去掉运行时里用不到的界面语言包。
 *
 * Electron 只发布整包（43.3.0 的 win32-x64 压缩包 137.7MB），没有官方精简版；
 * 真正能省的是 `locales/` 下除 en-US 之外的 .pak —— 它们只装 Chromium 的原生界面文案，
 * 而 helper 没有菜单、没有对话框。缺对应语言的 pak 时 Chromium 回落到 en-US。
 *
 * macOS 的本地化在 `Electron.app` 的 .lproj 里、跟着 Info.plist 走，整套跳过。
 */
export declare function trimRuntime(directory: string, platform?: NodeJS.Platform): Promise<number>;
/**
 * 删掉 `prepare()` 遗留的暂存目录，返回删除的个数。
 *
 * 暂存目录是 `mkdtemp` 建的，宿主机被强制退出（升级、崩溃、系统关机）时 `finally`
 * 跑不到，就会把几百 KB 的半成品留在运行时目录旁边。只在运行时已就绪时清理：
 * 那时不会再有活跃的解压，删除不会打乱正在进行的准备。
 */
export declare function cleanStaleStaging(parent: string, now?: number): Promise<number>;
/** Download only on explicit preparation or when a desktop surface is enabled. */
export declare function resolveElectron({ electronPath, download, onProgress }?: ResolveElectronOptions): Promise<string | undefined>;
export declare function helperEnvironment(url: string, token: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
