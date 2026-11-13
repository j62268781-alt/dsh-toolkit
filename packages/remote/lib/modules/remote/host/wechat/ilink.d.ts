/**
 * iLink 扫码协议的最小实现（腾讯官方 ClawBot / 微信 ClawBot 通道）。
 *
 * 协议字段来自实测与参考实现的交叉验证：
 *   - get_bot_qrcode   → { ret, qrcode, qrcode_img_content }
 *   - get_qrcode_status→ { ret, status, bot_token?, ilink_bot_id?, baseurl?, ilink_user_id?, redirect_host? }
 *   - getupdates       → { ret|errcode, msgs?, get_updates_buf?, longpolling_timeout_ms? }
 *
 * 明确的不确定项（未实测，均已做防御式解析，缺字段时报可读错误而不是产生假数据）：
 *   - confirmed 分支里 bot_token / ilink_bot_id / baseurl / ilink_user_id 的确切取值形态
 *   - getupdates 返回 msgs[].item_list[].text_item.text 的文本结构
 *
 * 该文件不依赖任何第三方包，也不做任何落盘或日志输出。
 */
/** iLink 用 -14 表示 token 暂时失效（会话超时），不是永久错误。 */
export declare const STALE_TOKEN_CODE = -14;
/** 只允许 https，并把 baseUrl 规范化成不带尾斜杠的形式。 */
export declare function normalizeBaseUrl(value: any, fallback?: string): string;
/**
 * 申请一个登录二维码。
 * @param options.localTokens 本机已有 token 列表（最多取最近 10 个，倒序）——微信据此判断是否已有可用会话。
 * @returns {{ id: string, url: string }} id 用于轮询，url 交给前端渲染二维码。
 */
export declare function requestQrCode({ localTokens, signal }?: any): Promise<{
    id: any;
    url: any;
}>;
/**
 * 轮询二维码状态（长轮询，服务端约 30s 才返回）。
 * 注意：这是 GET，且 query 里带 qrcode id；不得把该 URL 写进日志。
 * @param baseUrl 可能因 scaned_but_redirect 而切换到微信分配的节点。
 */
export declare function pollQrStatus({ baseUrl, id, verifyCode, timeoutMs, signal }: any): Promise<any>;
/** 调用一个已认证的 iLink 接口。 */
export declare function postAuthed({ baseUrl, token, endpoint, body, timeoutMs, signal }: any): Promise<any>;
/**
 * iLink 的业务错误约定：`errcode` 优先，其次 `ret`；两者都缺省视为成功。
 * @throws 非 0 时抛出可读错误（调用方决定是否重试）
 */
export declare function assertSuccess(payload: any, label: any): any;
/**
 * 长轮询收消息。
 * @param cursor 上一轮的 get_updates_buf；首轮传空串。
 * @returns iLink 原始响应，含 msgs / get_updates_buf / longpolling_timeout_ms。
 */
export declare function getUpdates({ baseUrl, token, cursor, timeoutMs, signal }: any): Promise<any>;
/** 从一条 iLink 消息里取出纯文本（结构未实测，逐层防御）。 */
export declare function extractMessageText(message: any): string;
/** 把 iLink 消息压缩成前端可用的脱敏摘要（不含 token、不含 sender 全量 id）。 */
export declare function summarizeMessage(message: any): {
    note?: string;
    receivedAt: number;
    from: string;
    text: string;
};
/**
 * 脱敏一个标识符：保留首尾各 4 位。
 * 长度不足时整体打码，避免「脱敏后仍是原文」。
 */
export declare function maskId(value: any): string;
/** 从二维码状态响应里解析出凭据；字段缺失时抛出可读错误（不编造）。 */
export declare function readCredential(status: any): {
    userId?: any;
    token: any;
    accountId: any;
    baseUrl: string;
};
/** redirect_host 只接受主机名（可带端口），绝不允许带协议或路径。 */
export declare function redirectBaseUrl(host: any): string;
//# sourceMappingURL=ilink.d.ts.map