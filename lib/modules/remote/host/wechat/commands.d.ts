/**
 * 微信侧斜杠命令的解析与帮助文案。
 *
 * 命令本身很短，但文案要能在微信里读得下去：每行一条、不带 Markdown 标记。
 * 执行逻辑在 bridge.js（这里保持纯函数，方便单测）。
 */
/**
 * 解析一条斜杠命令。
 * @returns {{ name: string, args: string } | undefined} 不以 / 开头时返回 undefined
 */
export declare function parseCommand(text: any): {
    name: string;
    args: string;
};
/**
 * 帮助文案：用户明确要求「只告诉支持哪些指令就好」，
 * 所以这里只列命令 + 一句极短的用途，不写用法段落。
 */
export declare function helpText(): string;
/** 是否为已知命令（未知命令统一回帮助）。 */
export declare function isKnownCommand(name: any): boolean;
//# sourceMappingURL=commands.d.ts.map