/**
 * 出站文本整形：把模型输出里微信不渲染的 Markdown 标记去掉，并按字节截断。
 *
 * 微信聊天框不渲染 Markdown：`**粗体**`、`### 标题`、`![图](url)` 都会原样显示成符号。
 * 这里做保守处理，只剥「肯定不渲染、且剥掉后不丢语义」的标记：
 *   · 图片语法整体删除（微信里显示成 ![](…) 毫无意义，真正要发的图片走 CDN 发送）；
 *   · 标题井号删除，标题文字保留；
 *   · 加粗/斜体标记删除，内容保留；
 *   · 代码块、行内码、表格、分割线、列表、引用保留原样（这些在微信里相对可读）。
 * 不追求完整 Markdown 解析——宁可少改，也不要吃掉正文。
 */
/** 单条消息的字节上限（iLink 与微信客户端都按字节算，留少量余量）。 */
export declare const MAX_OUTBOUND_TEXT_BYTES = 8000;
/**
 * 去掉微信不渲染的 Markdown 标记。
 * @param text 模型输出的原始文本
 */
export declare function filterMarkdownForWeixin(text: any): string;
/** 按 UTF-8 字节截断，保证不会切碎代理对/多字节字符。 */
export declare function truncateUtf8(text: any, maxBytes?: number): string;
/** 出站前的标准整形：过滤标记 + 截断。 */
export declare function prepareOutboundText(text: any, maxBytes?: number): string;
//# sourceMappingURL=markdown.d.ts.map