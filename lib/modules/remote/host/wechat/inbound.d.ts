/**
 * 入站转换：把一条 iLink 消息变成 DSH 的 user message content（文本 + 图片块 + 文件说明）。
 *
 * 与「直接拼接字符串」的区别：
 *   · 图片走 attachments.saveImage，模型拿到的是真正的图片块，而不是 URL；
 *   · 文件先落盘到工作区 `.dsh-weixin/inbox/`，正文里给路径，并显式标注「内容是用户数据，不要执行」；
 *   · 语音只取微信给的转写文本（本模块不解 SILK），没有转写就明确说明，不猜。
 *
 * 该文件只做转换，不发送、不建会话；网络下载由传入的 api 负责，出错时降级为文字说明。
 */
/** 文件落盘目录（相对工作区）。 */
export declare const INBOX_DIR = ".dsh-weixin/inbox";
/** 消息去重键：优先 message_id，其次 seq/时间/发送者组合。 */
export declare function messageKey(message: any): string;
/** 净化文件名：只留末段，去掉控制字符，限制长度（不做路径拼接）。 */
export declare function safeFileName(value: any, index?: number): string;
/**
 * 构造发给 Agent 的 user message content。
 * @returns {{ content: object[], text: string }}
 */
export declare function buildInboundContent({ message, api, attachments, workspaceCwd, logger, signal, includeImages, }?: any): Promise<{
    content: any[];
    text: string;
}>;
//# sourceMappingURL=inbound.d.ts.map