import { spawn } from 'node:child_process';
/**
 * 把桌面端的窗口提到前台。
 *
 * 为什么不是 `window.focus()`：渲染进程已经在通知的 click 回调里调过 `window.focus()`，
 * 但 Windows 的前台锁（foreground lock）只允许「当前拥有前台权的进程」把窗口抢到最前，
 * 后台应用直接 `SetForegroundWindow` / `BrowserWindow.focus()` 会被系统忽略。Electron 全链路
 * 也没有任何「点击系统通知 → 提升窗口」的实现（`windows_toast_notification.cc` 只把点击转成
 * 渲染进程的 `NotificationClicked` 事件）。
 *
 * 唯一被系统允许的做法是「再启动一次本应用」：第二个实例拿不到单实例锁 → 立刻退出，
 * 而第一个实例会收到 `second-instance` 事件并执行 `focusPrimaryWindow()`（`app.asar/lib/main.js`
 * 里是 `window.restore() + show() + focus()`）。实测从最小化+被记事本遮挡的状态下
 * 约 400ms 内恢复并拿到前台，见 docs/notification/README.md 的验证记录。
 *
 * host 侧本身就是 `ELECTRON_RUN_AS_NODE=1` 跑在同一个 exe 下的 Node 子进程，所以
 * `process.execPath` 就是这个桌面端 exe；启动时必须**去掉** `ELECTRON_RUN_AS_NODE`，
 * 否则新进程会以纯 Node 方式运行 `[]`（等于什么都不做）。
 *
 * @param {object} [options] 依赖注入（测试用）。
 * @param {Function} [options.spawnProcess] child_process.spawn 替身。
 * @param {string} [options.execPath] 要启动的可执行文件，缺省 process.execPath。
 * @param {Record<string, string|undefined>} [options.env] 环境变量，缺省 process.env。
 * @param {Record<string, string|undefined>} [options.versions] process.versions 替身。
 * @returns {boolean} 是否真的发起了一次启动。
 */
export interface RaiseWindowOptions {
    spawnProcess?: typeof spawn;
    execPath?: string;
    env?: Record<string, string | undefined>;
    versions?: Record<string, string | undefined>;
}
export declare function raiseWindow(options?: RaiseWindowOptions): boolean;
//# sourceMappingURL=raise.d.ts.map