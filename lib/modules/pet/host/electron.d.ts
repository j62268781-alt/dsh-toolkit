export declare const ELECTRON_VERSION = "43.3.0";
export declare function executableIn(directory: string, platform?: NodeJS.Platform): string;
export declare function runtimeDirectory(): string;
export interface ResolveElectronOptions {
    electronPath?: string;
    download?: boolean;
}
/** Download only on explicit preparation or when a desktop surface is enabled. */
export declare function resolveElectron({ electronPath, download }?: ResolveElectronOptions): Promise<string | undefined>;
export declare function helperEnvironment(url: string, token: string, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
//# sourceMappingURL=electron.d.ts.map