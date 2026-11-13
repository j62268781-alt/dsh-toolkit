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
export const MAX_OUTBOUND_TEXT_BYTES = 8_000;
const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/g;
const HEADING_PATTERN = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const BOLD_PATTERN = /(\*\*\*|___|\*\*|__)(?=\S)([\s\S]*?\S)\1/g;
const ITALIC_PATTERN = /(?<![\w*])([*_])(?=\S)([^`\n]*?\S)\1(?![\w*])/g;
const BLANK_RUN_PATTERN = /\n{3,}/g;
/**
 * 去掉微信不渲染的 Markdown 标记。
 * @param text 模型输出的原始文本
 */
export function filterMarkdownForWeixin(text) {
    const input = typeof text === 'string' ? text : '';
    if (input === '')
        return '';
    let output = input.replace(/\r\n/g, '\n');
    // 代码块先保护起来，避免其中的 `*` `#` 被下面的规则改写
    const fences = [];
    output = output.replace(/```[\s\S]*?```/g, (block) => {
        fences.push(block);
        return `\u0000FENCE${fences.length - 1}\u0000`;
    });
    output = output
        .replace(IMAGE_PATTERN, '')
        .replace(HEADING_PATTERN, '')
        .replace(BOLD_PATTERN, '$2')
        .replace(ITALIC_PATTERN, '$2');
    output = output.replace(/\u0000FENCE(\d+)\u0000/g, (_, index) => fences[Number(index)]);
    return output
        .replace(BLANK_RUN_PATTERN, '\n\n')
        .replace(/[ \t]+$/gm, '')
        .trim();
}
/** 按 UTF-8 字节截断，保证不会切碎代理对/多字节字符。 */
export function truncateUtf8(text, maxBytes = MAX_OUTBOUND_TEXT_BYTES) {
    const input = typeof text === 'string' ? text : '';
    if (Buffer.byteLength(input, 'utf8') <= maxBytes)
        return input;
    const suffix = '\n…（内容过长，已截断）';
    const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'));
    let used = 0;
    let cut = 0;
    for (const symbol of input) {
        const size = Buffer.byteLength(symbol, 'utf8');
        if (used + size > budget)
            break;
        used += size;
        cut += symbol.length;
    }
    return `${input.slice(0, cut)}${suffix}`;
}
/** 出站前的标准整形：过滤标记 + 截断。 */
export function prepareOutboundText(text, maxBytes = MAX_OUTBOUND_TEXT_BYTES) {
    return truncateUtf8(filterMarkdownForWeixin(text), maxBytes);
}
//# sourceMappingURL=markdown.js.map