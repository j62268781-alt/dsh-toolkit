/**
 * 扫码登录状态机（host 侧，单例，同一时刻只允许一个登录会话）。
 *
 * 设计要点：
 *   - 状态保存在内存里，不落盘；进程重启即失效（符合「不需要用户敲命令」的诉求）。
 *   - token 只在这个模块内存里短暂存在，确认后立刻写入 ctx.credentials，随后丢弃。
 *   - 前端通过 poll() 读取状态；poll 不产生副作用，不在 poll 里推进协议。
 *   - 协议推进由一个后台循环负责（advance），因此前端关闭面板不影响登录完成。
 *
 * 状态迁移：
 *   idle → requesting → waiting_qr ──scaned──→ scanned ──confirmed──→ confirmed(存凭据)
 *                            ↑                     │
 *                       need_code ─────────────────┘
 *                            └── expired（超过 QR_TTL_MS 没人扫）→ idle
 *
 * 关于「过期回 idle」而不是自动换码：二维码只在用户点了「连接微信」时才申请，
 * 有效期 120s（实测）。到点还没连上就说明用户走开了，此时继续轮换新码既没意义，
 * 又会让人再打开面板时看到一张陌生的码。所以直接回到未连接，等用户重新点。
 */
import { STALE_TOKEN_CODE } from './ilink.js';
/**
 * 二维码有效期。
 *
 * 这个数字是实测出来的，不是猜的：`get_qrcode_status` 首次长轮询约 30s 返回 `wait`，
 * 同一张码持续约 120s 后服务端返回 `expired`（两次独立实测都是 [30.6s] wait → [122.1s] expired）。
 * 服务端申请二维码的响应里没有任何 TTL 字段，所以客户端只能按实测值给倒计时。
 */
export declare const QR_TTL_MS = 120000;
/**
 * 创建一个登录管理器。
 * @param options.credentials 宿主 credentials 服务（resolve/set/unset）。
 * @param options.credentialRef 凭据引用名。
 * @param options.logger 宿主 logger；只记录状态变化，绝不记录二维码 URL 或 token。
 * @param options.onConnected 登录成功回调（用于启动监听）。
 * @param options.onDisconnected 断开回调（用于停止监听）。
 */
export declare function createLoginManager({ credentials, credentialRef, logger, onConnected, onDisconnected, now, }: any): {
    /** 读取当前状态（无副作用）。 */
    status(): any;
    /**
     * 发起登录（申请二维码）。
     *
     * @param options.localTokens 旧 token，供服务端判断是否同一账号。
     * @param options.force 丢弃手上还没过期的二维码，强制换新码。
     *   默认 false：只要会话里有一张未过期的码就复用它，避免每次打开面板都刷新，
     *   也让手机上正在扫的码不会突然失效。
     */
    start({ localTokens, force }?: any): Promise<any>;
    /** 回传微信要求的数字校验码。 */
    submitCode(code: any): any;
    /** 主动取消（面板关闭、用户点取消）。 */
    cancel(): any;
    /** 断开：清空凭据并停止监听。 */
    logout(): Promise<any>;
    /** 记录最近一条消息（供 UI 显示，证明通道是通的）。 */
    recordMessage(summary: any): void;
    dispose(): void;
};
export { STALE_TOKEN_CODE };
//# sourceMappingURL=login.d.ts.map