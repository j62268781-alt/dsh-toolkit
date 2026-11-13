/**
 * iLink 出站与媒体客户端。
 *
 * 职责边界：
 *   · 只负责「把一条已经决定要发的消息发出去」，不做队列、不做重试编排、不碰会话；
 *   · 凭据与 baseUrl 由调用方传入（凭据只存在 credentials 里，这里不落盘、不写日志）；
 *   · 所有请求都走 ilink.js 的 postAuthed，保证请求头/base_info 与登录链路一致。
 *
 * 协议要点（与腾讯 openclaw-weixin 一致）：
 *   · sendmessage：msg.message_type=2（Bot）、message_state=2（完成），回复必须回传 context_token；
 *   · 媒体先 getuploadurl 拿 CDN 地址，密文上传后拿响应头 x-encrypted-param 当下载参数。
 */
/** 消息类型：1 = 用户发来的，2 = Bot 发出的。 */
export declare const MESSAGE_TYPE: Readonly<{
    user: 1;
    bot: 2;
}>;
/** 消息状态：0 新增 / 1 生成中 / 2 完成。 */
export declare const MESSAGE_STATE: Readonly<{
    fresh: 0;
    generating: 1;
    done: 2;
}>;
/**
 * 创建一个绑定了单个 bot 账号的 iLink 客户端。
 * @param options.baseUrl 凭据里的 baseUrl（不同账号可能落在不同节点）
 * @param options.token   bot_token
 * @param options.timeoutMs 普通接口超时
 * @param options.sendRetries CDN 上传失败重试次数
 */
export declare function createIlinkApi({ baseUrl, token, cdnBaseUrl, timeoutMs, sendRetries, }?: any): {
    /** 发一条纯文本。 */
    sendText(to: any, text: any, contextToken: any): Promise<any>;
    /** 发一张图片（png/jpeg/webp/gif）。 */
    sendImage(to: any, data: any, contextToken: any): Promise<any>;
    /** 发一个文件。 */
    sendFile(to: any, data: any, name: any, contextToken: any): Promise<any>;
    /** 渠道启动/停止通知（微信侧据此展示 bot 在线状态）。 */
    notifyStart(signal: any): Promise<any>;
    notifyStop(signal: any): Promise<any>;
    /** 取「输入中」票据；每个用户单独取，拿到后应缓存。 */
    getTypingTicket(userId: any, contextToken: any, signal: any): Promise<any>;
    /** 输入中（1）/ 取消（2）。失败不重要，调用方可忽略异常。 */
    sendTyping(userId: any, ticket: any, status: any, signal: any): Promise<any>;
    /** 下载一条入站图片。 */
    downloadImage(image: any, signal: any): Promise<Buffer<ArrayBuffer>>;
    /** 下载一条入站文件。 */
    downloadFile(file: any, signal: any): Promise<Buffer<ArrayBuffer>>;
    /** 长轮询收消息（透传 ilink.getUpdates，方便一处注入 token/baseUrl）。 */
    getUpdates(cursor: any, timeout: any, signal: any): Promise<any>;
};
//# sourceMappingURL=api.d.ts.map