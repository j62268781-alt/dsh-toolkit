import s from '@deepseek-ai/schemastery';
export declare const Config: s<Schemastery.ObjectS<NoInfer<{
    activePet: s<string, string, "volatile-defined">;
    petEnabled: s<boolean, boolean, "volatile-defined">;
    petSize: s<number, number, "volatile-defined">;
    bubbleWidth: s<number, number, "volatile-defined">;
    islandEnabled: s<boolean, boolean, "volatile-defined">;
    islandIdle: s<boolean, boolean, "volatile-defined">;
    islandAllDisplays: s<boolean, boolean, "volatile-defined">;
    islandWidth: s<number, number, "volatile-defined">;
    islandHeight: s<number, number, "volatile-defined">;
    electronPath: s<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    activePet: s<string, string, "volatile-defined">;
    petEnabled: s<boolean, boolean, "volatile-defined">;
    petSize: s<number, number, "volatile-defined">;
    bubbleWidth: s<number, number, "volatile-defined">;
    islandEnabled: s<boolean, boolean, "volatile-defined">;
    islandIdle: s<boolean, boolean, "volatile-defined">;
    islandAllDisplays: s<boolean, boolean, "volatile-defined">;
    islandWidth: s<number, number, "volatile-defined">;
    islandHeight: s<number, number, "volatile-defined">;
    electronPath: s<string, string, "volatile-defined">;
}>>, "plain">;
/** 宠物模块用到的配置快照（`readSettings()` 的返回形状）。 */
export interface PetSettings {
    activePet: string;
    petEnabled: boolean;
    petSize: number;
    bubbleWidth: number;
    islandEnabled: boolean;
    islandIdle: boolean;
    islandAllDisplays: boolean;
    islandWidth: number;
    islandHeight: number;
}
/**
 * 读一个配置字段。
 *
 * 当前宿主把 `.volatile()` 字段作为「活动引用」对象（`{ get() }`）交给 `apply()`，
 * 而不是普通值：设置面板改写时宿主原地更新引用里的值，插件必须用的时候再取值。
 * 直接当普通值用会拿到 `{}` —— 例如 `path.isAbsolute(config.electronPath)` 会抛
 * `The "path" argument must be of type string. Received an instance of Object`。
 * `boot` / `remote` 两个模块的 `readConfig` 用的是同一套写法。
 *
 * `config` 的形状由宿主决定（值 / `{ get() }` / 未注入），故用显式 any。
 */
export declare function readField(config: any, key: string): any;
/** 显式指定的桌面运行时二进制路径；空字符串表示按缓存/下载解析。 */
export declare function readElectronPath(config: any): string;
export declare function readSettings(config?: any): PetSettings;
//# sourceMappingURL=config.d.ts.map