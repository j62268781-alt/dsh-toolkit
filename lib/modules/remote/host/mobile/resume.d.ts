/**
 * 启动期：把「已经配对过、但这次开机没连上」的手机连接接回来。
 *
 * 为什么需要它：上游只在自己 start() 里（且 `hostControl.enabled !== false`）拉起
 * server ws；而扫码配对的主机（`pairing-host-only.json` = `{"hostOnly":true}`）走的是
 * 「配对成功回调里 reconnect」这一条路，配对那一刻之后进程再重启，就没有任何人去连了。
 * 面板（popup）帮不上忙：它调用的 `host.pairing.status` / `settings.get` / `status`
 * 全是只读的，一个都不会启动 ws——所以「打开面板才连上」只是错觉，真相是这台机器
 * 重启后一直没人发起连接。
 *
 * 还有一层原因：`hostControl.enabled` 一旦变成 false，上游 `start()` 就再也不启动 ws，
 * 而把它改回 true 需要本机 client 凭据——只接受扫码配对的机器永远拿不到（见
 * `src/modules/mobile/client/settings-panel.tsx` 里关于「开关会变成一次性」的记录）。
 * 结果是本机明明绑定过手机，却永远不上线。所以这里**不看这个开关**：判定依据是本地那份
 * 配对快照（trusted-peers / pairing-host-only），也就是用户自己扫码授权过的设备；
 * 那个字段是上游给账号态记账用的，不该成为本机被控连接的唯一闸门。
 *
 * 这里只做一件事：读一眼本地配对快照，确认「这台机器确实绑定过手机」且当前不在线，
 * 就调一次 `reconnectHost()`（上游 `HostServerConnection.reconnect()` 在未运行时
 * 等价于 `start()`）。不写配置、不改 `hostControl` 字段、不碰凭据。
 */
export type ResumeOutcome = 'online' | 'connected' | 'not-configured' | 'no-binding' | 'offline' | 'gave-up' | 'error' | 'disposed';
export interface StartupResumeOptions {
    /** 上游 host 运行时（宿主服务 `dshRemote`）：至少要 hostStatus() / reconnectHost()。 */
    service: any;
    /** 「本机绑定过手机」的判据；默认读 $DSH_HOME 下的配对快照。 */
    hasBinding?: () => boolean | Promise<boolean>;
    log?: (level: 'info' | 'warn', message: string) => void;
    delays?: readonly number[];
    maxConnects?: number;
    /** 注入用：测试里换成即时返回，免得等真定时器。 */
    wait?: (ms: number) => Promise<void>;
}
export interface StartupResume {
    begin: () => void;
    run: () => Promise<ResumeOutcome>;
    dispose: () => void;
}
/**
 * 「这次开机该不该主动连一次」的纯决策。
 *
 * 单独拎出来是为了能脱离运行时单测：它只看两样东西——本地有没有绑定痕迹、
 * 上游此刻的状态。`authorized` 故意不参与判断：扫码配对的主机本身没有账号授权
 * （`authorization === undefined`），拿它当门槛会把最该连的那台机器挡在外面。
 */
export declare function decideStartupResume(status: any, hasBinding: boolean): {
    readonly action: "skip";
    readonly reason: "no-binding";
} | {
    readonly action: "skip";
    readonly reason: "online";
} | {
    readonly action: "skip";
    readonly reason: "not-configured";
} | {
    readonly action: "connect";
    reason?: undefined;
};
/**
 * 本机是否「绑定过手机」。
 *
 * 两个来源都只看文件：`pairing-host-only.json`（本机只被控）与 `trusted-peers.json`
 * （配对过的手机清单）。serverUrl 取上游运行时自己的配置——面板写进 patch 的那个值，
 * 因为 scope 目录名是它的 sha256 前 24 位，换服务地址就等于换目录。
 */
export declare function hasLocalBinding({ service, homeDir }: {
    service: any;
    homeDir?: string;
}): Promise<boolean>;
/**
 * 启动期恢复器。
 *
 * `begin()` 是幂等的（重复调用只有一份在跑）；`dispose()` 之后正在等待的那一拍
 * 会立刻收尾，不再发任何请求——插件可能在连接完成前就被卸载。
 */
export declare function createStartupResume(options: StartupResumeOptions): StartupResume;
