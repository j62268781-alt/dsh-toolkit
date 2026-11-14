import type { RaiseWindowOptions } from './raise.js';
import type { SoundService } from './sounds.js';
export { RAISE_PATH, SOUND_PATH, SOUNDS_PATH } from './constants.js';
export declare const name = "dsh-toolkit-notification";
export declare const inject: string[];
/**
 * 提示音目录与音频文件两条只读路由。
 * @param ctx - 宿主上下文。
 * @param service - 声音服务（测试注入）。
 */
export declare function registerNotificationSoundRoutes(ctx: any, service?: SoundService): void;
/**
 * 「把窗口提到前台」的 POST 路由。
 *
 * 渲染进程点击系统通知时只能改前端路由（切到对应会话），窗口本身留在后台——Windows 的
 * 前台锁不允许后台进程抢焦点。这里借「再启动一个本应用实例」让主实例收到 second-instance
 * 并把窗口恢复+聚焦（原理见 raise.js）。必须是 POST：GET 会被预取或被缓存命中，等于
 * 用户没点也提窗。
 * @param ctx - 宿主上下文。
 * @param options - 注入给 raiseWindow 的选项（测试用）。
 */
export declare function registerRaiseRoute(ctx: any, options?: RaiseWindowOptions): void;
export declare function apply(ctx: any): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map