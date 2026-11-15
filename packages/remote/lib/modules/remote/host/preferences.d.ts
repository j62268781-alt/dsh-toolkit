/**
 * 「移动端」面板的偏好：哪些入口是开着的。
 *
 * 为什么单独落文件而不是写 profile 的 cordis 配置：那些配置是插件加载期读的，
 * 改完要重启 DSH 才生效；面板里的开关必须点完立刻管用，所以状态存在
 * `$DSH_HOME/toolkit/remote-preferences.json`，由本模块在进程内即时应用
 * （微信桥接直接启停，手机入口走 ds-harness-remote 的授权接口）。
 */
export interface RemotePreferences {
    /** 微信 ClawBot 桥接是否运行。 */
    wechat: boolean;
}
export interface PreferenceTarget {
    /** 偏好文件绝对路径。 */
    path: string;
    /** 文件不存在时的取值（来自插件配置）。 */
    fallback: RemotePreferences;
}
/**
 * 同步版本：只在插件加载期用一次。
 *
 * 插件装配顺序里有一步必须「拿到初值再决定起不起微信桥接」，而 cordis 不会等
 * `ctx.effect` 里的异步回调（实测 `await fiber` 之后异步 effect 还没跑完），
 * 于是路由先注册好、服务却还没起来，面板上就闪一下「已关闭」。这里同步读一个
 * 只有几十字节的 JSON，换掉那个竞态。
 */
export declare function readPreferencesSync(target: PreferenceTarget): RemotePreferences;
/** 读偏好；文件不存在或坏掉都退回配置里的默认值，不让面板因此失败。 */
export declare function readPreferences(target: PreferenceTarget): Promise<RemotePreferences>;
/**
 * 写偏好。先写临时文件再 rename：面板可能连点两下开关，
 * 半截文件会让下一次读取把两个开关都当成默认值。
 */
export declare function writePreferences(target: PreferenceTarget, next: RemotePreferences): Promise<RemotePreferences>;
/** 配置里的默认值：没写过偏好文件时，跟插件配置保持一致。 */
export declare function defaultPreferences(enabled: boolean): RemotePreferences;
//# sourceMappingURL=preferences.d.ts.map